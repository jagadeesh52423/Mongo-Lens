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
//! ## Master-key source
//!
//! The 32-byte AES master key is resolved through a [`MasterKeyProvider`]
//! (the named extension point). The store NEVER regenerates a key when
//! ciphertext already exists on disk — a missing key over existing blobs
//! surfaces as [`SecretError::SecretsUnrecoverable`] (recoverable by
//! re-entry / Phase-2 passphrase unwrap), and a transient keychain failure
//! surfaces as [`SecretError::SecretUnavailable`] (retryable, store
//! untouched). See [`FileEncryptedStore::resolve_key`].
//!
//! ## Phase 2 hardening (tracked, non-blocking for Phase 1)
//!
//! 1. `FileEncryptedStore::delete_all_for` matches `conn-{id}-…\.bin` by
//!    prefix only. Connection ids are UUIDs in practice, so a prefix
//!    collision is statistically impossible today. After matching,
//!    verify the trailing component (before `.bin`) is a known
//!    `SecretSlot::ALL.as_wire()` value to close the door if id
//!    semantics ever change.
//! 2. `PassphraseWrappedKeyProvider` — wrap the master key with an
//!    Argon2id-derived KEK so a forced keychain reset is recoverable
//!    without password re-entry. Plugs in behind [`MasterKeyProvider`]
//!    with zero call-site changes.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rand::rngs::OsRng;
use rand::RngCore;
use ring::aead::{
    Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM,
};
use ring::error::Unspecified;
use security_framework::base::Error as SfError;
use security_framework::passwords::get_generic_password;
use thiserror::Error;
use zeroize::Zeroizing;

use crate::logctx;
use crate::logger::Logger;

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
    /// The master key is gone (e.g. a forced macOS keychain reset) but
    /// encrypted blobs still exist on disk. The app refuses to regenerate
    /// the key over them — doing so would orphan every stored secret. The
    /// blobs are intact; recovery is re-entry (Phase 1) or passphrase
    /// unwrap (Phase 2). User-facing and recoverable, never destructive.
    #[error(
        "stored secret unavailable: the encryption key is missing but encrypted data exists \
         (likely a macOS keychain reset). Re-enter the affected password to reconnect."
    )]
    SecretsUnrecoverable,
    /// The keychain was transiently unreachable (locked, prompt dismissed,
    /// momentary Security-framework error). Distinct from
    /// [`SecretsUnrecoverable`]: nothing is wrong with the stored data, the
    /// operation is simply retryable later. The store is never mutated.
    #[error("secret store temporarily unavailable: {0}")]
    SecretUnavailable(String),
}

