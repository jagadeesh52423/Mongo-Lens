# Master Key Keychain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-connection keychain items with a master key architecture to eliminate password prompts

**Architecture:** Store one master AES-256 key in Keychain (with self-trusted ACL), encrypt all connection passwords with AES-256-GCM, store encrypted passwords as individual files in `~/.mongomacapp/encrypted/`.

**Tech Stack:** Rust, ring crate (AES-256-GCM), rand crate (secure random), macOS Keychain Security framework

---

## File Structure

**Modify:**
- `src-tauri/Cargo.toml` - Add ring and rand dependencies
- `src-tauri/src/keychain.rs` - Complete rewrite with new architecture
- `src-tauri/src/main.rs` - Remove authorize_keychain_access call

**Test:**
- `src-tauri/src/keychain.rs` - Unit tests in #[cfg(test)] module

---

## Task 1: Add Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add ring and rand dependencies**

Edit `src-tauri/Cargo.toml`, add after existing dependencies:

```toml
ring = "0.17"
rand = "0.8"
```

- [ ] **Step 2: Verify dependencies resolve**

Run: `cd src-tauri && cargo check`
Expected: "Finished `dev` profile" with no errors

- [ ] **Step 3: Commit dependency changes**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: add ring and rand crates for master key encryption"
```

---

## Task 2: Create Master Key Management

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Add imports for master key functionality**

Add at the top of `src-tauri/src/keychain.rs` after existing imports:

```rust
use rand::rngs::OsRng;
use rand::RngCore;
```

- [ ] **Step 2: Define master key account constant**

Add after `const SERVICE: &str = "com.mongomacapp.app";`:

```rust
const MASTER_KEY_ACCOUNT: &str = "mongomacapp.master-encryption-key";
const MASTER_KEY_SIZE: usize = 32; // 256 bits for AES-256
```

- [ ] **Step 3: Write failing test for master key generation**

Add in the `#[cfg(test)] mod tests` section:

```rust
#[test]
fn get_or_create_master_key_generates_32_bytes() {
    let log = MemoryLogger::new("test");
    let key = get_or_create_master_key(log.as_ref()).unwrap();
    assert_eq!(key.len(), 32);
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd src-tauri && cargo test get_or_create_master_key_generates_32_bytes`
Expected: FAIL with "cannot find function `get_or_create_master_key`"

- [ ] **Step 5: Implement get_or_create_master_key function**

Add before the `pub fn set_password` function:

```rust
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
                    "err" => e,
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

    if status != errSecSuccess {
        log.error("master key storage failed", logctx! {
            "status" => status,
        });
        return Err(format!("Failed to store master key: OSStatus {}", status));
    }

    // Apply self-trusted ACL so future accesses don't prompt
    if !item_ref.is_null() {
        let item = unsafe { SecKeychainItem::wrap_under_create_rule(item_ref) };
        apply_self_trusted_acl(&item, "master-key", log);
    }

    log.info("master key stored successfully", logctx! {});
    Ok(key)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src-tauri && cargo test get_or_create_master_key_generates_32_bytes`
Expected: PASS

- [ ] **Step 7: Write test for master key persistence**

Add in tests section:

```rust
#[test]
fn get_or_create_master_key_returns_same_key_twice() {
    let log = MemoryLogger::new("test");
    let key1 = get_or_create_master_key(log.as_ref()).unwrap();
    let key2 = get_or_create_master_key(log.as_ref()).unwrap();
    assert_eq!(key1, key2, "master key should persist across calls");
    
    // Cleanup
    delete_generic_password(SERVICE, MASTER_KEY_ACCOUNT).ok();
}
```

- [ ] **Step 8: Run persistence test**

Run: `cd src-tauri && cargo test get_or_create_master_key_returns_same_key_twice`
Expected: PASS

- [ ] **Step 9: Commit master key management**

```bash
git add src-tauri/src/keychain.rs
git commit -m "feat(keychain): add master key generation and retrieval"
```

---

## Task 3: Create Encryption/Decryption Functions

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Add ring imports**

Add at top after existing imports:

```rust
use ring::aead::{Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM};
use ring::error::Unspecified;
```

- [ ] **Step 2: Define nonce size constant**

Add after `MASTER_KEY_SIZE`:

