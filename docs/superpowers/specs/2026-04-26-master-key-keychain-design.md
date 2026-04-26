# Master Key Keychain Architecture

**Date:** 2026-04-26  
**Status:** Approved  
**Author:** Claude Opus 4.7

## Problem Statement

The current keychain implementation creates a separate macOS Keychain item for each saved connection. Legacy keychain items use per-item ACLs, which means:

- Each keychain item requires separate authorization
- When the binary changes (dev rebuild, app update), each connection prompts again
- With 10+ saved connections, users face 10+ password prompts
- The "upfront authorization" approach (commit 0ce834b) only authorizes 1 item at startup via `.limit(1)`, leaving remaining items to prompt on first use

**Goal:** Achieve zero password prompts after initial setup, regardless of number of saved connections or binary changes.

## Solution: Master Key Architecture

Store one master encryption key in Keychain (with self-trusted ACL), encrypt all connection passwords with it, and store encrypted passwords as individual files.

## Architecture Overview

### Three-Layer System

1. **Master Key Layer**
   - Single 256-bit AES key stored in macOS Keychain
   - Account: `mongomacapp.master-encryption-key`
   - Service: `com.mongomacapp.app`
   - Self-trusted ACL applied at creation (no prompts after initial setup)

2. **Encryption Layer**
   - AES-256-GCM for authenticated encryption
   - Unique nonce per encryption operation
   - Prevents tampering via built-in MAC

3. **Storage Layer**
   - Directory: `~/.mongomacapp/encrypted/`
   - Encrypted files: `{connection-id}.bin`
   - One file per saved connection password

### Public API (Unchanged)

```rust
pub fn set_password(connection_id: &str, password: &str, log: &dyn Logger) -> Result<(), String>
pub fn get_password(connection_id: &str, log: &dyn Logger) -> Result<Option<String>, String>
pub fn delete_password(connection_id: &str, log: &dyn Logger) -> Result<(), String>
```

The public API remains identical to maintain compatibility with existing code.

**Internal Flow:**
- `set_password`: Get/create master key → encrypt password → atomic write to `{connection-id}.bin`
- `get_password`: Read `{connection-id}.bin` → get master key → decrypt → return plaintext
- `delete_password`: Remove `{connection-id}.bin` file

## Encryption Details

### Scheme: AES-256-GCM

**Properties:**
- **Confidentiality**: Password encrypted with AES-256
- **Authentication**: Built-in MAC (16-byte authentication tag) prevents tampering
- **Unique nonces**: Each encryption uses cryptographically random 12-byte nonce

**Encrypted File Format:**
```
[12 bytes: nonce][remaining bytes: ciphertext + 16-byte auth tag]
```

Total overhead: 28 bytes (12-byte nonce + 16-byte tag)

### Master Key Generation

**On first use:**
1. Generate 256-bit (32-byte) key using `OsRng` (cryptographically secure)
2. Store in Keychain with account `mongomacapp.master-encryption-key`
3. Apply self-trusted ACL (using existing `create_self_trusted_access` + `apply_self_trusted_acl` logic)
4. Key persists across app updates (ACL trusts binary, no prompts)

**Key Rotation:** Not implemented in initial version. Future enhancement: prefix files with key version number.

### Rust Dependencies

- **`ring` crate**: AES-256-GCM implementation (maintained by Google/Mozilla, widely trusted)
- **`rand` crate**: Secure random generation with `OsRng`

## File Storage

### Directory Structure

```
~/.mongomacapp/
  encrypted/           # Created with mode 0700 (owner rwx only)
    {conn-id-1}.bin    # Each file mode 0600 (owner rw only)
    {conn-id-2}.bin
    ...
```

### File Operations

**Write (Atomic):**
1. Generate nonce, encrypt password with master key
2. Write to `{connection-id}.bin.tmp`
3. Call `fsync()` to ensure data written to disk
4. Rename to `{connection-id}.bin` (atomic on Unix)
5. Set file permissions to `0600`

Atomic rename prevents corruption if process killed mid-write.

**Read:**
1. Read `{connection-id}.bin`
2. Parse: first 12 bytes = nonce, remaining = ciphertext + tag
3. Decrypt using master key + nonce
4. Return plaintext password

**Delete:**
- Remove `{connection-id}.bin` file
- Ignore "file not found" errors (idempotent)

### Directory Initialization

- Create `~/.mongomacapp/encrypted/` on first `set_password` call if missing
- Set directory permissions to `0700` (owner read/write/execute only)
- Log warning but continue if directory creation fails (graceful degradation)

## Migration & Cleanup

### Clean Slate Approach

Existing keychain items (service `com.mongomacapp.app`, accounts like `mongomacapp.{connection-id}`) remain in Keychain but are **not migrated**.

**User Experience:**
1. After upgrade, existing connections appear in UI (connection metadata preserved)
2. When user connects, app doesn't find encrypted file
3. User is prompted to re-enter password
4. Password is encrypted and stored in new system
5. User re-enters passwords on-demand, per connection

**Rationale:**
- Avoids complexity of reading old keychain items (which would trigger prompts anyway)
- Clean separation between old and new systems
- No batch prompts at startup

### Optional: Legacy Cleanup Helper

Provide utility function (not auto-called):

```rust
pub fn cleanup_legacy_keychain_items(log: &dyn Logger) -> Result<usize, String>
```

