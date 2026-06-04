use crate::connection::secrets::SecretStore;
use crate::logger::tracing_impl::TracingLogger;
use crate::logger::Logger;
use crate::runner::RunnerCredential;
use crate::ssh::TunnelHandle;
use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
    /// URI variant (with any fallback query params applied) that the cached client
    /// actually connected with. Keyed by connection id, mirrors `mongo_clients`.
    pub mongo_uris: Mutex<HashMap<String, String>>,
    /// In-memory credential for the Node query runner, keyed by connection id.
    /// Mirrors the `mongo_uris` lifecycle: inserted on connect, removed on
    /// disconnect / SSH session loss. Holds the password in memory for the
    /// connection's lifetime — same as the live driver `Client` — so the Node
    /// child can authenticate without requiring secret-store access.
    /// `None` entry means the connection uses no password-based auth (e.g.
    /// X509, no-auth, or a URI target with inline creds).
    pub mongo_runner_creds: Mutex<HashMap<String, RunnerCredential>>,
    /// Active SSH tunnel handles, keyed by connection id.
    /// The Mutex is held only across insert/remove — never across an .await.
    pub ssh_tunnels: Mutex<HashMap<String, TunnelHandle>>,
    /// Per-tab cancel flag. Set to true to signal the running script to abort.
    pub active_scripts: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Generic logger handle used by commands and the runner executor.
    pub logger: Arc<dyn Logger>,
    /// Concrete TracingLogger kept so the `log_write` handler can write frontend
    /// records directly to `app.log`.
    pub tracing_logger: Option<Arc<TracingLogger>>,
    /// v2 connection secret store. `Some` only when `CONN_V2` is enabled
    /// (initialised in main.rs); `None` keeps the legacy code path untouched.
    /// Wrapped in a Mutex so it can be late-bound from setup() without
    /// changing the AppState::new() signature.
    pub connection_secrets: Mutex<Option<Arc<dyn SecretStore>>>,
}

impl AppState {
    pub fn new(db_path: PathBuf, logs_dir: PathBuf, tracing_logger: Arc<TracingLogger>) -> Self {
        let logger: Arc<dyn Logger> = tracing_logger.clone();
        Self {
            db_path,
            logs_dir,
            mongo_clients: Mutex::new(HashMap::new()),
            mongo_uris: Mutex::new(HashMap::new()),
            mongo_runner_creds: Mutex::new(HashMap::new()),
            ssh_tunnels: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
            logger,
            tracing_logger: Some(tracing_logger),
            connection_secrets: Mutex::new(None),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }

    /// Install the v2 connection secret store. Called from setup() when
    /// `CONN_V2` is enabled.
    pub fn set_connection_secrets(&self, store: Arc<dyn SecretStore>) {
        *self.connection_secrets.lock().unwrap() = Some(store);
    }

    /// Return a clone of the v2 secret store handle, or None when CONN_V2
    /// is disabled. Cheap — `Arc` clone, no allocation.
    pub fn connection_secrets(&self) -> Option<Arc<dyn SecretStore>> {
        self.connection_secrets.lock().unwrap().clone()
    }
}
