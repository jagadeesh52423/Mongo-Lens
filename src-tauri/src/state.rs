use crate::logger::tracing_impl::TracingLogger;
use crate::logger::Logger;
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
}

impl AppState {
    pub fn new(db_path: PathBuf, logs_dir: PathBuf, tracing_logger: Arc<TracingLogger>) -> Self {
        let logger: Arc<dyn Logger> = tracing_logger.clone();
        Self {
            db_path,
            logs_dir,
            mongo_clients: Mutex::new(HashMap::new()),
            mongo_uris: Mutex::new(HashMap::new()),
            ssh_tunnels: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
            logger,
            tracing_logger: Some(tracing_logger),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }
}
