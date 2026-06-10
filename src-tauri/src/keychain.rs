use crate::connection::secrets::{MasterKeyOutcome, MasterKeyProvider};
use crate::logctx;
use crate::logger::Logger;
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use rand::rngs::OsRng;
use rand::RngCore;
use ring::aead::{Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM};
use ring::error::Unspecified;
use security_framework::os::macos::keychain::SecKeychain;
use security_framework::os::macos::keychain_item::SecKeychainItem;
use security_framework::passwords::get_generic_password;
use security_framework_sys::base::{errSecSuccess, SecKeychainItemRef};
use security_framework_sys::keychain::SecKeychainAddGenericPassword;
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::ptr;

const SERVICE: &str = "com.mongomacapp.app";
const MASTER_KEY_ACCOUNT: &str = "mongomacapp.master-encryption-key";
const MASTER_KEY_SIZE: usize = 32; // 256 bits for AES-256
const NONCE_SIZE: usize = 12; // 96 bits for GCM

/// Surfaced when the master key is gone but encrypted blobs still exist
/// (e.g. a forced macOS keychain reset). The app refuses to regenerate the
/// key over them — that would orphan every stored secret. Blobs are kept;
/// recovery is re-entry.
const KEY_UNRECOVERABLE_MSG: &str =
    "Stored secret unavailable: the encryption key is missing but encrypted data exists \
     (likely a macOS keychain reset). Re-enter the affected secret to continue.";

/// FFI declarations for macOS Security framework functions not exposed
/// by the `security-framework-sys` crate (ACL and trusted application APIs).
mod ffi {
    use core_foundation_sys::base::OSStatus;
    use core_foundation_sys::string::CFStringRef;
    use core_foundation_sys::array::CFArrayRef;
    use security_framework_sys::base::{SecAccessRef, SecKeychainItemRef};
    use std::os::raw::c_char;

    /// Opaque type for SecTrustedApplicationRef (not in security-framework-sys).
    pub type SecTrustedApplicationRef = *mut std::ffi::c_void;

    extern "C" {
        /// Creates a trusted application reference from a path.
        /// Pass NULL for `path` to mean "the current application".
        pub fn SecTrustedApplicationCreateFromPath(
            path: *const c_char,
            app: *mut SecTrustedApplicationRef,
        ) -> OSStatus;

        /// Creates a new access object with the given descriptor and trusted apps.
        pub fn SecAccessCreate(
            descriptor: CFStringRef,
            trusted_list: CFArrayRef,
            access_ref: *mut SecAccessRef,
        ) -> OSStatus;

        /// Sets the access control on a keychain item.
        pub fn SecKeychainItemSetAccess(
            item_ref: SecKeychainItemRef,
            access_ref: SecAccessRef,
        ) -> OSStatus;
    }
}

/// Creates a macOS Security "access" object that trusts only the current binary.
///
/// When applied to a keychain item, this ACL allows the current application
/// to read the item without triggering a password prompt. Other applications
/// (or the same app after a binary change) will still see the standard macOS
/// "allow / always allow" dialog.
///
/// Returns the raw `SecAccessRef` on success, or `None` on failure (logged).
fn create_self_trusted_access(label: &str, log: &dyn Logger) -> Option<security_framework_sys::base::SecAccessRef> {
    use core_foundation_sys::array::CFArrayCreate;
    use core_foundation_sys::base::{CFRelease, CFTypeRef};

    unsafe {
        // Create a trusted application ref for the current binary (path = NULL).
        let mut trusted_app: ffi::SecTrustedApplicationRef = ptr::null_mut();
        let status = ffi::SecTrustedApplicationCreateFromPath(ptr::null(), &mut trusted_app);
        if status != errSecSuccess {
            log.warn("SecTrustedApplicationCreateFromPath failed", logctx! {
                "label" => label,
                "status" => status,
            });
            return None;
        }

        // Build a CFArray containing just the current app using raw CoreFoundation API.
        let apps_array = [trusted_app as CFTypeRef];
        let trusted_list = CFArrayCreate(
            ptr::null(),                // default allocator
            apps_array.as_ptr(),        // values
            1,                          // count
            ptr::null(),                // callbacks (NULL = no retain/release)
        );

        // Create an access object with that trusted app list.
        let descriptor = CFString::new(label);
        let mut access_ref: security_framework_sys::base::SecAccessRef = ptr::null_mut();
        let status = ffi::SecAccessCreate(
            descriptor.as_concrete_TypeRef(),
            trusted_list,
            &mut access_ref,
        );

        // Release intermediate CF objects now that SecAccessCreate is done.
        // trusted_list was created with NULL callbacks (no retain on insert),
        // so trusted_app must outlive the array -- release it after the array.
        CFRelease(trusted_list as CFTypeRef);
        CFRelease(trusted_app as CFTypeRef);

        if status != errSecSuccess {
            log.warn("SecAccessCreate failed", logctx! {
                "label" => label,
                "status" => status,
            });
            return None;
        }

        Some(access_ref)
    }
}

