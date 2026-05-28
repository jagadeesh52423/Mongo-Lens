// Connection model — tagged-union mirror of src/connection/model.ts.
//
// Extension contract: to add a new auth mode / target kind / proxy type /
// SSH auth flavour, add a variant in model.rs AND its TS twin, then add a
// fixture under tests/fixtures/connection/ exercising it. The contract tests
// in model_contract_tests.rs enforce wire-format parity.

// Types here are consumed by later PRs (connections_v2 store, builder, IPC
// commands). Until those land, the producer/consumer surface is just the
// contract tests — silence the per-variant dead-code warnings module-wide.
#[allow(dead_code)]
pub mod model;

#[cfg(test)]
mod model_contract_tests;
