use crate::logctx;
use crate::mongo;
use crate::state::AppState;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, Document};
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
    let client = mongo::active_client(&state, &connection_id)?;
    let names = client
        .list_database_names()
        .await
        .map_err(|e| {
            log.error("list_database_names failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;
    Ok(names.into_iter().filter(|n| n != "local").collect())
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
    let client = mongo::active_client(&state, &connection_id)?;
    let mut names = client
        .database(&database)
        .list_collection_names()
        .authorized_collections(true)
        .await
        .map_err(|e| {
            log.error("list_collection_names failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;
    names.sort();
    Ok(names.into_iter().map(|name| CollectionNode { name }).collect())
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
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let mut cursor = coll.list_indexes().await.map_err(|e| {
        log.error("list_indexes failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let mut out = Vec::new();
    while let Some(idx) = cursor.try_next().await.map_err(|e| {
        log.error("index cursor failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })? {
        let name = idx
            .options
            .and_then(|o| o.name)
            .unwrap_or_else(|| "(unnamed)".into());
        let keys_json = serde_json::to_value(&idx.keys).unwrap_or(serde_json::Value::Null);
        out.push(IndexInfo { name, keys: keys_json });
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
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let total = coll
        .count_documents(doc! {})
        .await
        .map_err(|e| {
            log.error("count_documents failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })? as i64;
    let skip = (page.max(0)) * page_size;
    let find_opts = mongodb::options::FindOptions::builder()
        .skip(skip as u64)
        .limit(page_size)
        .build();
    let mut cursor = coll
        .find(doc! {})
        .with_options(find_opts)
        .await
        .map_err(|e| {
            log.error("find failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await.map_err(|e| {
        log.error("doc cursor failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })? {
        let json: serde_json::Value =
            mongodb::bson::to_bson(&d).map_err(|e| e.to_string())?.into();
        docs.push(json);
    }
    Ok(BrowsePage { docs, total, page, page_size })
}