/// Applies a self-trusted ACL to an existing keychain item.
///
/// After this call, the current binary can access the item silently.
/// If ACL application fails, a warning is logged but the item remains usable
/// (it just may prompt the user on next access).
fn apply_self_trusted_acl(item: &SecKeychainItem, label: &str, log: &dyn Logger) {
    if let Some(access_ref) = create_self_trusted_access(label, log) {
        let status = unsafe {
            ffi::SecKeychainItemSetAccess(
                item.as_concrete_TypeRef(),
                access_ref,
            )
        };

        // Release the access object now that it has been applied (or failed).
        unsafe {
            use core_foundation_sys::base::{CFRelease, CFTypeRef};
            CFRelease(access_ref as CFTypeRef);
        }

        if status != errSecSuccess {
            log.warn("SecKeychainItemSetAccess failed", logctx! {
                "label" => label,
                "status" => status,
            });
        } else {
            log.debug("self-trusted ACL applied", logctx! {
                "label" => label,
            });
        }
    }
}

/// A NonceSequence that returns a single nonce then errors.
/// Used for one-shot encryption/decryption operations.
struct OneNonceSequence {
    nonce: Option<[u8; NONCE_SIZE]>,
}

impl OneNonceSequence {
    fn new(nonce: [u8; NONCE_SIZE]) -> Self {
        Self { nonce: Some(nonce) }
    }
}

impl NonceSequence for OneNonceSequence {
    fn advance(&mut self) -> Result<Nonce, Unspecified> {
        self.nonce
            .take()
            .map(|n| Nonce::assume_unique_for_key(n))
            .ok_or(Unspecified)
    }
}

