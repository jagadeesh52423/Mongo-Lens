pub mod credential;
pub mod executor;
pub mod harness;

pub use credential::RunnerCredential;
pub use harness::HarnessHandle;

use std::path::PathBuf;

pub fn runner_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".mongomacapp").join("runner")
}

pub fn harness_path() -> PathBuf {
    runner_dir().join("harness.js")
}

pub fn node_modules_dir() -> PathBuf {
    runner_dir().join("node_modules")
}