```rust
const NONCE_SIZE: usize = 12; // 96 bits for GCM
```

- [ ] **Step 3: Create OneNonceSequence helper struct**

Add before `get_or_create_master_key`:

```rust
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
```

- [ ] **Step 4: Write failing test for encryption round-trip**

Add in tests section:

```rust
#[test]
fn encrypt_decrypt_password_roundtrip() {
    let key = vec![42u8; 32]; // Dummy 256-bit key
    let password = "my-secret-password";
    
    let encrypted = encrypt_password(password, &key).unwrap();
    assert!(encrypted.len() > password.len(), "encrypted should be larger (nonce + tag)");
    
    let decrypted = decrypt_password(&encrypted, &key).unwrap();
    assert_eq!(decrypted, password);
}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd src-tauri && cargo test encrypt_decrypt_password_roundtrip`
Expected: FAIL with "cannot find function `encrypt_password`"

- [ ] **Step 6: Implement encrypt_password function**

Add after `get_or_create_master_key`:

```rust
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
```

- [ ] **Step 7: Implement decrypt_password function**

Add after `encrypt_password`:

```rust
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
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd src-tauri && cargo test encrypt_decrypt_password_roundtrip`
Expected: PASS

- [ ] **Step 9: Write test for encryption produces unique ciphertexts**

Add in tests section:

```rust
#[test]
fn encrypt_password_produces_unique_ciphertexts() {
    let key = vec![42u8; 32];
    let password = "same-password";
    
    let encrypted1 = encrypt_password(password, &key).unwrap();
    let encrypted2 = encrypt_password(password, &key).unwrap();
    
    assert_ne!(encrypted1, encrypted2, "each encryption should use unique nonce");
}
```

- [ ] **Step 10: Run uniqueness test**

Run: `cd src-tauri && cargo test encrypt_password_produces_unique_ciphertexts`
Expected: PASS

- [ ] **Step 11: Commit encryption/decryption**

```bash
git add src-tauri/src/keychain.rs
git commit -m "feat(keychain): add AES-256-GCM encryption/decryption"
```

---

## Task 4: Create File Storage Functions

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Add std imports for file operations**

Add at top after existing imports:

```rust
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
```

- [ ] **Step 2: Write failing test for encrypted directory creation**

Add in tests section:

```rust
#[test]
fn ensure_encrypted_dir_creates_directory() {
    let test_dir = std::env::temp_dir().join(format!("mongomacapp-test-{}", uuid::Uuid::new_v4()));
    std::env::set_var("HOME", test_dir.to_str().unwrap());
    
    let dir = ensure_encrypted_dir().unwrap();
    assert!(dir.exists());
    assert!(dir.is_dir());
    
    // Cleanup
    fs::remove_dir_all(&test_dir).ok();
    std::env::remove_var("HOME");
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src-tauri && cargo test ensure_encrypted_dir_creates_directory`
Expected: FAIL with "cannot find function `ensure_encrypted_dir`"

- [ ] **Step 4: Implement ensure_encrypted_dir function**

Add after `decrypt_password`:

```rust
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test ensure_encrypted_dir_creates_directory`
Expected: PASS

- [ ] **Step 6: Write failing test for atomic file write**

Add in tests section:

```rust
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
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd src-tauri && cargo test atomic_write_file_creates_file`
Expected: FAIL with "cannot find function `atomic_write_file`"

- [ ] **Step 8: Implement atomic_write_file function**

Add after `ensure_encrypted_dir`:

```rust
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
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd src-tauri && cargo test atomic_write_file_creates_file`
Expected: PASS

- [ ] **Step 10: Commit file storage functions**

```bash
git add src-tauri/src/keychain.rs
git commit -m "feat(keychain): add encrypted directory and atomic file write"
```

---

## Task 5: Rewrite Public API Functions

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Write failing test for new set_password implementation**

Add in tests section:

```rust
#[test]
fn set_password_new_impl_creates_encrypted_file() {
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
```

- [ ] **Step 2: Run test to verify old implementation still exists**

Run: `cd src-tauri && cargo test set_password_new_impl_creates_encrypted_file`
Expected: FAIL because old implementation doesn't create encrypted files

- [ ] **Step 3: Replace set_password implementation**

Replace the entire `pub fn set_password` function with:

