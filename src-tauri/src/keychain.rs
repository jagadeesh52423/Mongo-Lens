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
use security_framework::passwords::{delete_generic_password, get_generic_password};
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

/// Gets the master encryption key from Keychain, or creates one if missing.
///
/// The master key is a 256-bit (32-byte) random key used to encrypt all
/// connection passwords. It's stored in Keychain with account
/// `mongomacapp.master-encryption-key` and a self-trusted ACL so that
/// future accesses from this binary don't trigger password prompts.
///
/// If the key doesn't exist, a new one is generated, stored, and returned.
/// If generation/storage fails, returns Err.
fn get_or_create_master_key(log: &dyn Logger) -> Result<Vec<u8>, String> {
    // Try to retrieve existing master key from Keychain
    match get_generic_password(SERVICE, MASTER_KEY_ACCOUNT) {
        Ok(key_bytes) => {
            if key_bytes.len() == MASTER_KEY_SIZE {
                log.debug("master key retrieved", logctx! {
                    "size" => key_bytes.len(),
                });
                return Ok(key_bytes);
            } else {
                log.warn("master key wrong size, regenerating", logctx! {
                    "got" => key_bytes.len(),
                    "expected" => MASTER_KEY_SIZE,
                });
                // Delete the malformed key before regenerating
                delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
                // Fall through to regenerate
            }
        }
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                log.info("master key not found, creating new", logctx! {});
                // Fall through to create new key
            } else {
                log.error("keychain access failed", logctx! {
                    "err" => e.to_string(),
                });
                return Err(format!("Failed to access keychain: {}", e));
            }
        }
    }

    // Generate a new 256-bit master key
    let mut key = vec![0u8; MASTER_KEY_SIZE];
    OsRng.fill_bytes(&mut key);

    log.info("generated new master key", logctx! {
        "size" => key.len(),
    });

    // Store the master key in Keychain
    let keychain = SecKeychain::default().map_err(|e| {
        log.error("keychain default failed", logctx! {
            "err" => e.to_string(),
        });
        e.to_string()
    })?;

    // Use legacy API to capture item ref and apply self-trusted ACL
    let (status, item_ref) = unsafe {
        let mut item_ref: SecKeychainItemRef = ptr::null_mut();
        let status = SecKeychainAddGenericPassword(
            keychain.as_concrete_TypeRef() as *mut _,
            SERVICE.len() as u32,
            SERVICE.as_ptr().cast(),
            MASTER_KEY_ACCOUNT.len() as u32,
            MASTER_KEY_ACCOUNT.as_ptr().cast(),
            key.len() as u32,
            key.as_ptr().cast(),
            &mut item_ref,
        );
        (status, item_ref)
    };

    if status == errSecSuccess {
        // Apply self-trusted ACL so future accesses don't prompt
        if !item_ref.is_null() {
            let item = unsafe { SecKeychainItem::wrap_under_create_rule(item_ref) };
            apply_self_trusted_acl(&item, "master-key", log);
        }
        log.info("master key stored successfully", logctx! {});
        Ok(key)
    } else if status == -25299 {
        // errSecDuplicateItem: another process/thread created the key
        // between our check and store. Retrieve the existing one.
        log.info("master key already exists (concurrent create), retrieving", logctx! {});
        get_generic_password(SERVICE, MASTER_KEY_ACCOUNT)
            .map_err(|e| format!("Failed to retrieve master key after duplicate: {}", e))
    } else {
        log.error("master key storage failed", logctx! {
            "status" => status,
        });
        Err(format!("Failed to store master key: OSStatus {}", status))
    }
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

    // Get or create master key
    let master_key = get_or_create_master_key(log)?;

    // Encrypt password
    let encrypted = encrypt_password(password, &master_key)?;

    // Ensure encrypted directory exists
    let dir = ensure_encrypted_dir()?;
    let file_path = dir.join(format!("{}.bin", connection_id));

    // Write encrypted data atomically
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
    use crate::logger::MemoryLogger;
    use std::sync::Mutex;

    /// Serializes master key tests that share the same keychain item.
    /// Parallel keychain access to the same item causes macOS ACL races.
    static MASTER_KEY_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn get_or_create_master_key_generates_32_bytes() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        // Clean slate: remove any leftover master key from prior test runs
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();

        let log = MemoryLogger::new("test");
        let key = get_or_create_master_key(log.as_ref()).unwrap();
        assert_eq!(key.len(), 32);

        // Cleanup
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn get_or_create_master_key_returns_same_key_twice() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        // Clean slate: remove any leftover master key from prior test runs
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();

        let log = MemoryLogger::new("test");
        let key1 = get_or_create_master_key(log.as_ref()).unwrap();
        let key2 = get_or_create_master_key(log.as_ref()).unwrap();
        assert_eq!(key1, key2, "master key should persist across calls");

        // Cleanup
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn encrypt_decrypt_password_roundtrip() {
        let key = vec![42u8; 32]; // Dummy 256-bit key
        let password = "my-secret-password";

        let encrypted = encrypt_password(password, &key).unwrap();
        assert!(encrypted.len() > password.len(), "encrypted should be larger (nonce + tag)");

        let decrypted = decrypt_password(&encrypted, &key).unwrap();
        assert_eq!(decrypted, password);
    }

    #[test]
    fn encrypt_password_produces_unique_ciphertexts() {
        let key = vec![42u8; 32];
        let password = "same-password";

        let encrypted1 = encrypt_password(password, &key).unwrap();
        let encrypted2 = encrypt_password(password, &key).unwrap();

        assert_ne!(encrypted1, encrypted2, "each encryption should use unique nonce");
    }

    #[test]
    fn ensure_encrypted_dir_creates_directory() {
        let original_home = std::env::var("HOME").ok();
        let test_dir = std::env::temp_dir().join(format!("mongomacapp-test-{}", uuid::Uuid::new_v4()));
        std::env::set_var("HOME", test_dir.to_str().unwrap());

        let dir = ensure_encrypted_dir().unwrap();
        assert!(dir.exists());
        assert!(dir.is_dir());

        // Cleanup: restore original HOME to avoid poisoning parallel tests
        fs::remove_dir_all(&test_dir).ok();
        match original_home {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn atomic_write_file_creates_file() {
        let test_dir = std::env::temp_dir();
        let test_file = test_dir.join(format!("test-{}.bin", uuid::Uuid::new_v4()));
        let data = b"test data";

        atomic_write_file(&test_file, data).unwrap();

        let read_data = fs::read(&test_file).unwrap();
        assert_eq!(read_data, data);

        // Cleanup
        fs::remove_file(&test_file).ok();
    }

    #[test]
    fn set_password_new_impl_creates_encrypted_file() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let test_id = format!("test-{}", uuid::Uuid::new_v4());

        set_password(&test_id, "test-password", log.as_ref()).unwrap();

        // Verify encrypted file exists
        let dir = ensure_encrypted_dir().unwrap();
        let file_path = dir.join(format!("{}.bin", test_id));
        assert!(file_path.exists());

        // Cleanup
        delete_password(&test_id, log.as_ref()).ok();
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn get_password_new_impl_returns_decrypted() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let test_id = format!("test-{}", uuid::Uuid::new_v4());
        let password = "my-test-password";

        set_password(&test_id, password, log.as_ref()).unwrap();
        let retrieved = get_password(&test_id, log.as_ref()).unwrap();

        assert_eq!(retrieved, Some(password.to_string()));

        // Cleanup
        delete_password(&test_id, log.as_ref()).ok();
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn delete_password_removes_encrypted_file() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let test_id = format!("test-{}", uuid::Uuid::new_v4());

        set_password(&test_id, "test", log.as_ref()).unwrap();

        let dir = ensure_encrypted_dir().unwrap();
        let file_path = dir.join(format!("{}.bin", test_id));
        assert!(file_path.exists());

        delete_password(&test_id, log.as_ref()).unwrap();
        assert!(!file_path.exists());

        // Cleanup
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn get_password_returns_none_for_missing_file() {
        let log = MemoryLogger::new("test");
        let test_id = format!("nonexistent-{}", uuid::Uuid::new_v4());

        let result = get_password(&test_id, log.as_ref()).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2", log.as_ref()).unwrap();
        let got = get_password(&id, log.as_ref()).unwrap();
        assert_eq!(got.as_deref(), Some("hunter2"));
        delete_password(&id, log.as_ref()).unwrap();
        let after = get_password(&id, log.as_ref()).unwrap();
        assert!(after.is_none());

        // Cleanup
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn get_password_handles_corrupted_file() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let test_id = format!("test-{}", uuid::Uuid::new_v4());

        // Write corrupted data (too short)
        let dir = ensure_encrypted_dir().unwrap();
        let file_path = dir.join(format!("{}.bin", test_id));
        fs::write(&file_path, b"corrupted").unwrap();

        let result = get_password(&test_id, log.as_ref());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));

        // Cleanup
        fs::remove_file(&file_path).ok();
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }

    #[test]
    fn decrypt_password_fails_with_wrong_key() {
        let key1 = vec![1u8; 32];
        let key2 = vec![2u8; 32];
        let password = "secret";

        let encrypted = encrypt_password(password, &key1).unwrap();
        let result = decrypt_password(&encrypted, &key2);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Decryption failed"));
    }

    #[test]
    fn get_password_gracefully_handles_master_key_recreation() {
        let _lock = MASTER_KEY_LOCK.lock().unwrap();
        let _ui_lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");
        let log = MemoryLogger::new("test");
        let test_id = format!("test-{}", uuid::Uuid::new_v4());

        // Set password with initial master key
        set_password(&test_id, "password1", log.as_ref()).unwrap();

        // Delete master key (simulating loss)
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();

        // Getting password should fail (old key gone, file encrypted with it)
        let result = get_password(&test_id, log.as_ref());
        assert!(result.is_err(), "should fail to decrypt with recreated key");

        // But setting a new password should work (creates new master key)
        set_password(&test_id, "password2", log.as_ref()).unwrap();
        let retrieved = get_password(&test_id, log.as_ref()).unwrap();
        assert_eq!(retrieved, Some("password2".to_string()));

        // Cleanup
        delete_password(&test_id, log.as_ref()).ok();
        delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
    }
}
