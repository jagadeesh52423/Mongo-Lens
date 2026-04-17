use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db_path: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            mongo_clients: Mutex::new(HashMap::new()),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }
}