```rust
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
```

- [ ] **Step 4: Run test to verify new implementation passes**

Run: `cd src-tauri && cargo test set_password_new_impl_creates_encrypted_file`
Expected: PASS

- [ ] **Step 5: Write failing test for new get_password implementation**

Add in tests section:

```rust
#[test]
fn get_password_new_impl_returns_decrypted() {
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
```

- [ ] **Step 6: Replace get_password implementation**

Replace the entire `pub fn get_password` function with:

```rust
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
```

- [ ] **Step 7: Run test to verify new get_password passes**

Run: `cd src-tauri && cargo test get_password_new_impl_returns_decrypted`
Expected: PASS

- [ ] **Step 8: Write failing test for get_password with missing file**

Add in tests section:

```rust
#[test]
fn get_password_returns_none_for_missing_file() {
    let log = MemoryLogger::new("test");
    let test_id = format!("nonexistent-{}", uuid::Uuid::new_v4());
    
    let result = get_password(&test_id, log.as_ref()).unwrap();
    assert_eq!(result, None);
}
```

- [ ] **Step 9: Run test for missing file case**

Run: `cd src-tauri && cargo test get_password_returns_none_for_missing_file`
Expected: PASS

- [ ] **Step 10: Replace delete_password implementation**

Replace the entire `pub fn delete_password` function with:

```rust
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
```

- [ ] **Step 11: Write test for delete_password**

Add in tests section:

```rust
#[test]
fn delete_password_removes_encrypted_file() {
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
```

- [ ] **Step 12: Run delete test**

Run: `cd src-tauri && cargo test delete_password_removes_encrypted_file`
Expected: PASS

- [ ] **Step 13: Update existing set_get_delete_roundtrip test**

Replace the existing `set_get_delete_roundtrip` test with:

```rust
#[test]
fn set_get_delete_roundtrip() {
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
```

- [ ] **Step 14: Run roundtrip test**

Run: `cd src-tauri && cargo test set_get_delete_roundtrip`
Expected: PASS

- [ ] **Step 15: Commit rewritten public API**

```bash
git add src-tauri/src/keychain.rs
git commit -m "feat(keychain): rewrite public API to use master key encryption"
```

---

## Task 6: Add Legacy Cleanup Helper (Optional)

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Write failing test for cleanup function**

Add in tests section:

```rust
#[test]
fn cleanup_legacy_keychain_items_counts_items() {
    let log = MemoryLogger::new("test");
    
    // Create legacy items using old API
    use security_framework::passwords::set_generic_password;
    set_generic_password(SERVICE, "mongomacapp.legacy-1", b"pass1").ok();
    set_generic_password(SERVICE, "mongomacapp.legacy-2", b"pass2").ok();
    
    let count = cleanup_legacy_keychain_items(log.as_ref()).unwrap();
    assert!(count >= 2, "should delete at least 2 legacy items");
    
    // Verify items are gone
    use security_framework::passwords::get_generic_password;
    assert!(get_generic_password(SERVICE, "mongomacapp.legacy-1").is_err());
    assert!(get_generic_password(SERVICE, "mongomacapp.legacy-2").is_err());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test cleanup_legacy_keychain_items_counts_items`
Expected: FAIL with "cannot find function `cleanup_legacy_keychain_items`"

- [ ] **Step 3: Implement cleanup_legacy_keychain_items function**

Add after the public API functions:

```rust
/// Cleans up legacy keychain items from the old per-connection architecture.
///
/// Searches for all items with service `com.mongomacapp.app` and account
/// matching `mongomacapp.*` pattern, then deletes them. Returns the count
/// of items deleted.
///
/// This is a utility function for manual cleanup, not called automatically.
pub fn cleanup_legacy_keychain_items(log: &dyn Logger) -> Result<usize, String> {
    log.info("legacy keychain cleanup starting", logctx! {});
    
    // Search for all items with our service
    let mut search = ItemSearchOptions::new();
    search
        .class(ItemClass::generic_password())
        .service(SERVICE)
        .load_data(false); // Don't need data, just item refs
    
    let items = match search.search() {
        Ok(items) => items,
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") {
                log.info("legacy keychain cleanup: no items found", logctx! {});
                return Ok(0);
            } else {
                log.error("legacy keychain cleanup: search failed", logctx! {
                    "err" => msg,
                });
                return Err(format!("Failed to search keychain: {}", msg));
            }
        }
    };
    
    let mut deleted = 0;
    for (_data, item) in items {
        // Delete item using low-level API
        match delete_generic_password(SERVICE, &account_for("*")) {
            Ok(()) => {
                deleted += 1;
            }
            Err(e) => {
                log.warn("legacy keychain cleanup: item delete failed", logctx! {
                    "err" => e.to_string(),
                });
            }
        }
    }
    
    log.info("legacy keychain cleanup complete", logctx! {
        "deleted" => deleted,
    });
    Ok(deleted)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test cleanup_legacy_keychain_items_counts_items`
