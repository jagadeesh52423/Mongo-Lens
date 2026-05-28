// Connection model — tagged-union mirror of src/connection/model.ts.
//
// Extension contract: to add a new auth mode / target kind / proxy type /
// SSH auth flavour, add a variant in model.rs AND its TS twin, then add a
// fixture under tests/fixtures/connection/ exercising it. The contract tests
// in model_contract_tests.rs enforce wire-format parity.

// Types here are consumed by later PRs (builder, IPC commands). Until
// those land, the producer/consumer surface is the store + contract
// tests — silence the per-variant dead-code warnings module-wide.
#[allow(dead_code)]
pub mod model;

// connections_v2 table + payload-JSON store. Consumed by the migration
// runner (Task 11) and IPC commands (Task 12); allow(dead_code) until
// those wire it up.
#[allow(dead_code)]
pub mod store;

// Slotted secret storage (KeychainStore + MemStore). Consumed by Task 7
// (SSH auth flows) and the builder/migration in Tasks 10-11; allow
// dead_code until those land.
#[allow(dead_code)]
pub mod secrets;

#[cfg(test)]
mod model_contract_tests;