/// Stores `secret` as a generic-password keychain item under
/// `(service, account)` with a self-trusted ACL so future reads from this
/// binary don't prompt.
///
/// Returns `Ok(None)` when our write succeeded, or `Ok(Some(existing))` when
/// a concurrent create won the race (errSecDuplicateItem) and we re-fetched
/// the stored value. Shared by the legacy path and the v2
/// `KeychainMasterKeyProvider` so the ACL hardening lives in exactly one
/// place (the v2 entry previously lacked it).
pub(crate) fn add_generic_password_with_self_trust(
    service: &str,
    account: &str,
    secret: &[u8],
    acl_label: &str,
    log: &dyn Logger,
) -> Result<Option<Vec<u8>>, String> {
    let keychain = SecKeychain::default().map_err(|e| {
        log.error("keychain default failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    // Legacy API captures the item ref so we can apply the self-trusted ACL.
    let (status, item_ref) = unsafe {
        let mut item_ref: SecKeychainItemRef = ptr::null_mut();
        let status = SecKeychainAddGenericPassword(
            keychain.as_concrete_TypeRef() as *mut _,
            service.len() as u32,
            service.as_ptr().cast(),
            account.len() as u32,
            account.as_ptr().cast(),
            secret.len() as u32,
            secret.as_ptr().cast(),
            &mut item_ref,
        );
        (status, item_ref)
    };

    if status == errSecSuccess {
        if !item_ref.is_null() {
            let item = unsafe { SecKeychainItem::wrap_under_create_rule(item_ref) };
            apply_self_trusted_acl(&item, acl_label, log);
        }
        Ok(None)
    } else if status == -25299 {
        // errSecDuplicateItem: a concurrent create stored it first.
        log.info(
            "keychain item already exists (concurrent create), retrieving",
            logctx! { "account" => account },
        );
        get_generic_password(service, account)
            .map(Some)
            .map_err(|e| format!("Failed to retrieve existing keychain item: {}", e))
    } else {
        log.error(
            "keychain item storage failed",
            logctx! { "account" => account, "status" => status },
        );
        Err(format!("Failed to store keychain item: OSStatus {}", status))
    }
}

/// True if any legacy `~/.mongomacapp/encrypted/*.bin` ciphertext blob
/// exists. A missing dir counts as "no blobs". Used to gate master-key
/// creation: we never regenerate a key when ciphertext it can't decrypt
/// already exists.
fn legacy_blobs_exist() -> bool {
    let dir = match std::env::var("HOME") {
        Ok(home) => Path::new(&home).join(".mongomacapp").join("encrypted"),
        Err(_) => return false,
    };
    match fs::read_dir(&dir) {
        Ok(entries) => entries.flatten().any(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| name.ends_with(".bin"))
                .unwrap_or(false)
        }),
        Err(_) => false,
    }
}

/// Resolve a master key from `provider`, gating creation on `blobs_exist` so
/// the key is NEVER regenerated over existing ciphertext.
///
/// * `Found`       → use it.
/// * `Unavailable` → transient error; refuse to regenerate (retryable).
/// * `Absent` + no blobs → genuine first run; create + persist a key.
/// * `Absent` + blobs exist → the keychain was reset out from under intact
///   blobs; refuse and surface [`KEY_UNRECOVERABLE_MSG`].
///
/// Pure with respect to the keychain (the provider owns that), so it is unit-
/// testable with an in-memory provider.
fn resolve_master_key(
    provider: &dyn MasterKeyProvider,
    blobs_exist: bool,
    log: &dyn Logger,
) -> Result<Vec<u8>, String> {
    match provider.fetch() {
        MasterKeyOutcome::Found(key) => Ok(key[..].to_vec()),
        MasterKeyOutcome::Unavailable(detail) => {
            log.error(
                "master key unavailable (transient); not regenerating",
                logctx! { "err" => detail.clone() },
            );
            Err(format!("Failed to access keychain: {}", detail))
        }
        MasterKeyOutcome::Absent => {
            if blobs_exist {
                log.error(
                    "master key absent but ciphertext exists; refusing to regenerate",
                    logctx! {},
                );
                Err(KEY_UNRECOVERABLE_MSG.to_string())
            } else {
                log.info("master key absent, no ciphertext yet; creating new", logctx! {});
                provider
                    .create()
                    .map(|key| key[..].to_vec())
                    .map_err(|e| e.to_string())
            }
        }
    }
}

/// Gets the legacy master encryption key from Keychain, or creates one if
/// missing — but NEVER regenerates over existing ciphertext (a forced
/// keychain reset surfaces [`KEY_UNRECOVERABLE_MSG`] instead of silently
/// orphaning blobs). Creation applies a self-trusted ACL so future reads
/// from this binary don't prompt.
fn get_or_create_master_key(log: &dyn Logger) -> Result<Vec<u8>, String> {
    let provider = crate::connection::secrets::KeychainMasterKeyProvider::new(
        SERVICE,
        MASTER_KEY_ACCOUNT,
        "master-key",
        log.child(logctx! {}),
    );
    resolve_master_key(&provider, legacy_blobs_exist(), log)
}

/// Encrypts a password using AES-256-GCM with a random nonce.
///
/// Returns a byte vector with format: [12-byte nonce][ciphertext + 16-byte auth tag]
fn encrypt_password(password: &str, master_key: &[u8]) -> Result<Vec<u8>, String> {
    if master_key.len() != MASTER_KEY_SIZE {
        return Err(format!("Invalid master key size: {} (expected {})", master_key.len(), MASTER_KEY_SIZE));
    }

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);

    // Create sealing key
    let unbound_key = UnboundKey::new(&AES_256_GCM, master_key)
        .map_err(|_| "Failed to create encryption key".to_string())?;
    let nonce_sequence = OneNonceSequence::new(nonce_bytes);
    let mut sealing_key = SealingKey::new(unbound_key, nonce_sequence);

    // Encrypt password
    let mut in_out = password.as_bytes().to_vec();
    sealing_key
        .seal_in_place_append_tag(Aad::empty(), &mut in_out)
        .map_err(|_| "Encryption failed".to_string())?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(NONCE_SIZE + in_out.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&in_out);

    Ok(result)
}