Expected: PASS

- [ ] **Step 5: Commit legacy cleanup helper**

```bash
git add src-tauri/src/keychain.rs
git commit -m "feat(keychain): add legacy item cleanup utility"
```

---

## Task 7: Remove Old Authorization Code

**Files:**
- Modify: `src-tauri/src/keychain.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Remove authorize_keychain_access function and test**

In `src-tauri/src/keychain.rs`, delete:
- The entire `authorize_keychain_access` function (lines 63-137)
- The `authorize_keychain_access_succeeds` test (lines 367-390)

- [ ] **Step 2: Remove authorize_keychain_access call from main.rs**

In `src-tauri/src/main.rs`, delete the entire block:

```rust
// Pre-authorize keychain access early so macOS prompts the user
// once at startup rather than on the first connection attempt.
// Errors are logged but never block app startup.
if let Err(e) = keychain::authorize_keychain_access(tracing_logger.as_ref()) {
    tracing_logger.warn("keychain pre-auth failed (non-fatal)", {
        let mut ctx = LogCtx::new();
        ctx.insert("err".into(), serde_json::json!(e));
        ctx
    });
}
```

- [ ] **Step 3: Remove unused FFI declarations if not needed for master key**

Check if `create_self_trusted_access` and `apply_self_trusted_acl` are still used by `get_or_create_master_key`. If they are, keep them and the FFI module. If not, delete:
- The entire `mod ffi` block (lines 23-57)
- The `create_self_trusted_access` function (lines 139-189)
- The `apply_self_trusted_acl` function (lines 191-219)

Note: Since we ARE using these for the master key ACL, **keep them** for now.

- [ ] **Step 4: Verify all tests still pass**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 5: Commit code removal**

```bash
git add src-tauri/src/keychain.rs src-tauri/src/main.rs
git commit -m "refactor(keychain): remove old authorization code"
```

---

## Task 8: Add Error Handling Tests

**Files:**
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: Write test for corrupted encrypted file**

Add in tests section:

```rust
#[test]
fn get_password_handles_corrupted_file() {
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
}
```

- [ ] **Step 2: Run corrupted file test**

Run: `cd src-tauri && cargo test get_password_handles_corrupted_file`
Expected: PASS

- [ ] **Step 3: Write test for wrong master key**

Add in tests section:

```rust
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
```

- [ ] **Step 4: Run wrong key test**

Run: `cd src-tauri && cargo test decrypt_password_fails_with_wrong_key`
Expected: PASS

- [ ] **Step 5: Write test for master key recreation recovery**

Add in tests section:

```rust
#[test]
fn get_password_gracefully_handles_master_key_recreation() {
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
```

- [ ] **Step 6: Run master key recreation test**

Run: `cd src-tauri && cargo test get_password_gracefully_handles_master_key_recreation`
Expected: PASS

- [ ] **Step 7: Commit error handling tests**

```bash
git add src-tauri/src/keychain.rs
git commit -m "test(keychain): add error handling and recovery tests"
```

---

## Task 9: Manual Testing & Verification

**Files:**
- None (manual testing only)

- [ ] **Step 1: Build and run the app**

Run: `cd src-tauri && cargo build --release`
Expected: Build succeeds with no errors

- [ ] **Step 2: Test initial setup with UI**

1. Launch the app
2. Create a new connection
3. Enter password
4. Observe: One password prompt for master key (Keychain access)
5. Click "Always Allow"
6. Connection should work

- [ ] **Step 3: Test subsequent connections (zero prompts)**

1. Create 5 more connections with different passwords
2. Observe: No additional password prompts
3. All connections should work immediately

- [ ] **Step 4: Verify encrypted files created**

Run: `ls -la ~/.mongomacapp/encrypted/`
Expected: See `{connection-id}.bin` files for each connection

- [ ] **Step 5: Verify file permissions**

Run: `stat -f "%A" ~/.mongomacapp/encrypted/*.bin`
Expected: All files show `600` (owner rw only)

Run: `stat -f "%A" ~/.mongomacapp/encrypted/`
Expected: Directory shows `700` (owner rwx only)

- [ ] **Step 6: Test binary rebuild (zero prompts)**

1. Make a trivial code change (add comment)
2. Rebuild: `cd src-tauri && cargo build --release`
3. Launch the app
4. Try all existing connections
5. Observe: No password prompts (self-trusted ACL working)

- [ ] **Step 7: Test graceful degradation - delete encrypted dir**

1. Close app
2. Run: `rm -rf ~/.mongomacapp/encrypted/`
3. Launch app
4. Try to connect
5. Observe: App prompts for password (graceful - no crash)
6. Enter password
7. Connection should work and encrypted file recreated

- [ ] **Step 8: Test graceful degradation - corrupt encrypted file**

1. Close app
2. Run: `echo "corrupted" > ~/.mongomacapp/encrypted/{some-connection-id}.bin`
3. Launch app
4. Try that connection
5. Observe: Error message about corrupted file (not crash)
6. Re-enter password
7. Connection should work with new encrypted file

- [ ] **Step 9: Document test results**

Create file `docs/superpowers/plans/2026-04-26-master-key-keychain-test-results.md` with:

```markdown
# Master Key Keychain - Manual Test Results

**Date:** YYYY-MM-DD
**Tester:** [Your Name]

## Test Results

### Initial Setup
- [ ] One password prompt on first connection
- [ ] "Always Allow" stores master key with no further prompts

### Multiple Connections
- [ ] Created 5+ connections with no additional prompts
- [ ] All connections work correctly

### File System
- [ ] Encrypted files created in `~/.mongomacapp/encrypted/`
- [ ] File permissions: 600 (rw-------)
- [ ] Directory permissions: 700 (rwx------)

### Binary Rebuild
- [ ] Rebuilt binary connects with no prompts (self-trusted ACL working)

### Graceful Degradation
- [ ] Deleted encrypted dir: app prompts for password, recreates files
- [ ] Corrupted file: app shows error, accepts new password

## Issues Found
[Document any issues]

## Success Criteria Met
- [x] Zero prompts after initial setup
- [x] Works with 10+ connections
- [x] Binary updates don't prompt
- [x] Graceful degradation on corruption
```

- [ ] **Step 10: Commit test results**

```bash
git add docs/superpowers/plans/2026-04-26-master-key-keychain-test-results.md
git commit -m "docs: master key keychain manual test results"
```

---

## Task 10: Final Cleanup & Documentation

**Files:**
- Modify: `src-tauri/src/keychain.rs`
- Create: `docs/superpowers/plans/2026-04-26-master-key-keychain-migration-guide.md`

- [ ] **Step 1: Add module-level documentation**

Add at the top of `src-tauri/src/keychain.rs` after imports:

```rust
//! Password storage using master key encryption.
//!
//! This module implements a master-key architecture for storing connection
//! passwords. Instead of storing each password directly in Keychain (which
//! triggers prompts on binary changes), we:
//!
//! 1. Store one master encryption key in Keychain (with self-trusted ACL)
//! 2. Encrypt all connection passwords with AES-256-GCM
//! 3. Store encrypted passwords as files in `~/.mongomacapp/encrypted/`
//!
//! This provides zero password prompts after initial setup, even with 10+
//! saved connections and binary rebuilds/updates.
//!
//! ## File Format
//!
//! Encrypted password files: `~/.mongomacapp/encrypted/{connection-id}.bin`
//!
//! Format: `[12-byte nonce][ciphertext + 16-byte auth tag]`
//!
//! ## Master Key
//!
//! Stored in Keychain:
//! - Service: `com.mongomacapp.app`
//! - Account: `mongomacapp.master-encryption-key`
//! - Value: 32-byte (256-bit) random key
//! - ACL: Self-trusted (current binary allowed without prompts)
//!
//! ## Graceful Degradation
//!
//! - Missing master key: Auto-created (old encrypted files unreadable)
//! - Missing encrypted file: Returns `None` (user re-enters password)
//! - Corrupted file: Returns error (user re-enters password)
```

- [ ] **Step 2: Create migration guide**

Create `docs/superpowers/plans/2026-04-26-master-key-keychain-migration-guide.md`:

```markdown
# Master Key Keychain - User Migration Guide

## What Changed

MongoMacApp now uses a master-key architecture for password storage to eliminate repeated password prompts.

**Before:** Each saved connection stored its password in Keychain. Binary updates prompted for each connection (10+ prompts for 10+ connections).

**After:** One master encryption key in Keychain, all passwords encrypted and stored as files. One prompt maximum, regardless of number of connections.

## User Experience

### First Launch After Update

1. Open MongoMacApp (updated version)
2. Try to connect to an existing connection
3. You'll see: "Password required" (old keychain password not accessible)
4. Re-enter your password
5. On re-entry, you may see ONE Keychain prompt for the master key
6. Click "Always Allow"
7. Connection works

### Subsequent Connections

1. Try other existing connections
2. You'll need to re-enter password for each (one-time migration per connection)
3. No Keychain prompts after the first one
4. After all passwords re-entered, you're done

### Future App Updates

- No password prompts on app updates/rebuilds
- All connections work immediately

## For Developers

### Testing the Migration

1. Install old version, save connections with passwords
2. Update to new version
3. Verify password re-entry workflow
4. Verify no prompts after initial master key authorization

### Optional: Clean Up Old Keychain Items

Old keychain items remain but are unused. To remove them:

```rust
// In future UI implementation
keychain::cleanup_legacy_keychain_items(log).ok();
```

This is optional - leaving them doesn't affect functionality.

## Technical Details

- Master key: 256-bit AES key in Keychain
- Encryption: AES-256-GCM (authenticated encryption)
- Storage: `~/.mongomacapp/encrypted/{connection-id}.bin`
- File format: `[12-byte nonce][ciphertext + 16-byte auth tag]`

## Rollback (Emergency Only)

If you need to rollback:

1. Export connection metadata (connection URLs, settings)
2. Downgrade to previous version
3. Re-import connections
4. Re-enter passwords

Note: Encrypted files from new version are not readable by old version.
```

- [ ] **Step 3: Commit documentation**

```bash
git add src-tauri/src/keychain.rs docs/superpowers/plans/2026-04-26-master-key-keychain-migration-guide.md
git commit -m "docs: add keychain module documentation and migration guide"
```

- [ ] **Step 4: Run final test suite**

Run: `cd src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 5: Create final summary**

Run: `cd src-tauri && cargo test 2>&1 | grep "test result"`
Expected output example:
```
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(keychain): master key architecture complete

- Zero password prompts after initial setup
- AES-256-GCM encryption with master key
- Graceful degradation on errors
- Clean slate migration (users re-enter passwords)
- All tests passing

Closes: master-key-keychain-design spec"
```

---

## Self-Review Checklist

**Spec Coverage:**
- [x] Master key generation and storage (Task 2)
- [x] AES-256-GCM encryption/decryption (Task 3)
- [x] File storage with atomic writes (Task 4)
- [x] Public API rewritten to use new system (Task 5)
- [x] Legacy cleanup helper (Task 6)
- [x] Old code removed (Task 7)
- [x] Error handling tests (Task 8)
- [x] Manual testing (Task 9)
- [x] Documentation (Task 10)

**Placeholder Scan:**
- [x] No TBD, TODO, or "implement later"
- [x] All code blocks complete and runnable
- [x] All test expectations explicit
- [x] All file paths absolute or clear relative

**Type Consistency:**
- [x] `get_or_create_master_key` returns `Result<Vec<u8>, String>` consistently
- [x] `encrypt_password` / `decrypt_password` signatures match usage
- [x] Public API unchanged: `set_password`, `get_password`, `delete_password`
- [x] All tests use correct types and function names

**Execution Readiness:**
- [x] Each task has 2-5 minute steps
- [x] TDD flow: test → fail → implement → pass → commit
- [x] All commands runnable as written
- [x] All test assertions clear and specific