impl From<std::io::Error> for SecretError {
    fn from(err: std::io::Error) -> Self {
        SecretError::Io(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SecretError>;

// ──────────────────────────────────────────────────────────────────────────
// MasterKeyProvider — the key source beneath every SecretStore
// ──────────────────────────────────────────────────────────────────────────

/// Outcome of asking a [`MasterKeyProvider`] for the existing master key.
/// Richer than `Result<key>` so the store can tell "genuinely gone" apart
/// from "transiently unreachable" — the distinction that decides whether
/// regenerating would orphan data or is safe to retry.
pub enum MasterKeyOutcome {
    /// The key exists and is well-formed.
    Found(Zeroizing<[u8; MASTER_KEY_SIZE]>),
    /// No key is stored: a fresh install OR a wiped/reset keychain. The
    /// store decides which by checking whether ciphertext already exists.
    Absent,
    /// The backend was reachable-but-failing (locked, denied, transient).
    /// The store must NOT regenerate; the caller can retry later.
    Unavailable(String),
}

/// Source of the 32-byte AES-256 master key that protects every blob in a
/// [`SecretStore`].
///
/// Implement this trait to add a new master-key backend (login keychain,
/// passphrase-wrapped recovery, plain file, Vault, …) — the
/// [`FileEncryptedStore`] gates key *creation* on "no ciphertext exists
/// yet", so a provider never decides alone whether regenerating is safe.
/// Existing impls: [`KeychainMasterKeyProvider`] (default, macOS login
/// keychain) and [`InMemoryMasterKeyProvider`] (tests). No call site of the
/// store changes when a new provider is added.
pub trait MasterKeyProvider: Send + Sync {
    /// Fetch the existing key. MUST NOT create one — that is `create`'s job,
    /// gated by the store on emptiness.
    fn fetch(&self) -> MasterKeyOutcome;
    /// Create + persist a fresh key. Only called by the store when no
    /// ciphertext exists, so this can never silently orphan stored secrets.
    fn create(&self) -> Result<Zeroizing<[u8; MASTER_KEY_SIZE]>>;
}

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

    /// Non-destructively probe whether the master key is resolvable.
    /// Returns `Ok(())` if the key is present or can be safely minted
    /// (fresh install, no existing ciphertext). Returns
    /// `SecretsUnrecoverable` when the key is absent but ciphertext blobs
    /// exist; returns `SecretUnavailable` on a transient backend failure.
    ///
    /// Migration callers MUST check this before writing secrets so that
    /// the boot-time migration sweep can never trigger quarantine. The
    /// default implementation always returns `Ok(())` — suitable for
    /// `MemStore` and other in-memory mocks that have no master-key concept.
    fn probe_recoverable(&self) -> Result<()> {
        Ok(())
    }
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

// ── ResolveMode ───────────────────────────────────────────────────────────

/// Controls how [`FileEncryptedStore::resolve_key`] handles a missing master
/// key over existing ciphertext.
///
/// * `ReadOnly`   — fail-closed: return `SecretsUnrecoverable`. Used by
///   `get()` so read operations never mutate the on-disk layout.
/// * `Recovering` — write path: quarantine orphaned blobs into a timestamped
///   subdir and mint a fresh key, all within the `cached_key` lock.
///   Used by `set()` so a user who re-enters a password after a keychain
///   reset succeeds instead of getting a permanent `SecretsUnrecoverable`.
#[derive(Copy, Clone, PartialEq)]
enum ResolveMode {
    ReadOnly,
    Recovering,
}

/// File-backed [`SecretStore`] using AES-256-GCM.
///
/// The on-disk layout for one secret is `{base_dir}/conn-{id}-{slot}.bin`
/// containing `[12-byte nonce][ciphertext + 16-byte auth tag]` — identical
/// to the legacy [`crate::keychain`] format so a future migration can
/// transcrypt blobs in place.
///
/// The master-key *source* is injected as a [`MasterKeyProvider`] (rather
/// than fetched internally) so the key is resolved lazily and retryably —
/// a transient keychain failure at construction time no longer permanently
/// wedges the store — and so unit tests can build a store against a tempdir
/// + an in-memory provider without touching the real macOS Keychain.
pub struct FileEncryptedStore {
    base_dir: PathBuf,
    provider: Arc<dyn MasterKeyProvider>,
    /// Resolved key, cached after first successful resolution. The Mutex is
    /// held across the whole fetch-or-create so two concurrent callers never
    /// both create (in-process); cross-process races are out of scope for a
    /// single-user desktop app.
    cached_key: Mutex<Option<Zeroizing<[u8; MASTER_KEY_SIZE]>>>,
    log: Arc<dyn Logger>,
}

// Custom Debug — never leak the master key bytes in logs / panic dumps.
impl std::fmt::Debug for FileEncryptedStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileEncryptedStore")
            .field("base_dir", &self.base_dir)
            .field("master_key", &format_args!("<redacted>"))
            .finish_non_exhaustive()
    }
}

impl FileEncryptedStore {
    /// Construct with a caller-supplied raw master key + base dir. Validates
    /// the key length, ensures the dir exists with 0700, and wraps the key in
    /// an [`InMemoryMasterKeyProvider`]. Used by tests only.
    #[cfg(test)]
    #[allow(dead_code)]
    pub fn new(base_dir: PathBuf, master_key: Vec<u8>) -> Result<Self> {
        if master_key.len() != MASTER_KEY_SIZE {
            return Err(SecretError::MasterKey(format!(
                "expected {MASTER_KEY_SIZE}-byte master key, got {}",
                master_key.len()
            )));
        }
        let mut key = [0u8; MASTER_KEY_SIZE];
        key.copy_from_slice(&master_key);
        Self::with_provider(
            base_dir,
            Arc::new(InMemoryMasterKeyProvider::with_key(key)),
            crate::logger::MemoryLogger::new("file-encrypted-store"),
        )
    }

    /// Construct with an injected [`MasterKeyProvider`]. The key is resolved
    /// lazily on first secret operation (and cached), so a transient provider
    /// failure here doesn't permanently break the store.
    pub fn with_provider(
        base_dir: PathBuf,
        provider: Arc<dyn MasterKeyProvider>,
        log: Arc<dyn Logger>,
    ) -> Result<Self> {
        ensure_dir_0700(&base_dir)?;
        Ok(Self {
            base_dir,
            provider,
            cached_key: Mutex::new(None),
            log,
        })
    }