/// Decrypts a password encrypted by encrypt_password.
///
/// Expects input format: [12-byte nonce][ciphertext + 16-byte auth tag]
fn decrypt_password(encrypted: &[u8], master_key: &[u8]) -> Result<String, String> {
    if master_key.len() != MASTER_KEY_SIZE {
        return Err(format!("Invalid master key size: {} (expected {})", master_key.len(), MASTER_KEY_SIZE));
    }

    if encrypted.len() < NONCE_SIZE + 16 {
        return Err(format!("Encrypted data too short: {} bytes (expected at least {})", encrypted.len(), NONCE_SIZE + 16));
    }

    // Extract nonce and ciphertext
    let nonce_bytes: [u8; NONCE_SIZE] = encrypted[..NONCE_SIZE]
        .try_into()
        .map_err(|_| "Failed to extract nonce".to_string())?;
    let ciphertext = &encrypted[NONCE_SIZE..];

    // Create opening key
    let unbound_key = UnboundKey::new(&AES_256_GCM, master_key)
        .map_err(|_| "Failed to create decryption key".to_string())?;
    let nonce_sequence = OneNonceSequence::new(nonce_bytes);
    let mut opening_key = OpeningKey::new(unbound_key, nonce_sequence);

    // Decrypt
    let mut in_out = ciphertext.to_vec();
    let plaintext = opening_key
        .open_in_place(Aad::empty(), &mut in_out)
        .map_err(|_| "Decryption failed (corrupted data or wrong key)".to_string())?;

    // Convert to UTF-8 string
    String::from_utf8(plaintext.to_vec())
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))
}

/// Ensures the encrypted password directory exists and returns its path.
///
/// Creates `~/.mongomacapp/encrypted/` with permissions 0700 (owner rwx only).
/// Returns the absolute path to the directory.
fn ensure_encrypted_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .map_err(|_| "HOME environment variable not set".to_string())?;

    let dir = Path::new(&home).join(".mongomacapp").join("encrypted");

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create encrypted directory: {}", e))?;

        // Set directory permissions to 0700 (owner rwx only)
        #[cfg(unix)]
        {
            let metadata = fs::metadata(&dir)
                .map_err(|e| format!("Failed to read directory metadata: {}", e))?;
            let mut perms = metadata.permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&dir, perms)
                .map_err(|e| format!("Failed to set directory permissions: {}", e))?;
        }
    }

    Ok(dir)
}

