//! Slotted secret storage for v2 connections.
//!
//! ## Why a new module
//!
//! The legacy [`crate::keychain`] module stores one password per connection
//! using `<id>.bin` as the file key. The v2 connection model has *several*
//! independent secrets per connection (MongoDB password, SSH password,
//! SSH key passphrase, SOCKS5 proxy password, AWS session token, OIDC
//! refresh token), so a single-slot store does not generalise.
//!
//! This module introduces a [`SecretSlot`] enum (one variant per secret
//! kind) and a [`SecretStore`] trait that operates on the logical key
//! `conn:<id>:<slot>`. The legacy module is left untouched — both code
//! paths coexist until Phase 2 cuts over.
//!
//! ## Extension contract
//!
//! To add a new secret kind:
//!   1. Add a variant to [`SecretSlot`].
//!   2. Add its kebab-case wire name in [`SecretSlot::as_wire`] and the
//!      reverse mapping in [`SecretSlot::from_wire`].
//!   3. (Optional) Add it to [`SecretSlot::ALL`] so iteration-based
//!      utilities pick it up.
//!
//! No call site of the store needs to change.
//!
//! ## Impls in this file
//!
//! * [`MemStore`] — in-memory `HashMap`, used as a mock in unit tests
//!   (and acceptable for ephemeral runtime caches if ever needed).
//! * [`FileEncryptedStore`] — AES-256-GCM-encrypted blobs on disk under
//!   a configurable base dir, with an injected 32-byte master key. The
//!   crypto stack mirrors [`crate::keychain`] (which the plan forbids
//!   modifying). [`open_default_keychain_store`] wires the prod path:
//!   master key from the macOS Keychain, blobs at
//!   `~/.mongomacapp/secrets/`.
//!
//! ## Phase 2 hardening (tracked, non-blocking for Phase 1)
//!
//! 1. `FileEncryptedStore::delete_all_for` matches `conn-{id}-…\.bin` by
//!    prefix only. Connection ids are UUIDs in practice, so a prefix
//!    collision is statistically impossible today. After matching,
//!    verify the trailing component (before `.bin`) is a known
//!    `SecretSlot::ALL.as_wire()` value to close the door if id
//!    semantics ever change.
//! 2. `fetch_or_create_master_key` silently overwrites a Keychain
//!    entry of the wrong length. Add a `log::warn!` (or thread a
//!    `&dyn Logger` through) so a recurring "key wrong size,
//!    regenerated" pattern is debuggable rather than invisible.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rand::rngs::OsRng;
use rand::RngCore;
use ring::aead::{
    Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM,
};
use ring::error::Unspecified;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use thiserror::Error;

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/// Per-connection secret kinds. Each variant maps to exactly one stored
/// value for a given connection id.
///
/// Wire names are the canonical contract — Phase 1 plan §Migration
/// references them by string ("auth-password" in particular). Renaming a
/// variant is a free Rust-side refactor; renaming its `as_wire` output is
/// a breaking change that orphans every secret already on disk.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SecretSlot {
    /// Password for any plaintext-credential MongoDB auth mode
    /// (SCRAM / LDAP / legacy CR). Plan §Migration writes the legacy
    /// keychain password to this slot on dual-table sync.
    AuthPassword,
    /// Password for SSH tunnel password auth (`SshAuth::Password`).
    SshPassword,
    /// Passphrase protecting an SSH private key (`SshAuth::Key { has_passphrase: true }`).
    SshKeyPassphrase,
    /// Password for an authenticating proxy (`Proxy { auth: Some(_) }`).
    ProxyPassword,
    /// AWS IAM secret access key (long-lived credential paired with
    /// `AuthMode::AwsIam { access_key_id }`). The `sessionToken` field on
    /// `AuthMode::AwsIam` is a short-lived STS-derived value and is
    /// carried as a plaintext model field, not stored here — if a future
    /// flow needs to cache it across launches, add a new `AwsSessionToken`
    /// slot rather than overloading this one.
    AwsSecretKey,
    /// OIDC refresh token cached after first device-code flow.
    OidcRefreshToken,
}

