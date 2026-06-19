use crate::logctx;
use crate::mongo;
use crate::state::AppState;
use mongodb::bson::{doc, oid::ObjectId, Bson, Document};
use tauri::State;

fn id_filter(id: &str) -> Document {
    match ObjectId::parse_str(id) {
        // Hex string could be stored as ObjectId or as a plain string — match either.
        Ok(oid) => doc! { "$or": [{ "_id": oid }, { "_id": id }] },
        Err(_) => doc! { "_id": id },
    }
}

/// Serialize a filter/update `Document` to canonical Extended JSON for the
/// harness wire, so BSON types (ObjectId, exact int width, Date) survive and the
/// harness reconstructs the SAME BSON the Rust driver would have sent.
fn to_ejson(doc: Document) -> serde_json::Value {
    Bson::from(doc).into_canonical_extjson()
}

#[tauri::command]
pub async fn update_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
    update_json: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.document",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
        "docId" => id.clone(),
    });
    log.info("update_document", logctx! {});
    let value: serde_json::Value = serde_json::from_str(&update_json).map_err(|e| {
        log.error("invalid update JSON", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let bson_value = mongodb::bson::to_bson(&value).map_err(|e| {
        log.error("bson conversion failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let mut updated: Document = match bson_value {
        Bson::Document(d) => d,
        _ => {
            log.error("updateJson not an object", logctx! {});
            return Err("updateJson must be a JSON object".into());
        }
    };
    updated.remove("_id");

    let args = serde_json::json!({
        "collection": collection,
        "filter": to_ejson(id_filter(&id)),
        "update": to_ejson(doc! { "$set": updated }),
    });
    let data = mongo::harness_data(&state, &connection_id, &database, mongo::data_op::UPDATE_ONE, args, state.logger.clone())
        .await
        .map_err(|e| {
            log.error("update_one failed", logctx! { "err" => e.message.clone() });
            String::from(e)
        })?;

    if data.get("matchedCount").and_then(|v| v.as_i64()).unwrap_or(0) == 0 {
        log.warn("document not found", logctx! {});
        return Err(format!("Document not found (id={})", id));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.document",
        "connId" => connection_id.clone(),
        "db" => database.clone(),
        "coll" => collection.clone(),
        "docId" => id.clone(),
    });
    log.info("delete_document", logctx! {});

    let args = serde_json::json!({
        "collection": collection,
        "filter": to_ejson(id_filter(&id)),
    });
    mongo::harness_data(&state, &connection_id, &database, mongo::data_op::DELETE_ONE, args, state.logger.clone())
        .await
        .map_err(|e| {
            log.error("delete_one failed", logctx! { "err" => e.message.clone() });
            String::from(e)
        })?;
    Ok(())
}
