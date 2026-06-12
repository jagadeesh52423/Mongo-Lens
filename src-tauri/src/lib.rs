//! Library target for `mongo-lens`.
//!
//! Exists so integration tests under `src-tauri/tests/` can import the
//! connection builder + supporting modules end-to-end without going
//! through the Tauri binary. The binary (`src/main.rs`) continues to
//! declare its own `mod ...;` for each of these — the two crates compile
//! the source files independently and do not share types across the
//! boundary, but neither does the binary import from this lib so that's
//! fine.
//!
//! Keep this file minimal: re-mod whatever the bin re-mods. Anything
//! tests need at the seam (`connection::builder::*`,
//! `connection::model::*`, `prefs::model::*`, `logger::MemoryLogger`,
//! `ssh::TunnelHandle`) is reachable via the public paths inside those
//! modules.

pub mod commands;
pub mod connection;
pub mod db;
pub mod keychain;
pub mod logger;
pub mod mongo;
pub mod prefs;
pub mod runner;
pub mod ssh;
pub mod state;

/// Serialises `HOME` mutations across all test modules in this crate.
/// Both `keychain::tests` and `ssh::known_hosts::tests` mutate `HOME`;
/// any test that does so must hold this lock for the duration.
#[cfg(test)]
pub static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