    /// Resolve the master key, gating creation on emptiness so the key is
    /// NEVER regenerated over existing ciphertext unless the caller
    /// explicitly opts into write-path recovery via `ResolveMode::Recovering`.
    ///
    /// * `Found`       → use it (and cache).
    /// * `Unavailable` → [`SecretError::SecretUnavailable`]; retryable, no mutation.
    /// * `Absent` + no blobs → genuine first run; create + persist a key.
    /// * `Absent` + blobs + `ReadOnly`   → [`SecretError::SecretsUnrecoverable`];
    ///   read operations never mutate layout.
    /// * `Absent` + blobs + `Recovering` → quarantine all orphaned blobs into a
    ///   timestamped subdir, mint a fresh key. Quarantine + create + cache all
    ///   happen within the `cached_key` lock so a multi-slot `set()` loop
    ///   quarantines at most once per store instance.
    fn resolve_key(&self, mode: ResolveMode) -> Result<Zeroizing<[u8; MASTER_KEY_SIZE]>> {
        let mut guard = self.cached_key.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(key) = guard.as_ref() {
            return Ok(key.clone());
        }
        let key = match self.provider.fetch() {
            MasterKeyOutcome::Found(key) => key,
            MasterKeyOutcome::Unavailable(detail) => {
                return Err(SecretError::SecretUnavailable(detail))
            }
            MasterKeyOutcome::Absent => {
                if self.blobs_exist()? {
                    if mode == ResolveMode::ReadOnly {
                        return Err(SecretError::SecretsUnrecoverable);
                    }
                    // Recovering: quarantine orphaned blobs, then create a fresh key.
                    // All within the lock so concurrent set() calls quarantine at most once.
                    let (orphaned_dir, blob_count) = self.quarantine_blobs()?;
                    self.log.warn(
                        "keychain reset detected; orphaned ciphertext quarantined",
                        logctx! {
                            "blobCount" => blob_count,
                            "orphanedDir" => orphaned_dir.display().to_string()
                        },
                    );
                    self.provider.create()?
                } else {
                    self.provider.create()?
                }
            }
        };
        *guard = Some(key.clone());
        Ok(key)
    }

    /// Move all regular `*.bin` files under `base_dir` into a new
    /// `orphaned-<unix_secs>-<hex8>` subdirectory (0700). Returns the
    /// quarantine dir path and the number of files moved.
    ///
    /// Fails fast on the first failed rename — no partial quarantine is left
    /// visible: the quarantine dir exists but may contain fewer blobs than
    /// `base_dir` had. On failure the caller must NOT mint a new key.
    fn quarantine_blobs(&self) -> Result<(PathBuf, usize)> {
        let dir_name = generate_quarantine_dir_name();
        let quarantine_dir = self.base_dir.join(&dir_name);
        // Dir is created lazily on the first matching blob to avoid an empty
        // orphaned dir on a TOCTOU race where blobs_exist() fired but the
        // files were removed before we get here.
        let mut moved = 0usize;
        for entry in fs::read_dir(&self.base_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let fname = entry.file_name();
            let name_str = match fname.to_str() {
                Some(s) => s,
                None => continue,
            };
            if !name_str.ends_with(".bin") {
                continue;
            }
            if moved == 0 {
                ensure_dir_0700(&quarantine_dir)?;
            }
            let src = entry.path();
            let dst = quarantine_dir.join(&fname);
            fs::rename(&src, &dst).map_err(|e| {
                SecretError::Io(format!(
                    "quarantine move failed for {}: {e}",
                    src.display()
                ))
            })?;
            moved += 1;
        }
        Ok((quarantine_dir, moved))
    }

