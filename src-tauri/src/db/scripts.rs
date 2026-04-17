use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScriptRecord {
    pub id: String,
    pub name: String,
    pub content: String,
    pub tags: String,
    pub connection_id: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

fn map_row(row: &Row) -> rusqlite::Result<SavedScriptRecord> {
    Ok(SavedScriptRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        tags: row.get(3)?,
        connection_id: row.get(4)?,
        last_run_at: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<SavedScriptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,content,tags,connection_id,last_run_at,created_at
         FROM saved_scripts ORDER BY name",
    )?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<SavedScriptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,content,tags,connection_id,last_run_at,created_at
         FROM saved_scripts WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn insert(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO saved_scripts (id,name,content,tags,connection_id,last_run_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            rec.id, rec.name, rec.content, rec.tags,
            rec.connection_id, rec.last_run_at, rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE saved_scripts SET name=?2,content=?3,tags=?4,connection_id=?5 WHERE id=?1",
        params![rec.id, rec.name, rec.content, rec.tags, rec.connection_id],
    )?;
    Ok(())
}

pub fn touch(conn: &Connection, id: &str, ts: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE saved_scripts SET last_run_at=?2 WHERE id=?1",
        params![id, ts],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM saved_scripts WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str, name: &str) -> SavedScriptRecord {
        SavedScriptRecord {
            id: id.into(),
            name: name.into(),
            content: "db.users.find({})".into(),
            tags: "mongo,find".into(),
            connection_id: None,
            last_run_at: None,
            created_at: "2026-04-17T00:00:00Z".into(),
        }
    }

    #[test]
    fn insert_then_list_scripts() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "a")).unwrap();
        insert(&c, &sample("2", "b")).unwrap();
        assert_eq!(list(&c).unwrap().len(), 2);
    }

    #[test]
    fn touch_sets_last_run() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "a")).unwrap();
        touch(&c, "1", "2026-04-18T10:00:00Z").unwrap();
        let s = get(&c, "1").unwrap().unwrap();
        assert_eq!(s.last_run_at.as_deref(), Some("2026-04-18T10:00:00Z"));
    }
}