impl SecretSlot {
    /// Every variant, in declaration order. Used for housekeeping
    /// (e.g. `delete_all_for` mock implementations that iterate slots).
    pub const ALL: &'static [SecretSlot] = &[
        SecretSlot::AuthPassword,
        SecretSlot::SshPassword,
        SecretSlot::SshKeyPassphrase,
        SecretSlot::ProxyPassword,
        SecretSlot::AwsSecretKey,
        SecretSlot::OidcRefreshToken,
    ];

    /// Stable kebab-case spelling used in the wire key and in filenames.
    /// Renaming a wire string is a breaking change — adding a new variant
    /// is not.
    pub fn as_wire(self) -> &'static str {
        match self {
            SecretSlot::AuthPassword => "auth-password",
            SecretSlot::SshPassword => "ssh-password",
            SecretSlot::SshKeyPassphrase => "ssh-key-passphrase",
            SecretSlot::ProxyPassword => "proxy-password",
            SecretSlot::AwsSecretKey => "aws-secret-key",
            SecretSlot::OidcRefreshToken => "oidc-refresh-token",
        }
    }

    /// Inverse of [`as_wire`]. Returns `None` for unknown spellings — the
    /// caller decides whether that's an error.
    pub fn from_wire(s: &str) -> Option<SecretSlot> {
        Self::ALL.iter().copied().find(|slot| slot.as_wire() == s)
    }
}

/// Logical key for a stored secret: `conn:<id>:<slot>`. Used in logs and
/// (after light translation to a filesystem-safe form) in on-disk paths.
/// Currently consumed only by `MemStore` (test mock) and unit tests; the
/// `FileEncryptedStore` path derives its filesystem key internally.
#[allow(dead_code)]
pub fn wire_key(connection_id: &str, slot: SecretSlot) -> String {
    format!("conn:{connection_id}:{}", slot.as_wire())
}

#[derive(Debug, Error)]
pub enum SecretError {
    /// The macOS Keychain returned an error fetching or storing the
    /// master key.
    #[error("keychain master key error: {0}")]
    MasterKey(String),
    /// AES-GCM seal/open failed, or the stored blob is structurally
    /// malformed (too short, wrong nonce length, etc.).
    #[error("crypto error: {0}")]
    Crypto(String),
    /// A filesystem read/write/create failed.
    #[error("io error: {0}")]
    Io(String),
    /// A connection id is unsafe to embed in a filesystem path
    /// (contains `/`, `\`, `\0`, `:` or starts with `.`).
    #[error("invalid connection id: {0}")]
    InvalidId(String),
}

