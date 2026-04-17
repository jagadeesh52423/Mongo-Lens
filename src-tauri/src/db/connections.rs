use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub auth_db: Option<String>,
    pub username: Option<String>,
    pub conn_string: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_key_path: Option<String>,
    pub created_at: String,
}

fn map_row(row: &Row) -> rusqlite::Result<ConnectionRecord> {
    Ok(ConnectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        auth_db: row.get(4)?,
        username: row.get(5)?,
        conn_string: row.get(6)?,
        ssh_host: row.get(7)?,
        ssh_port: row.get(8)?,
        ssh_user: row.get(9)?,
        ssh_key_path: row.get(10)?,
        created_at: row.get(11)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ConnectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
         FROM connections ORDER BY name",
    )?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<ConnectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
         FROM connections WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn insert(conn: &Connection, rec: &ConnectionRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO connections (id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            rec.id, rec.name, rec.host, rec.port, rec.auth_db, rec.username,
            rec.conn_string, rec.ssh_host, rec.ssh_port, rec.ssh_user, rec.ssh_key_path,
            rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &ConnectionRecord) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE connections SET name=?2,host=?3,port=?4,auth_db=?5,username=?6,conn_string=?7,
            ssh_host=?8,ssh_port=?9,ssh_user=?10,ssh_key_path=?11 WHERE id=?1",
        params![
            rec.id, rec.name, rec.host, rec.port, rec.auth_db, rec.username,
            rec.conn_string, rec.ssh_host, rec.ssh_port, rec.ssh_user, rec.ssh_key_path,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str, name: &str) -> ConnectionRecord {
        ConnectionRecord {
            id: id.into(),
            name: name.into(),
            host: Some("localhost".into()),
            port: Some(27017),
            auth_db: Some("admin".into()),
            username: Some("u".into()),
            conn_string: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_key_path: None,
            created_at: "2026-04-17T00:00:00Z".into(),
        }
    }

    #[test]
    fn insert_then_list() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        insert(&c, &sample("2", "prod")).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "local");
        assert_eq!(rows[1].name, "prod");
    }

    #[test]
    fn update_changes_name() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        let mut rec = sample("1", "renamed");
        update(&c, &rec).unwrap();
        rec = get(&c, "1").unwrap().unwrap();
        assert_eq!(rec.name, "renamed");
    }

    #[test]
    fn delete_removes_row() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        delete(&c, "1").unwrap();
        assert!(get(&c, "1").unwrap().is_none());
    }
}