    /// Whether any `*.bin` ciphertext blob exists under `base_dir`. A missing
    /// dir counts as "no blobs". Only regular files are matched — a directory
    /// named `*.bin` does not qualify. The `.bin.tmp` write-temp is excluded
    /// (it ends in `.tmp`).
    fn blobs_exist(&self) -> Result<bool> {
        match fs::read_dir(&self.base_dir) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry?;
                    if !entry.file_type()?.is_file() {
                        continue;
                    }
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".bin") {
                            return Ok(true);
                        }
                    }
                }
                Ok(false)
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(err.into()),
        }
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
        // Write path: Recovering mode quarantines orphaned blobs and re-keys so a
        // user who re-enters a password after a keychain reset succeeds.
        let key = self.resolve_key(ResolveMode::Recovering)?;
        let encrypted = aead_seal(value.as_bytes(), &key[..])?;
        let path = self.path_for(connection_id, slot)?;
        atomic_write_0600(&path, &encrypted)
    }

    fn get(&self, connection_id: &str, slot: SecretSlot) -> Result<Option<String>> {
        let path = self.path_for(connection_id, slot)?;
        match fs::read(&path) {
            Ok(bytes) => {
                // Read path: fail-closed so reads never mutate the on-disk layout.
                let key = self.resolve_key(ResolveMode::ReadOnly)?;
                let plaintext = aead_open(&bytes, &key[..])?;
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

    fn probe_recoverable(&self) -> Result<()> {
        self.resolve_key(ResolveMode::ReadOnly).map(|_| ())
    }
}

/// Production constructor. Wires the [`KeychainMasterKeyProvider`] (macOS
/// login keychain) to blobs under `~/.mongomacapp/secrets/`. The key is
/// resolved lazily on first use — a transient keychain failure here no
/// longer wedges the store, and the key is never regenerated over existing
/// ciphertext (see [`FileEncryptedStore::resolve_key`]).
pub fn open_default_keychain_store(log: Arc<dyn Logger>) -> Result<FileEncryptedStore> {
    let base_dir = default_secrets_dir()?;
    let provider = Arc::new(KeychainMasterKeyProvider::new(
        KEYCHAIN_SERVICE,
        MASTER_KEY_ACCOUNT_V2,
        "connections-v2-master-key",
        log.clone(),
    ));
    FileEncryptedStore::with_provider(base_dir, provider, log)
}

/// Open the default file-backed secret store. The master key lives at
/// `~/.mongomacapp/master.key`; the encrypted blobs live under
/// `~/.mongomacapp/secrets/`. Replaces `open_default_keychain_store` so the
/// app never prompts for Keychain access on binary re-sign.
pub fn open_default_store(log: Arc<dyn Logger>) -> Result<FileEncryptedStore> {
    let base_dir = default_secrets_dir()?;
    let provider = Arc::new(FileMasterKeyProvider::new(default_master_key_path()?));
    FileEncryptedStore::with_provider(base_dir, provider, log)
}

pub fn default_master_key_path() -> Result<PathBuf> {
    let home =
        std::env::var("HOME").map_err(|_| SecretError::Io("HOME not set".to_string()))?;
    Ok(PathBuf::from(home).join(".mongomacapp").join("master.key"))
}

// ──────────────────────────────────────────────────────────────────────────
// Internals — Keychain access, dir handling, AES-GCM
// ──────────────────────────────────────────────────────────────────────────

fn default_secrets_dir() -> Result<PathBuf> {
    let home =
        std::env::var("HOME").map_err(|_| SecretError::Io("HOME not set".to_string()))?;
    Ok(PathBuf::from(home).join(".mongomacapp").join("secrets"))
}

/// macOS login-keychain [`MasterKeyProvider`]. `fetch` reports `Absent` only
/// for a genuine not-found (errSecItemNotFound / "-25300"); every other
/// keychain error is `Unavailable` (so the store retries rather than
/// regenerating). A wrong-size stored entry is `Unavailable` too — it is
/// NEVER silently deleted + overwritten (the prior behaviour, which could
/// orphan blobs). `create` stores the new key with a self-trusted ACL (via
/// the shared `keychain` helper) so future reads from this binary don't
/// re-prompt — closing the gap where the v2 entry lacked the ACL the legacy
/// entry already had.
pub struct KeychainMasterKeyProvider {
    service: &'static str,
    account: &'static str,
    acl_label: &'static str,
    log: Arc<dyn Logger>,
}

impl KeychainMasterKeyProvider {
    pub fn new(
        service: &'static str,
        account: &'static str,
        acl_label: &'static str,
        log: Arc<dyn Logger>,
    ) -> Self {
        Self {
            service,
            account,
            acl_label,
            log,
        }
    }
}

/// True when the Security framework error is `errSecItemNotFound` (-25300).
/// Uses the typed error code rather than string matching for robustness
/// across locales and future SDK versions.
pub(crate) fn is_keychain_not_found(err: &SfError) -> bool {
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    err.code() == ERR_SEC_ITEM_NOT_FOUND
}

impl MasterKeyProvider for KeychainMasterKeyProvider {
    fn fetch(&self) -> MasterKeyOutcome {
        match get_generic_password(self.service, self.account) {
            Ok(bytes) if bytes.len() == MASTER_KEY_SIZE => {
                let mut key = [0u8; MASTER_KEY_SIZE];
                key.copy_from_slice(&bytes);
                MasterKeyOutcome::Found(Zeroizing::new(key))
            }
            Ok(bytes) => {
                // Wrong size: do NOT delete + regenerate. Treat as transient
                // unavailability and log loudly so a recurring malformed entry
                // is debuggable rather than silently orphaning blobs.
                self.log.error(
                    "master key wrong size; refusing to overwrite",
                    logctx! {
                        "account" => self.account,
                        "got" => bytes.len(),
                        "expected" => MASTER_KEY_SIZE,
                    },
                );
                MasterKeyOutcome::Unavailable(format!(
                    "stored master key has wrong size: {} bytes",
                    bytes.len()
                ))
            }
            Err(e) => {
                if is_keychain_not_found(&e) {
                    MasterKeyOutcome::Absent
                } else {
                    let msg = e.to_string();
                    self.log.error(
                        "keychain access failed (transient); not regenerating",
                        logctx! { "account" => self.account, "err" => msg.clone() },
                    );
                    MasterKeyOutcome::Unavailable(msg)
                }
            }
        }
    }

    fn create(&self) -> Result<Zeroizing<[u8; MASTER_KEY_SIZE]>> {
        let mut key = Zeroizing::new([0u8; MASTER_KEY_SIZE]);
        OsRng.fill_bytes(&mut key[..]);
        self.log
            .info("generating new v2 master key", logctx! { "account" => self.account });
        match crate::keychain::add_generic_password_with_self_trust(
            self.service,
            self.account,
            &key[..],
            self.acl_label,
            self.log.as_ref(),
        ) {
            Ok(None) => Ok(key),
            Ok(Some(existing)) => {
                // Concurrent create won the race; adopt the stored key.
                if existing.len() != MASTER_KEY_SIZE {
                    return Err(SecretError::MasterKey(format!(
                        "concurrently-stored master key has wrong size: {} bytes",
                        existing.len()
                    )));
                }
                let mut adopted = [0u8; MASTER_KEY_SIZE];
                adopted.copy_from_slice(&existing);
                Ok(Zeroizing::new(adopted))
            }
            Err(detail) => Err(SecretError::MasterKey(detail)),
        }
    }
}

/// In-memory [`MasterKeyProvider`] for tests. Models the three states the
/// store must distinguish — `Found`, `Absent` (fresh install / wiped
/// keychain), `Unavailable` (transient) — without touching the real macOS
/// keychain. `create` materialises a key and flips the provider to `Found`,
/// mirroring a real first-run.
#[allow(dead_code)]
pub struct InMemoryMasterKeyProvider {
    inner: Mutex<InMemKeyState>,
}

#[allow(dead_code)]
struct InMemKeyState {
    mode: InMemKeyMode,
    key: Option<[u8; MASTER_KEY_SIZE]>,
}

#[allow(dead_code)]
enum InMemKeyMode {
    Found,
    Absent,
    Unavailable(String),
}

#[allow(dead_code)]
impl InMemoryMasterKeyProvider {
    /// A provider already holding `key` — simulates an intact keychain.
    pub fn with_key(key: [u8; MASTER_KEY_SIZE]) -> Self {
        Self {
            inner: Mutex::new(InMemKeyState {
                mode: InMemKeyMode::Found,
                key: Some(key),
            }),
        }
    }

    /// No key yet: a fresh install OR a wiped keychain. `create` materialises one.
    pub fn absent() -> Self {
        Self {
            inner: Mutex::new(InMemKeyState {
                mode: InMemKeyMode::Absent,
                key: None,
            }),
        }
    }

    /// Transient failure: `fetch` reports `Unavailable`. `create` is never
    /// reached (the store only creates on `Absent`).
    pub fn unavailable(detail: impl Into<String>) -> Self {
        Self {
            inner: Mutex::new(InMemKeyState {
                mode: InMemKeyMode::Unavailable(detail.into()),
                key: None,
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, InMemKeyState> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl MasterKeyProvider for InMemoryMasterKeyProvider {
    fn fetch(&self) -> MasterKeyOutcome {
        let state = self.lock();
        match &state.mode {
            InMemKeyMode::Unavailable(detail) => MasterKeyOutcome::Unavailable(detail.clone()),
            InMemKeyMode::Found | InMemKeyMode::Absent => match state.key {
                Some(key) => MasterKeyOutcome::Found(Zeroizing::new(key)),
                None => MasterKeyOutcome::Absent,
            },
        }
    }

    fn create(&self) -> Result<Zeroizing<[u8; MASTER_KEY_SIZE]>> {
        let mut state = self.lock();
        let mut key = [0u8; MASTER_KEY_SIZE];
        OsRng.fill_bytes(&mut key);
        state.key = Some(key);
        state.mode = InMemKeyMode::Found;
        Ok(Zeroizing::new(key))
    }
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

/// Generate a unique quarantine directory name: `orphaned-<unix_secs>-<hex8>`.
fn generate_quarantine_dir_name() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut rnd = [0u8; 4];
    OsRng.fill_bytes(&mut rnd);
    format!("orphaned-{ts}-{:08x}", u32::from_le_bytes(rnd))
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
// FileMasterKeyProvider — file-backed master key (replaces Keychain)
// ──────────────────────────────────────────────────────────────────────────

/// File-based `MasterKeyProvider`: stores the 32-byte AES-256 master key at
/// `path` with 0600 permissions. Replaces `KeychainMasterKeyProvider` so the
/// app no longer triggers Keychain access prompts on binary re-sign/update.
pub struct FileMasterKeyProvider {
    path: PathBuf,
}

impl FileMasterKeyProvider {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl MasterKeyProvider for FileMasterKeyProvider {
    fn fetch(&self) -> MasterKeyOutcome {
        match fs::read(&self.path) {
            Ok(bytes) if bytes.len() == MASTER_KEY_SIZE => {
                let mut key = Zeroizing::new([0u8; MASTER_KEY_SIZE]);
                key.copy_from_slice(&bytes);
                MasterKeyOutcome::Found(key)
            }
            Ok(bytes) => MasterKeyOutcome::Unavailable(format!(
                "master key file has wrong size: {} bytes (expected {})",
                bytes.len(),
                MASTER_KEY_SIZE
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => MasterKeyOutcome::Absent,
            Err(e) => MasterKeyOutcome::Unavailable(e.to_string()),
        }
    }

    fn create(&self) -> Result<Zeroizing<[u8; MASTER_KEY_SIZE]>> {
        let mut key = Zeroizing::new([0u8; MASTER_KEY_SIZE]);
        OsRng.fill_bytes(&mut key[..]);
        if let Some(parent) = self.path.parent() {
            ensure_dir_0700(parent)?;
        }
        atomic_write_0600(&self.path, &key[..])?;
        Ok(key)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tests — every assertion runs against MemStore; structural assertions
// (file naming, on-disk crypto, delete_all_for sweep) additionally run
// against FileEncryptedStore in a tempdir with a fixed master key.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::MemoryLogger;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn test_log() -> Arc<dyn Logger> {
        MemoryLogger::new("secrets-test")
    }

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

    fn file_store_with_provider(
        base: PathBuf,
        provider: Arc<dyn MasterKeyProvider>,
    ) -> FileEncryptedStore {
        FileEncryptedStore::with_provider(base, provider, test_log()).expect("construct store")
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

    // ── Master-key resolution gating (the Phase-1 regression guards) ──────

    /// Core regression guard: a wiped keychain (`Absent`) over existing
    /// ciphertext must surface `SecretsUnrecoverable` on READ, NEVER regenerate
    /// the key, and leave every blob byte-for-byte intact.
    #[test]
    fn store_refuses_to_regenerate_over_existing_blobs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();

        // Round 1: an intact key writes a blob.
        let store1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::with_key([7u8; MASTER_KEY_SIZE])),
        );
        store1.set("c1", SecretSlot::AuthPassword, "secret").unwrap();
        let blob = base.join("conn-c1-auth-password.bin");
        let before = fs::read(&blob).unwrap();

        // Round 2 (simulated restart): keychain wiped → provider Absent, blob
        // still on disk. READ must fail-closed.
        let store2 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        let err = store2.get("c1", SecretSlot::AuthPassword).unwrap_err();
        assert!(
            matches!(err, SecretError::SecretsUnrecoverable),
            "expected SecretsUnrecoverable on get, got {err:?}"
        );
        // Blob must be untouched — never auto-deleted, never re-encrypted by a read.
        assert_eq!(fs::read(&blob).unwrap(), before, "blob must be intact after failed read");
    }

    /// A transient `Unavailable` must surface `SecretUnavailable`, never
    /// create a key, and never write a blob — the operation is retryable.
    #[test]
    fn store_does_not_regenerate_on_transient_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let store = file_store_with_provider(
            tmp.path().to_path_buf(),
            Arc::new(InMemoryMasterKeyProvider::unavailable("keychain locked")),
        );
        let err = store.set("c1", SecretSlot::AuthPassword, "x").unwrap_err();
        assert!(
            matches!(err, SecretError::SecretUnavailable(_)),
            "expected SecretUnavailable, got {err:?}"
        );
        let any_blob = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_str().map(|n| n.ends_with(".bin")).unwrap_or(false));
        assert!(!any_blob, "no blob should be written on transient failure");
    }

    /// Fresh install (no blobs) + `Absent` is the genuine first-run path:
    /// create a key and round-trip normally.
    #[test]
    fn store_creates_key_on_fresh_install() {
        let tmp = tempfile::tempdir().unwrap();
        let store = file_store_with_provider(
            tmp.path().to_path_buf(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        store.set("c1", SecretSlot::AuthPassword, "hunter2").unwrap();
        assert_eq!(
            store.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("hunter2")
        );
    }

    // ── Write-path recovery (quarantine) tests ────────────────────────────

    /// `set()` on a wiped keychain with existing blobs must quarantine the
    /// orphaned blobs, mint a new key, and succeed. The orphaned dir must
    /// contain the original blobs; no blob remains in `base_dir`.
    #[test]
    fn set_quarantines_and_rekeys_after_keychain_reset() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();

        // Write one blob with an intact key.
        let store1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::with_key([9u8; MASTER_KEY_SIZE])),
        );
        store1.set("c1", SecretSlot::AuthPassword, "original").unwrap();
        let original_blob = base.join("conn-c1-auth-password.bin");
        let original_bytes = fs::read(&original_blob).unwrap();

        // Simulate keychain reset: provider reports Absent, blob still on disk.
        let store2 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        // set() must succeed via quarantine + re-key.
        store2.set("c1", SecretSlot::AuthPassword, "new-secret").unwrap();

        // An orphaned-* subdirectory must exist containing the original blob byte-for-byte.
        let orphaned_entries: Vec<_> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && e.file_name()
                        .to_str()
                        .map(|n| n.starts_with("orphaned-"))
                        .unwrap_or(false)
            })
            .collect();
        assert_eq!(orphaned_entries.len(), 1, "exactly one orphaned dir expected");
        let orphan_blob = orphaned_entries[0].path().join("conn-c1-auth-password.bin");
        assert!(orphan_blob.exists(), "original blob must be in orphaned dir");
        assert_eq!(
            fs::read(&orphan_blob).unwrap(),
            original_bytes,
            "orphaned blob bytes must be identical to original"
        );

        // The blob at the original path should now contain NEW ciphertext (different bytes).
        let new_bytes = fs::read(&original_blob).unwrap();
        assert_ne!(
            new_bytes, original_bytes,
            "new blob must have different ciphertext than orphaned blob"
        );

        // New blob must decrypt to the new value.
        assert_eq!(
            store2.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("new-secret")
        );
    }

    /// After quarantine + re-key, a second `set()` must reuse the cached key
    /// (no second quarantine, no second provider.create() call).
    #[test]
    fn second_set_reuses_cached_key_no_double_quarantine() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();

        let store1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::with_key([3u8; MASTER_KEY_SIZE])),
        );
        store1.set("c1", SecretSlot::AuthPassword, "pw1").unwrap();
        store1.set("c2", SecretSlot::AuthPassword, "pw2").unwrap();

        // Keychain reset: both blobs exist, provider is now Absent.
        let store2 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        // First set() triggers quarantine.
        store2.set("c1", SecretSlot::AuthPassword, "new1").unwrap();
        // Second set() must use the cached key — no new quarantine dir created.
        store2.set("c2", SecretSlot::AuthPassword, "new2").unwrap();

        let orphaned_dirs: Vec<_> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with("orphaned-"))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(
            orphaned_dirs.len(),
            1,
            "exactly one quarantine must occur even for multiple set() calls"
        );

        // Both new secrets must round-trip.
        assert_eq!(
            store2.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("new1")
        );
        assert_eq!(
            store2.get("c2", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("new2")
        );
    }

    /// Quarantine abort: if dir creation fails (base dir non-writable),
    /// `set()` must return an Io error, no key is minted, and the original
    /// blob bytes are preserved at their original path.
    #[cfg(unix)]
    #[test]
    fn quarantine_abort_leaves_blob_intact_and_no_key_minted() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();

        // Write one blob with an intact key.
        let store1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::with_key([9u8; MASTER_KEY_SIZE])),
        );
        store1.set("c1", SecretSlot::AuthPassword, "original").unwrap();
        let blob_path = base.join("conn-c1-auth-password.bin");
        let original_bytes = fs::read(&blob_path).unwrap();

        // Simulate keychain reset: Absent provider with blob still on disk.
        let store2 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );

        // Make base_dir non-writable: mkdir(quarantine_subdir) will fail with
        // EACCES, but read_dir still works (read+execute = 0o555).
        fs::set_permissions(&base, fs::Permissions::from_mode(0o555)).unwrap();

        let err = store2.set("c1", SecretSlot::AuthPassword, "new").unwrap_err();

        // Restore write permission before any asserts so the tempdir cleanup works.
        fs::set_permissions(&base, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(
            matches!(err, SecretError::Io(_)),
            "expected Io error on quarantine failure, got {err:?}"
        );
        // Original blob must be intact — quarantine failed before any rename.
        assert_eq!(
            fs::read(&blob_path).unwrap(),
            original_bytes,
            "original blob must be untouched on quarantine abort"
        );
        // No orphaned dir created (lazy creation means no dir on failure).
        let orphaned_dirs: Vec<_> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && e.file_name()
                        .to_str()
                        .map(|n| n.starts_with("orphaned-"))
                        .unwrap_or(false)
            })
            .collect();
        assert!(orphaned_dirs.is_empty(), "no orphaned dir must exist after abort");
    }

    /// Two consecutive keychain-reset recovery events must each create a
    /// distinct `orphaned-*` directory.
    #[test]
    fn two_recovery_events_create_two_distinct_orphaned_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();

        // Round 1: write a blob with key A.
        let store1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::with_key([1u8; MASTER_KEY_SIZE])),
        );
        store1.set("c1", SecretSlot::AuthPassword, "pw1").unwrap();
        drop(store1); // clear cached key

        // Recovery 1: Absent provider quarantines key-A blob, mints key B.
        let recovery1 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        recovery1.set("c1", SecretSlot::AuthPassword, "new1").unwrap();
        drop(recovery1); // clear cached key

        // Recovery 2: key-B blob is now on disk; simulate another reset.
        let recovery2 = file_store_with_provider(
            base.clone(),
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        recovery2.set("c1", SecretSlot::AuthPassword, "new2").unwrap();

        let orphaned_dirs: Vec<_> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && e.file_name()
                        .to_str()
                        .map(|n| n.starts_with("orphaned-"))
                        .unwrap_or(false)
            })
            .collect();
        assert_eq!(
            orphaned_dirs.len(),
            2,
            "each reset must produce a distinct orphaned dir"
        );
        assert_ne!(
            orphaned_dirs[0].file_name(),
            orphaned_dirs[1].file_name(),
            "orphaned dir names must be distinct"
        );
        // The latest value is still readable.
        assert_eq!(
            recovery2.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("new2")
        );
    }

    /// `blobs_exist` must not match a directory named `*.bin`.
    #[test]
    fn blobs_exist_ignores_directories_named_bin() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();
        // Create a directory whose name ends in ".bin" — must not be counted.
        fs::create_dir(base.join("fake.bin")).unwrap();

        let store = file_store_with_provider(
            base,
            Arc::new(InMemoryMasterKeyProvider::absent()),
        );
        // No real blobs → fresh install → set() must succeed (create key, no quarantine).
        store.set("c1", SecretSlot::AuthPassword, "pw").unwrap();
        assert_eq!(
            store.get("c1", SecretSlot::AuthPassword).unwrap().as_deref(),
            Some("pw")
        );
    }

    // ── FileMasterKeyProvider ──────────────────────────────────────────────

    #[test]
    fn file_key_provider_absent_when_no_file() {
        let tmp = tempfile::tempdir().unwrap();
        let provider = FileMasterKeyProvider::new(tmp.path().join("master.key"));
        assert!(matches!(provider.fetch(), MasterKeyOutcome::Absent));
    }

    #[test]
    fn file_key_provider_create_writes_key_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("master.key");
        let provider = FileMasterKeyProvider::new(path.clone());
        provider.create().unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes.len(), MASTER_KEY_SIZE);
    }

    #[test]
    fn file_key_provider_fetch_returns_found_with_created_key() {
        let tmp = tempfile::tempdir().unwrap();
        let provider = FileMasterKeyProvider::new(tmp.path().join("master.key"));
        let created = provider.create().unwrap();
        match provider.fetch() {
            MasterKeyOutcome::Found(fetched) => assert_eq!(*fetched, *created),
            MasterKeyOutcome::Absent => panic!("expected Found, got Absent"),
            MasterKeyOutcome::Unavailable(msg) => panic!("expected Found, got Unavailable: {msg}"),
        }
    }

    #[test]
    fn file_key_provider_unavailable_on_wrong_size() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("master.key");
        atomic_write_0600(&path, &[0u8; 16]).unwrap();
        let provider = FileMasterKeyProvider::new(path);
        assert!(matches!(provider.fetch(), MasterKeyOutcome::Unavailable(_)));
    }
}
