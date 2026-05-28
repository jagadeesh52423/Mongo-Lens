// Connection model — tagged-union mirror of src/connection/model.ts.
//
// Extension contract: to add a new auth mode / target kind / proxy type /
// SSH auth flavour, add a variant in model.rs AND its TS twin, then add a
// fixture under tests/fixtures/connection/ exercising it. The contract tests
// in model_contract_tests.rs enforce wire-format parity.

pub mod model;

// connections_v2 table + payload-JSON store.
pub mod store;

// Slotted secret storage (KeychainStore + MemStore).
pub mod secrets;

// SshTunnel → ssh::TunnelHandle bridge.
pub mod tunnel;

// SOCKS5 proxy validation (HTTP/SOCKS4 deferred).
pub mod proxy;

// Legacy→v2 migration: pure migrate() + side-effectful sync_row_to_v2 +
// boot-time migrate_all sweep.
pub mod migration;

// Connection → mongodb::options::ClientOptions builder with staged
// errors (Ssh|Tls|Auth|Ping). Returns an owned tunnel handle alongside
// the options so callers can close it on teardown — no leaks.
pub mod builder;

#[cfg(test)]
mod model_contract_tests;