/// Atomically writes data to a file using temp file + rename.
///
/// Writes to `{path}.tmp`, fsyncs, then renames to `{path}` atomically.
/// Sets file permissions to 0600 (owner rw only) after creation.
fn atomic_write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp_path = path.with_extension("tmp");

    // Write to temp file
    let mut file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    file.write_all(data)
        .map_err(|e| format!("Failed to write data: {}", e))?;

    // Ensure data is written to disk before rename
    file.sync_all()
        .map_err(|e| format!("Failed to sync file: {}", e))?;

    drop(file); // Close file before rename

    // Set permissions to 0600 (owner rw only)
    #[cfg(unix)]
    {
        let metadata = fs::metadata(&tmp_path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&tmp_path, perms)
            .map_err(|e| format!("Failed to set file permissions: {}", e))?;
    }

    // Atomic rename
    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}

pub fn set_password(connection_id: &str, password: &str, log: &dyn Logger) -> Result<(), String> {
    // NEVER log `password` — only log that a set happened.
    let master_key = get_or_create_master_key(log)?;
    set_password_with_key(connection_id, password, &master_key, log)
}

/// Encrypt + persist a password under an explicitly-supplied master key,
/// bypassing keychain resolution. Production `set_password` resolves the key
/// then delegates here; tests inject a fixed key so they never touch the real
/// keychain.
fn set_password_with_key(
    connection_id: &str,
    password: &str,
    master_key: &[u8],
    log: &dyn Logger,
) -> Result<(), String> {
    let encrypted = encrypt_password(password, master_key)?;
    let dir = ensure_encrypted_dir()?;
    let file_path = dir.join(format!("{}.bin", connection_id));
    atomic_write_file(&file_path, &encrypted)?;
    log.info("password set", logctx! { "connId" => connection_id });
    Ok(())
}

pub fn get_password(connection_id: &str, log: &dyn Logger) -> Result<Option<String>, String> {
    let dir = ensure_encrypted_dir()?;
    let file_path = dir.join(format!("{}.bin", connection_id));

    // Read encrypted file
    let encrypted = match fs::read(&file_path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log.info("password get", logctx! {
                "connId" => connection_id,
                "found" => false,
            });
            return Ok(None);
        }
        Err(e) => {
            log.error("password file read failed", logctx! {
                "connId" => connection_id,
                "err" => e.to_string(),
            });
            return Err(format!("Failed to read password file: {}", e));
        }
    };

    // Get master key and decrypt
    let master_key = get_or_create_master_key(log)?;
    let password = decrypt_password(&encrypted, &master_key)?;

    log.info("password get", logctx! {
        "connId" => connection_id,
        "found" => true,
    });
    Ok(Some(password))
}