**Behavior:**
- Search for all items with service `com.mongomacapp.app`
- Delete each one
- Return count of items deleted
- Could be exposed as "Clear Legacy Keychain" button in Settings UI (future enhancement)

### Code Removal

**Delete:**
- `authorize_keychain_access()` function
- Call to `authorize_keychain_access()` in `main.rs`
- `create_self_trusted_access()` and `apply_self_trusted_acl()` functions (replace with new versions for master key only)
- FFI declarations for ACL manipulation (unless reused for master key ACL)

**Keep:**
- Re-use ACL creation logic for master key creation
- Or simplify if only creating one item with ACL (master key)

## Error Handling & Recovery

### Error Categories

**1. Master Key Errors**

| Error | Recovery |
|-------|----------|
| Missing key | Auto-create new master key, log warning, continue |
| Keychain inaccessible | Return error to user (fatal - can't encrypt/decrypt) |
| User denies keychain access | Return error: "Keychain access required for password storage" |

**2. Encryption/Decryption Errors**

| Error | Recovery |
|-------|----------|
| Corrupt encrypted file | Return descriptive error, user re-enters password (overwrites corrupt file) |
| Wrong nonce/tag size | Log error, treat as corrupt file |
| Decryption failure | Log error with connection ID, return error to user |

**3. File System Errors**

| Error | Recovery |
|-------|----------|
| Directory creation fails | Log warning, return error for operation |
| File write fails | Return error to user |
| File read fails (not found) | Return `Ok(None)` - normal case, password not saved yet |
| File read fails (permission denied) | Return error to user |

### Graceful Degradation Principles

- **Master key recreated** → Old encrypted files unreadable, but app continues working (user re-enters passwords)
- **Encrypted file deleted** → User re-enters password for that connection
- **Encrypted file corrupted** → User re-enters password, overwrites corrupt file
- **Directory deleted** → Recreated on next write, user re-enters passwords

**All errors degrade gracefully** - app never becomes unusable, user just needs to re-enter affected passwords.

### Logging Strategy

**Never log:**
- Plaintext passwords
- Master key bytes
- Decrypted data

**Always log:**
- Operation type (set/get/delete)
- Connection ID
- Success/failure status

**Log on error:**
- Error type and message
- Connection ID
- File path (but not contents)

## Security Considerations

### Threat Model

**Protected Against:**
- Casual file system browsing (passwords encrypted at rest)
- Tampering (GCM authentication tag prevents modification)
- Binary updates/rebuilds (self-trusted ACL on master key)

**Not Protected Against:**
- Attacker with access to master key AND encrypted files (can decrypt all passwords)
- Root/admin access (can read keychain, memory, files)
- Memory dumps while passwords in use (plaintext in memory during decryption)

### Trade-offs

**What we gain:**
- Zero password prompts after initial setup
- Simple user experience with 10+ connections
- No ACL migration complexity

**What we give up:**
- Per-connection keychain independence (all passwords protected by one master key)
- iCloud Keychain sync (passwords stored outside system keychain)
- System-level password manager integration

**Comparison to alternatives:**
- Similar security model to 1Password, LastPass (master key protects vault)
- Acceptable for most use cases where convenience is prioritized
- Users with strict per-connection isolation requirements should use alternative approach

## Implementation Notes

### Module Structure

```rust
// keychain.rs
pub fn set_password(...) -> Result<(), String>
pub fn get_password(...) -> Result<Option<String>, String>
pub fn delete_password(...) -> Result<(), String>
pub fn cleanup_legacy_keychain_items(...) -> Result<usize, String>  // Optional utility

// Internal functions:
fn get_or_create_master_key(log: &dyn Logger) -> Result<Vec<u8>, String>
fn encrypt_password(password: &str, master_key: &[u8]) -> Result<Vec<u8>, String>
fn decrypt_password(encrypted: &[u8], master_key: &[u8]) -> Result<String, String>
fn atomic_write_file(path: &Path, data: &[u8]) -> Result<(), String>
fn ensure_encrypted_dir() -> Result<PathBuf, String>
```

### Dependencies to Add

```toml
[dependencies]
ring = "0.17"      # AES-256-GCM
rand = "0.8"       # OsRng for secure random
```

### Testing Strategy

**Unit Tests:**
- Master key generation and retrieval
- Encrypt/decrypt round-trip
- File format parsing (nonce + ciphertext)
- Error cases (missing key, corrupt file, wrong size)

**Integration Tests:**
- Full set/get/delete cycle
- Graceful degradation (missing master key, corrupt file)
- Directory creation and permissions

**Manual Testing:**
- Verify zero prompts after initial setup
- Test with 10+ connections
- Rebuild binary, verify no new prompts
- Delete encrypted dir, verify recovery

## Success Criteria

- ✅ Zero password prompts after initial master key authorization
- ✅ Works with 10+ saved connections without prompting
- ✅ Binary updates/rebuilds don't trigger prompts
- ✅ Graceful degradation when files/keys missing or corrupt
- ✅ Existing public API unchanged (no breaking changes for callers)
- ✅ All existing keychain tests pass or are updated to reflect new behavior

## Future Enhancements (Out of Scope)

- Key rotation support (version encrypted files)
- Backup/restore encrypted passwords
- Export/import password vault
- Optional per-connection keychain mode (for users who need it)
- UI for "Clear Legacy Keychain" button