impl From<std::io::Error> for SecretError {
    fn from(err: std::io::Error) -> Self {
        SecretError::Io(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SecretError>;

/// Storage abstraction for slotted per-connection secrets.
///
/// Implementations must be `Send + Sync` so they can sit behind an
/// `Arc` inside the Tauri `AppState`.
///
/// Implement this trait to add a new backend (e.g. a Vault adapter for
/// enterprise deployments). No call site needs updating.
pub trait SecretStore: Send + Sync {
    /// Insert-or-replace the secret stored at (`connection_id`, `slot`).
    fn set(&self, connection_id: &str, slot: SecretSlot, value: &str) -> Result<()>;

    /// Fetch the secret stored at (`connection_id`, `slot`). `Ok(None)`
    /// if no value has ever been set (distinct from a real failure).
    /// Phase 1 IPC commands don't read individual slots back (the dialog
    /// holds form values in memory until save) — this stays in the trait
    /// as a contract for future read-side code and tests.
    #[allow(dead_code)]
    fn get(&self, connection_id: &str, slot: SecretSlot) -> Result<Option<String>>;

    /// Delete one (`connection_id`, `slot`) pair. Missing pair is a no-op.
    /// Not yet called by IPC — Phase 1 uses `delete_all_for` on full
    /// connection delete. Kept in the trait for completeness and tests.
    #[allow(dead_code)]
    fn delete(&self, connection_id: &str, slot: SecretSlot) -> Result<()>;

    /// Delete every slot belonging to `connection_id`. Returns the number
    /// of entries actually removed (useful for assertions and logging).
    /// Called by the connection-delete path so leftover secrets don't
    /// outlive their owner.
    fn delete_all_for(&self, connection_id: &str) -> Result<usize>;
}

// ──────────────────────────────────────────────────────────────────────────
// MemStore — in-memory mock
// ──────────────────────────────────────────────────────────────────────────

/// In-memory [`SecretStore`] backed by a `HashMap`. Primarily used as a
/// test mock; safe to use as a runtime cache if ever needed. The bin
/// target never instantiates this — runtime uses `FileEncryptedStore`
/// via `open_default_keychain_store` — so it carries `#[allow(dead_code)]`
/// on the constructor/internal helpers.
///
/// `Mutex` (not `RwLock`) because the access pattern is balanced
/// reads + writes and the critical sections are tiny.
#[derive(Default, Debug)]
#[allow(dead_code)]
pub struct MemStore {
    inner: Mutex<HashMap<String, String>>,
}

#[allow(dead_code)]
impl MemStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        // A poisoned mutex here would mean a previous panic happened
        // *inside* a `MemStore` operation, which is unrecoverable for
        // in-memory state. Propagate by panicking — there's no useful
        // continuation.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Prefix shared by every entry belonging to a single connection id.
    /// Used by [`delete_all_for`] to identify keys to evict.
    fn id_prefix(connection_id: &str) -> String {
        format!("conn:{connection_id}:")
    }
}

impl SecretStore for MemStore {
    fn set(&self, connection_id: &str, slot: SecretSlot, value: &str) -> Result<()> {
        self.locked()
            .insert(wire_key(connection_id, slot), value.to_string());
        Ok(())
    }

    fn get(&self, connection_id: &str, slot: SecretSlot) -> Result<Option<String>> {
        Ok(self.locked().get(&wire_key(connection_id, slot)).cloned())
    }

    fn delete(&self, connection_id: &str, slot: SecretSlot) -> Result<()> {
        self.locked().remove(&wire_key(connection_id, slot));
        Ok(())
    }

    fn delete_all_for(&self, connection_id: &str) -> Result<usize> {
        let prefix = Self::id_prefix(connection_id);
        let mut guard = self.locked();
        let to_remove: Vec<String> = guard
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in &to_remove {
            guard.remove(key);
        }
        Ok(to_remove.len())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FileEncryptedStore — AES-256-GCM blobs on disk
// ──────────────────────────────────────────────────────────────────────────

/// Bytes of a 256-bit AES key.
const MASTER_KEY_SIZE: usize = 32;
/// Bytes of an AES-GCM nonce (96 bits, the standard).
const NONCE_SIZE: usize = 12;
/// Bytes of the AES-GCM auth tag appended after the ciphertext.
/// Only `aead_open` (read path) and tests reference this — neither is
/// reachable from the bin entry yet (IPC `save` flow is write-only).
#[allow(dead_code)]
const TAG_SIZE: usize = 16;

/// macOS Keychain service / account for the v2 secret store's master key.
/// Distinct from the legacy [`crate::keychain`] entry so the two paths
/// can be reasoned about independently and either can be rotated without
/// affecting the other.
const KEYCHAIN_SERVICE: &str = "com.mongomacapp.app";
const MASTER_KEY_ACCOUNT_V2: &str = "mongomacapp.connections-v2-master-key";

/// File-backed [`SecretStore`] using AES-256-GCM.
///
/// The on-disk layout for one secret is `{base_dir}/conn-{id}-{slot}.bin`
/// containing `[12-byte nonce][ciphertext + 16-byte auth tag]` — identical
/// to the legacy [`crate::keychain`] format so a future migration can
/// transcrypt blobs in place.
///
/// The master key and base dir are injected (rather than fetched
/// internally) so unit tests can build a store against a tempdir + a
/// fixed key, exercising the file-naming and `delete_all_for` logic
/// without touching the real macOS Keychain.
pub struct FileEncryptedStore {
    base_dir: PathBuf,
    master_key: Vec<u8>,
}

// Custom Debug — never leak the master key bytes in logs / panic dumps.
impl std::fmt::Debug for FileEncryptedStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileEncryptedStore")
            .field("base_dir", &self.base_dir)
            .field("master_key", &format_args!("<redacted; {} bytes>", self.master_key.len()))
            .finish()
    }
}

impl FileEncryptedStore {
    /// Construct directly with caller-supplied master key + base dir.
    /// Validates the key length and ensures the dir exists with 0700.
    pub fn new(base_dir: PathBuf, master_key: Vec<u8>) -> Result<Self> {
        if master_key.len() != MASTER_KEY_SIZE {
            return Err(SecretError::MasterKey(format!(
                "expected {MASTER_KEY_SIZE}-byte master key, got {}",
                master_key.len()
            )));
        }
        ensure_dir_0700(&base_dir)?;
        Ok(Self {
            base_dir,
            master_key,
        })
    }

    /// File-naming convention: `conn-{id}-{slot}.bin`. The `conn-{id}-`
    /// prefix is what [`delete_all_for`] uses to find every blob owned
    /// by one connection. Connection ids are UUIDs in practice — their
    /// internal dashes don't conflict with the prefix scan because the
    /// slot wire-name is always appended on the right.
    fn path_for(&self, connection_id: &str, slot: SecretSlot) -> Result<PathBuf> {
        let id = validated_id(connection_id)?;
        Ok(self
            .base_dir
            .join(format!("conn-{id}-{}.bin", slot.as_wire())))
    }

    fn id_filename_prefix(connection_id: &str) -> Result<String> {
        let id = validated_id(connection_id)?;
        Ok(format!("conn-{id}-"))
    }
}

impl SecretStore for FileEncryptedStore {
    fn set(&self, connection_id: &str, slot: SecretSlot, value: &str) -> Result<()> {
        let encrypted = aead_seal(value.as_bytes(), &self.master_key)?;
        let path = self.path_for(connection_id, slot)?;
        atomic_write_0600(&path, &encrypted)
    }

    fn get(&self, connection_id: &str, slot: SecretSlot) -> Result<Option<String>> {
        let path = self.path_for(connection_id, slot)?;
        match fs::read(&path) {
            Ok(bytes) => {
                let plaintext = aead_open(&bytes, &self.master_key)?;
                let s = String::from_utf8(plaintext).map_err(|e| {
                    SecretError::Crypto(format!("decrypted bytes not utf-8: {e}"))
                })?;
                Ok(Some(s))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn delete(&self, connection_id: &str, slot: SecretSlot) -> Result<()> {
        let path = self.path_for(connection_id, slot)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err.into()),
        }
    }

    fn delete_all_for(&self, connection_id: &str) -> Result<usize> {
        let prefix = Self::id_filename_prefix(connection_id)?;
        let mut removed = 0usize;
        for entry in fs::read_dir(&self.base_dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let name = match file_name.to_str() {
                Some(n) => n,
                // Skip non-UTF8 names — they were not written by us.
                None => continue,
            };
            if !name.starts_with(&prefix) || !name.ends_with(".bin") {
                continue;
            }
            match fs::remove_file(entry.path()) {
                Ok(()) => removed += 1,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
        }
        Ok(removed)
    }
}

/// Production constructor. Fetches (or creates) the v2 master key from
/// the macOS Keychain and stores blobs under `~/.mongomacapp/secrets/`.
///
/// Kept separate from [`FileEncryptedStore::new`] so the constructor
/// itself stays trivially testable.
pub fn open_default_keychain_store() -> Result<FileEncryptedStore> {
    let master_key = fetch_or_create_master_key()?;
    let base_dir = default_secrets_dir()?;
    FileEncryptedStore::new(base_dir, master_key)
}

// ──────────────────────────────────────────────────────────────────────────
// Internals — Keychain access, dir handling, AES-GCM
// ──────────────────────────────────────────────────────────────────────────

fn default_secrets_dir() -> Result<PathBuf> {
    let home =
        std::env::var("HOME").map_err(|_| SecretError::Io("HOME not set".to_string()))?;
    Ok(PathBuf::from(home).join(".mongomacapp").join("secrets"))
}

fn fetch_or_create_master_key() -> Result<Vec<u8>> {
    match get_generic_password(KEYCHAIN_SERVICE, MASTER_KEY_ACCOUNT_V2) {
        Ok(bytes) if bytes.len() == MASTER_KEY_SIZE => Ok(bytes),
        Ok(bytes) => {
            // Wrong size on disk — overwrite with a fresh key. We could
            // refuse instead, but that would leave the app permanently
            // broken if a tester or migration ever stored a malformed
            // entry.
            let _ = delete_generic_password(KEYCHAIN_SERVICE, MASTER_KEY_ACCOUNT_V2);
            drop(bytes);
            create_and_store_master_key()
        }
        Err(_) => create_and_store_master_key(),
    }
}

fn create_and_store_master_key() -> Result<Vec<u8>> {
    let mut key = vec![0u8; MASTER_KEY_SIZE];
    OsRng.fill_bytes(&mut key);
    set_generic_password(KEYCHAIN_SERVICE, MASTER_KEY_ACCOUNT_V2, &key)
        .map_err(|e| SecretError::MasterKey(e.to_string()))?;
    Ok(key)
}

/// Reject connection ids that would let a caller escape `base_dir`
/// (`..`, absolute paths) or break our prefix-scan (`-` is fine inside
/// a UUID; `:`, `/`, `\`, `\0`, and a leading `.` are not).
fn validated_id(id: &str) -> Result<&str> {
    if id.is_empty() {
        return Err(SecretError::InvalidId("empty".into()));
    }
    if id.starts_with('.') {
        return Err(SecretError::InvalidId(format!(
            "must not start with '.': {id}"
        )));
    }
    for ch in id.chars() {
        let ok = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_';
        if !ok {
            return Err(SecretError::InvalidId(format!(
                "illegal character {ch:?} in id: {id}"
            )));
        }
    }
    Ok(id)
}

fn ensure_dir_0700(dir: &Path) -> Result<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(dir)?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(dir, perms)?;
    }
    Ok(())
}

/// Write `data` to `path` atomically (write tmp + fsync + rename) with
/// permissions 0600. Mirrors the legacy keychain.rs helper to keep the
/// on-disk durability story identical.
fn atomic_write_0600(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = path.with_extension("bin.tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&tmp)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&tmp, perms)?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

/// One-shot NonceSequence: returns the supplied nonce once, then errors.
struct OneNonce(Option<[u8; NONCE_SIZE]>);
impl NonceSequence for OneNonce {
    fn advance(&mut self) -> std::result::Result<Nonce, Unspecified> {
        self.0
            .take()
            .map(Nonce::assume_unique_for_key)
            .ok_or(Unspecified)
    }
}

fn aead_seal(plaintext: &[u8], master_key: &[u8]) -> Result<Vec<u8>> {
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let unbound = UnboundKey::new(&AES_256_GCM, master_key)
        .map_err(|_| SecretError::Crypto("UnboundKey::new failed".into()))?;
    let mut sealing = SealingKey::new(unbound, OneNonce(Some(nonce_bytes)));
    let mut buf = plaintext.to_vec();
    sealing
        .seal_in_place_append_tag(Aad::empty(), &mut buf)
        .map_err(|_| SecretError::Crypto("seal failed".into()))?;
    let mut out = Vec::with_capacity(NONCE_SIZE + buf.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&buf);
    Ok(out)
}

// `aead_open` is only reachable via `FileEncryptedStore::get`, which is
// part of the read-side surface that Phase 1 IPC doesn't yet exercise.
// Retained as a counterpart to `aead_seal`; tests cover it.
#[allow(dead_code)]
fn aead_open(encrypted: &[u8], master_key: &[u8]) -> Result<Vec<u8>> {
    if encrypted.len() < NONCE_SIZE + TAG_SIZE {
        return Err(SecretError::Crypto(format!(
            "encrypted blob too short: {} bytes",
            encrypted.len()
        )));
    }
    let nonce_bytes: [u8; NONCE_SIZE] = encrypted[..NONCE_SIZE]
        .try_into()
        .map_err(|_| SecretError::Crypto("nonce slice".into()))?;
    let mut buf = encrypted[NONCE_SIZE..].to_vec();
    let unbound = UnboundKey::new(&AES_256_GCM, master_key)
        .map_err(|_| SecretError::Crypto("UnboundKey::new failed".into()))?;
    let mut opening = OpeningKey::new(unbound, OneNonce(Some(nonce_bytes)));
    let plaintext = opening
        .open_in_place(Aad::empty(), &mut buf)
        .map_err(|_| SecretError::Crypto("open failed (corrupt or wrong key)".into()))?;
    Ok(plaintext.to_vec())
}

// ──────────────────────────────────────────────────────────────────────────
// Tests — every assertion runs against MemStore; structural assertions
// (file naming, on-disk crypto, delete_all_for sweep) additionally run
// against FileEncryptedStore in a tempdir with a fixed master key.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    // ── SecretSlot ────────────────────────────────────────────────────────

    #[test]
    fn slot_wire_names_are_distinct_and_stable() {
        let names: Vec<&str> = SecretSlot::ALL.iter().map(|s| s.as_wire()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(
            sorted.len(),
            names.len(),
            "duplicate wire names break round-trip"
        );
        for slot in SecretSlot::ALL.iter().copied() {
            assert_eq!(SecretSlot::from_wire(slot.as_wire()), Some(slot));
        }
        assert!(SecretSlot::from_wire("not-a-slot").is_none());
    }

    #[test]
    fn wire_key_format() {
        assert_eq!(
            wire_key("abc-123", SecretSlot::SshKeyPassphrase),
            "conn:abc-123:ssh-key-passphrase"
        );
    }

    // ── Trait conformance suite — runs against every backend ──────────────

    fn round_trip_suite<S: SecretStore>(store: &S) {
        store.set("c1", SecretSlot::AuthPassword, "hunter2").unwrap();
        store.set("c1", SecretSlot::SshPassword, "shh").unwrap();
        store.set("c2", SecretSlot::AuthPassword, "other").unwrap();

        assert_eq!(
            store.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("hunter2")
        );
        assert_eq!(
            store.get("c1", SecretSlot::SshPassword).unwrap().as_deref(),
            Some("shh")
        );
        assert_eq!(
            store.get("c2", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("other")
        );
        assert!(store
            .get("c1", SecretSlot::ProxyPassword)
            .unwrap()
            .is_none());
        assert!(store
            .get("missing", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
    }

    fn isolation_suite<S: SecretStore>(store: &S) {
        store.set("c1", SecretSlot::AuthPassword, "v1").unwrap();
        store.set("c2", SecretSlot::AuthPassword, "v2").unwrap();
        store
            .set("c1-prefix-collider", SecretSlot::AuthPassword, "v3")
            .unwrap();

        // delete one slot for c1 — c2 and c1-prefix-collider untouched.
        store.delete("c1", SecretSlot::AuthPassword).unwrap();
        assert!(store
            .get("c1", SecretSlot::AuthPassword)
            .unwrap()
            .is_none());
        assert_eq!(
            store.get("c2", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("v2")
        );
        assert_eq!(
            store
                .get("c1-prefix-collider", SecretSlot::AuthPassword)
                .unwrap()
                .as_deref(),
            Some("v3"),
            "delete must not match by prefix"
        );
    }

    fn delete_all_for_suite<S: SecretStore>(store: &S) {
        store.set("c1", SecretSlot::AuthPassword, "a").unwrap();
        store.set("c1", SecretSlot::SshPassword, "b").unwrap();
        store.set("c1", SecretSlot::ProxyPassword, "c").unwrap();
        store.set("c2", SecretSlot::AuthPassword, "z").unwrap();

        let removed = store.delete_all_for("c1").unwrap();
        assert_eq!(removed, 3, "delete_all_for must remove every c1 slot");

        for slot in SecretSlot::ALL.iter().copied() {
            assert!(
                store.get("c1", slot).unwrap().is_none(),
                "slot {:?} should be gone after delete_all_for",
                slot
            );
        }
        assert_eq!(
            store.get("c2", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("z"),
            "delete_all_for must not touch other connections"
        );
    }

    fn no_op_deletes_suite<S: SecretStore>(store: &S) {
        // delete on empty + delete_all_for on empty: both succeed, return 0.
        store.delete("nope", SecretSlot::AuthPassword).unwrap();
        assert_eq!(store.delete_all_for("nope").unwrap(), 0);
    }

    fn set_overwrites_suite<S: SecretStore>(store: &S) {
        store.set("c1", SecretSlot::AuthPassword, "first").unwrap();
        store.set("c1", SecretSlot::AuthPassword, "second").unwrap();
        assert_eq!(
            store.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("second")
        );
    }

    // ── MemStore ──────────────────────────────────────────────────────────

    #[test]
    fn mem_round_trip() {
        round_trip_suite(&MemStore::new());
    }
    #[test]
    fn mem_isolation() {
        isolation_suite(&MemStore::new());
    }
    #[test]
    fn mem_delete_all_for() {
        delete_all_for_suite(&MemStore::new());
    }
    #[test]
    fn mem_no_op_deletes() {
        no_op_deletes_suite(&MemStore::new());
    }
    #[test]
    fn mem_set_overwrites() {
        set_overwrites_suite(&MemStore::new());
    }

    // ── FileEncryptedStore ────────────────────────────────────────────────

    /// Build a FileEncryptedStore against an isolated tempdir with a
    /// fixed all-zero master key. The TempDir is returned alongside the
    /// store so the caller can keep it alive for the duration of the
    /// test (Drop = rmtree).
    fn file_store_in_tempdir() -> (FileEncryptedStore, TempDir) {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let base: PathBuf = tmp.path().to_path_buf();
        let key = vec![0u8; MASTER_KEY_SIZE];
        let store = FileEncryptedStore::new(base, key).expect("construct store");
        (store, tmp)
    }

    #[test]
    fn file_round_trip() {
        let (store, _tmp) = file_store_in_tempdir();
        round_trip_suite(&store);
    }

    #[test]
    fn file_isolation() {
        let (store, _tmp) = file_store_in_tempdir();
        isolation_suite(&store);
    }

    #[test]
    fn file_delete_all_for() {
        let (store, _tmp) = file_store_in_tempdir();
        delete_all_for_suite(&store);
    }

    #[test]
    fn file_no_op_deletes() {
        let (store, _tmp) = file_store_in_tempdir();
        no_op_deletes_suite(&store);
    }

    #[test]
    fn file_set_overwrites() {
        let (store, _tmp) = file_store_in_tempdir();
        set_overwrites_suite(&store);
    }

    #[test]
    fn file_rejects_wrong_master_key_size() {
        let tmp = tempfile::tempdir().unwrap();
        let too_short = vec![0u8; 16];
        let err = FileEncryptedStore::new(tmp.path().to_path_buf(), too_short).unwrap_err();
        match err {
            SecretError::MasterKey(_) => {}
            other => panic!("expected MasterKey error, got {other:?}"),
        }
    }

    #[test]
    fn file_filename_format_matches_spec() {
        let (store, _tmp) = file_store_in_tempdir();
        store
            .set("uuid-1234", SecretSlot::SshKeyPassphrase, "x")
            .unwrap();
        let expected = store.base_dir.join("conn-uuid-1234-ssh-key-passphrase.bin");
        assert!(
            expected.exists(),
            "expected file {} to exist; got {:?}",
            expected.display(),
            fs::read_dir(&store.base_dir)
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn file_blob_is_actually_encrypted() {
        let (store, _tmp) = file_store_in_tempdir();
        store
            .set("c1", SecretSlot::AuthPassword, "plaintext-secret")
            .unwrap();
        let path = store.path_for("c1", SecretSlot::AuthPassword).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.len() >= NONCE_SIZE + TAG_SIZE);
        // Sanity: the plaintext must not appear verbatim in the blob.
        let needle = b"plaintext-secret";
        assert!(
            bytes.windows(needle.len()).all(|w| w != needle),
            "blob contains plaintext — encryption is broken"
        );
    }

    #[test]
    fn file_open_detects_tampering() {
        let (store, _tmp) = file_store_in_tempdir();
        store.set("c1", SecretSlot::AuthPassword, "secret").unwrap();
        let path = store.path_for("c1", SecretSlot::AuthPassword).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        // Flip a bit in the ciphertext region (skip the 12-byte nonce).
        let idx = NONCE_SIZE + 1;
        bytes[idx] ^= 0xFF;
        fs::write(&path, &bytes).unwrap();

        let err = store.get("c1", SecretSlot::AuthPassword).unwrap_err();
        match err {
            SecretError::Crypto(_) => {}
            other => panic!("expected Crypto error on tamper, got {other:?}"),
        }
    }

    #[test]
    fn file_open_rejects_truncated_blob() {
        let (store, _tmp) = file_store_in_tempdir();
        store.set("c1", SecretSlot::AuthPassword, "secret").unwrap();
        let path = store.path_for("c1", SecretSlot::AuthPassword).unwrap();
        fs::write(&path, b"too-short").unwrap();
        let err = store.get("c1", SecretSlot::AuthPassword).unwrap_err();
        match err {
            SecretError::Crypto(_) => {}
            other => panic!("expected Crypto error on truncated blob, got {other:?}"),
        }
    }

    #[test]
    fn file_delete_all_for_ignores_unrelated_files() {
        let (store, _tmp) = file_store_in_tempdir();
        store.set("c1", SecretSlot::AuthPassword, "a").unwrap();
        // Drop an unrelated file in the dir; it must survive delete_all_for.
        let unrelated = store.base_dir.join("not-a-secret.txt");
        fs::write(&unrelated, b"hello").unwrap();

        let removed = store.delete_all_for("c1").unwrap();
        assert_eq!(removed, 1);
        assert!(
            unrelated.exists(),
            "delete_all_for must not touch unrelated files"
        );
    }

    #[test]
    fn invalid_ids_are_rejected() {
        let (store, _tmp) = file_store_in_tempdir();
        for bad in ["", ".hidden", "../escape", "with/slash", "with:colon"] {
            let err = store
                .set(bad, SecretSlot::AuthPassword, "x")
                .unwrap_err();
            match err {
                SecretError::InvalidId(_) => {}
                other => panic!("expected InvalidId for {bad:?}, got {other:?}"),
            }
        }
    }
}