pub fn delete_password(connection_id: &str, log: &dyn Logger) -> Result<(), String> {
    let dir = ensure_encrypted_dir()?;
    let file_path = dir.join(format!("{}.bin", connection_id));

    match fs::remove_file(&file_path) {
        Ok(()) => {
            log.info("password delete", logctx! { "connId" => connection_id });
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log.debug("password delete noop (not found)", logctx! {
                "connId" => connection_id,
            });
            Ok(())
        }
        Err(e) => {
            log.error("password delete failed", logctx! {
                "connId" => connection_id,
                "err" => e.to_string(),
            });
            Err(format!("Failed to delete password file: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::secrets::InMemoryMasterKeyProvider;
    use crate::logger::MemoryLogger;
    use std::sync::Mutex;

    /// Serializes tests that mutate the process-global `HOME` env var (so the
    /// legacy blob dir resolves into a per-test tempdir). Unlike the removed
    /// `MASTER_KEY_LOCK`, this guards an env var, not the real keychain — no
    /// keychain access means no panic-while-holding, so no poison cascade.
    /// Recovered on poison anyway, defensively.
    static HOME_LOCK: Mutex<()> = Mutex::new(());

    /// Run `f` with `HOME` pointed at a fresh tempdir, restoring it after.
    /// Serialized via `HOME_LOCK` because `HOME` is process-global.
    fn with_temp_home<T>(f: impl FnOnce() -> T) -> T {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let original = std::env::var("HOME").ok();
        let test_dir =
            std::env::temp_dir().join(format!("mongomacapp-test-{}", uuid::Uuid::new_v4()));
        std::env::set_var("HOME", &test_dir);
        let result = f();
        fs::remove_dir_all(&test_dir).ok();
        match original {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
        result
    }

    const TEST_KEY: [u8; 32] = [42u8; 32];

    // ── Pure crypto (no keychain, no filesystem) ──────────────────────────

    #[test]
    fn encrypt_decrypt_password_roundtrip() {
        let password = "my-secret-password";
        let encrypted = encrypt_password(password, &TEST_KEY).unwrap();
        assert!(encrypted.len() > password.len(), "encrypted should be larger (nonce + tag)");
        let decrypted = decrypt_password(&encrypted, &TEST_KEY).unwrap();
        assert_eq!(decrypted, password);
    }

    #[test]
    fn encrypt_password_produces_unique_ciphertexts() {
        let password = "same-password";
        let encrypted1 = encrypt_password(password, &TEST_KEY).unwrap();
        let encrypted2 = encrypt_password(password, &TEST_KEY).unwrap();
        assert_ne!(encrypted1, encrypted2, "each encryption should use unique nonce");
    }

    #[test]
    fn decrypt_password_fails_with_wrong_key() {
        let key1 = vec![1u8; 32];
        let key2 = vec![2u8; 32];
        let encrypted = encrypt_password("secret", &key1).unwrap();
        let result = decrypt_password(&encrypted, &key2);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Decryption failed"));
    }

    // ── Filesystem helpers (key-injected, no keychain) ────────────────────

    #[test]
    fn ensure_encrypted_dir_creates_directory() {
        with_temp_home(|| {
            let dir = ensure_encrypted_dir().unwrap();
            assert!(dir.exists());
            assert!(dir.is_dir());
        });
    }

    #[test]
    fn atomic_write_file_creates_file() {
        let test_file =
            std::env::temp_dir().join(format!("test-{}.bin", uuid::Uuid::new_v4()));
        atomic_write_file(&test_file, b"test data").unwrap();
        assert_eq!(fs::read(&test_file).unwrap(), b"test data");
        fs::remove_file(&test_file).ok();
    }

    #[test]
    fn set_password_with_key_creates_encrypted_file() {
        with_temp_home(|| {
            let log = MemoryLogger::new("test");
            let id = format!("test-{}", uuid::Uuid::new_v4());
            set_password_with_key(&id, "test-password", &TEST_KEY, log.as_ref()).unwrap();
            let dir = ensure_encrypted_dir().unwrap();
            assert!(dir.join(format!("{}.bin", id)).exists());
        });
    }

    #[test]
    fn set_get_delete_roundtrip_with_key() {
        with_temp_home(|| {
            let log = MemoryLogger::new("test");
            let id = format!("test-{}", uuid::Uuid::new_v4());
            set_password_with_key(&id, "hunter2", &TEST_KEY, log.as_ref()).unwrap();
            assert_eq!(read_decrypt(&id, &TEST_KEY).unwrap().as_deref(), Some("hunter2"));
            delete_password(&id, log.as_ref()).unwrap();
            assert!(read_decrypt(&id, &TEST_KEY).unwrap().is_none());
        });
    }

    #[test]
    fn delete_password_removes_encrypted_file() {
        with_temp_home(|| {
            let log = MemoryLogger::new("test");
            let id = format!("test-{}", uuid::Uuid::new_v4());
            set_password_with_key(&id, "test", &TEST_KEY, log.as_ref()).unwrap();
            let file_path = ensure_encrypted_dir().unwrap().join(format!("{}.bin", id));
            assert!(file_path.exists());
            delete_password(&id, log.as_ref()).unwrap();
            assert!(!file_path.exists());
        });
    }

    #[test]
    fn get_password_returns_none_for_missing_file() {
        with_temp_home(|| {
            let log = MemoryLogger::new("test");
            let id = format!("nonexistent-{}", uuid::Uuid::new_v4());
            assert_eq!(get_password(&id, log.as_ref()).unwrap(), None);
        });
    }

    #[test]
    fn read_decrypt_handles_corrupted_file() {
        with_temp_home(|| {
            let id = format!("test-{}", uuid::Uuid::new_v4());
            let file_path = ensure_encrypted_dir().unwrap().join(format!("{}.bin", id));
            fs::write(&file_path, b"corrupted").unwrap();
            let result = read_decrypt(&id, &TEST_KEY);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("too short"));
        });
    }

    /// Test-only counterpart of the read path that takes an explicit key,
    /// so the corrupted-blob and round-trip assertions never touch the
    /// real keychain.
    fn read_decrypt(connection_id: &str, master_key: &[u8]) -> Result<Option<String>, String> {
        let dir = ensure_encrypted_dir()?;
        let file_path = dir.join(format!("{}.bin", connection_id));
        let encrypted = match fs::read(&file_path) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("read failed: {e}")),
        };
        decrypt_password(&encrypted, master_key).map(Some)
    }

    // ── Master-key resolution gating (the new never-regenerate contract) ──

    #[test]
    fn resolve_master_key_creates_on_fresh_install() {
        let log = MemoryLogger::new("test");
        let provider = InMemoryMasterKeyProvider::absent();
        let key = resolve_master_key(&provider, false, log.as_ref()).unwrap();
        assert_eq!(key.len(), 32);
        // Second resolve returns the SAME key (now persisted in the provider).
        let key2 = resolve_master_key(&provider, false, log.as_ref()).unwrap();
        assert_eq!(key, key2, "master key should persist across resolves");
    }

    /// Replaces the old `gracefully_handles_master_key_recreation`, which
    /// ENCODED the data-loss behaviour as intended. New contract: an absent
    /// key over existing blobs must refuse to regenerate.
    #[test]
    fn resolve_master_key_refuses_when_blobs_exist_and_key_absent() {
        let log = MemoryLogger::new("test");
        let provider = InMemoryMasterKeyProvider::absent();
        let err = resolve_master_key(&provider, true, log.as_ref()).unwrap_err();
        assert_eq!(err, KEY_UNRECOVERABLE_MSG, "must not regenerate over blobs");
        // create() must NOT have been called — provider is still absent.
        assert!(matches!(provider.fetch(), MasterKeyOutcome::Absent));
    }

    #[test]
    fn resolve_master_key_does_not_create_on_transient_unavailable() {
        let log = MemoryLogger::new("test");
        let provider = InMemoryMasterKeyProvider::unavailable("keychain locked");
        let err = resolve_master_key(&provider, false, log.as_ref()).unwrap_err();
        assert!(err.contains("Failed to access keychain"), "got: {err}");
        assert!(matches!(provider.fetch(), MasterKeyOutcome::Unavailable(_)));
    }

    /// Manual/local integration coverage of the real macOS keychain via
    /// `KeychainMasterKeyProvider`. `#[ignore]`d so headless/CI runs never
    /// hit the login keychain (the prior cause of 8 env-dependent failures).
    /// Run with `cargo test -- --ignored` on a logged-in macOS session.
    #[test]
    #[ignore]
    fn keychain_provider_create_then_fetch_roundtrip_real_keychain() {
        use crate::connection::secrets::{KeychainMasterKeyProvider, MasterKeyProvider as _};
        use security_framework::passwords::delete_generic_password;
        let _ui = SecKeychain::disable_user_interaction().expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let account = "mongomacapp.test-master-key";
        delete_generic_password(SERVICE, account).ok();
        let provider =
            KeychainMasterKeyProvider::new(SERVICE, account, "test-key", log.child(logctx! {}));
        let created = provider.create().expect("create");
        match provider.fetch() {
            MasterKeyOutcome::Found(fetched) => assert_eq!(&created[..], &fetched[..]),
            other => panic!("expected Found, got something else: {}", matches!(other, MasterKeyOutcome::Found(_))),
        }
        delete_generic_password(SERVICE, account).ok();
    }
}
