use crate::connection::model::{AuthMode, Connection};
use crate::connection::store as connection_store;
use crate::logctx;
use crate::mongo;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionNode {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub keys: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    pub docs: Vec<serde_json::Value>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// Pull a `[String]` array out of a harness `__data` value.
fn data_strings(data: &serde_json::Value) -> Vec<String> {
    data.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
    });
    log.info("list_databases", logctx! {});

    match mongo::harness_data(
        &state,
        &connection_id,
        "admin",
        mongo::data_op::LIST_DATABASES,
        serde_json::json!({}),
        state.logger.clone(),
    )
    .await
    {
        Ok(data) => Ok(data_strings(&data)),
        Err(e) if e.is_unauthorized() => {
            log.warn("list_databases unauthorized, falling back to default db",
                logctx! { "err" => e.message.clone() });
            // Restricted user: fall back to the connection's auth_db (SCRAM /
            // Legacy-CR only); other modes have no client-side hint → empty list.
            let sql = state.open_db().map_err(|e| e.to_string())?;
            let connection = connection_store::get(&sql, &connection_id)
                .map_err(|e| e.to_string())?
                .ok_or("connection not found")?;
            match default_db_for_unauthorized(&connection) {
                Some(db) => Ok(vec![db]),
                None => Ok(vec![]),
            }
        }
        Err(e) => {
            log.error("list_databases failed", logctx! { "err" => e.message.clone() });
            Err(e.into())
        }
    }
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<Vec<CollectionNode>, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
    });
    log.info("list_collections", logctx! {});
    let data = mongo::harness_data(
        &state,
        &connection_id,
        &database,
        mongo::data_op::LIST_COLLECTIONS,
        serde_json::json!({}),
        state.logger.clone(),
    )
    .await
    .map_err(|e| {
        log.error("list_collections failed", logctx! { "err" => e.message.clone() });
        String::from(e)
    })?;
    Ok(data_strings(&data)
        .into_iter()
        .map(|name| CollectionNode { name })
        .collect())
}

#[tauri::command]
pub async fn list_indexes(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<Vec<IndexInfo>, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
    });
    log.info("list_indexes", logctx! {});
    let data = mongo::harness_data(
        &state,
        &connection_id,
        &database,
        mongo::data_op::LIST_INDEXES,
        serde_json::json!({ "collection": collection }),
        state.logger.clone(),
    )
    .await
    .map_err(|e| {
        log.error("list_indexes failed", logctx! { "err" => e.message.clone() });
        String::from(e)
    })?;

    let mut out = Vec::new();
    for idx in data.as_array().cloned().unwrap_or_default() {
        let name = idx
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("(unnamed)")
            .to_string();
        let keys = match idx.get("key") {
            Some(key) => mongo::ejson_to_value(key.clone()).unwrap_or(serde_json::Value::Null),
            None => serde_json::Value::Null,
        };
        out.push(IndexInfo { name, keys });
    }
    Ok(out)
}

#[tauri::command]
pub async fn browse_collection(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    page: i64,
    page_size: i64,
) -> Result<BrowsePage, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
    });
    log.info("browse_collection", logctx! {
        "page" => page,
        "pageSize" => page_size,
    });
    let data = mongo::harness_data(
        &state,
        &connection_id,
        &database,
        mongo::data_op::FIND,
        serde_json::json!({
            "collection": collection,
            "filter": {},
            "page": page.max(0),
            "pageSize": page_size,
        }),
        state.logger.clone(),
    )
    .await
    .map_err(|e| {
        log.error("browse_collection failed", logctx! { "err" => e.message.clone() });
        String::from(e)
    })?;

    let total = data.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut docs = Vec::new();
    for doc in data
        .get("docs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
    {
        docs.push(mongo::ejson_to_value(doc).map_err(|e| {
            log.error("browse doc decode failed", logctx! { "err" => e.clone() });
            e
        })?);
    }
    Ok(BrowsePage { docs, total, page, page_size })
}

#[tauri::command]
pub async fn analyze_schema(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    sample_size: i64,
) -> Result<serde_json::Value, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.collection",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
    });
    log.info("analyze_schema", logctx! { "sampleSize" => sample_size });
    mongo::harness_data(
        &state,
        &connection_id,
        &database,
        mongo::data_op::ANALYZE_SCHEMA,
        serde_json::json!({ "collection": collection, "sampleSize": sample_size }),
        state.logger.clone(),
    )
    .await
    .map_err(|e| {
        log.error("analyze_schema failed", logctx! { "err" => e.message.clone() });
        String::from(e)
    })
}

/// Best-effort default-database name for the Unauthorized fallback in
/// `list_databases`. Only SCRAM and Legacy-CR auth modes carry an explicit
/// `auth_db`; other modes have no comparable client-side hint. `admin` is
/// filtered out because it's the auth realm, not a user DB.
fn default_db_for_unauthorized(c: &Connection) -> Option<String> {
    let candidate = match &c.auth {
        AuthMode::Scram { auth_db, .. } | AuthMode::LegacyCr { auth_db, .. } => auth_db.clone(),
        _ => return None,
    };
    if candidate.is_empty() || candidate == "admin" {
        None
    } else {
        Some(candidate)
    }
}
