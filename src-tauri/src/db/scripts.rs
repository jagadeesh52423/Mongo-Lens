use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScriptRecord {
    pub id: String,
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
    pub connection_id: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

/// Parse the stored TEXT column into the canonical tag list:
/// trim, drop empties, case-insensitive dedupe, preserve first-seen order.
pub fn parse_tags(raw: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let t = part.trim();
        if t.is_empty() {
            continue;
        }
        let lower = t.to_lowercase();
        if seen.iter().any(|s| s.to_lowercase() == lower) {
            continue;
        }
        seen.push(t.to_string());
    }
    seen
}

pub fn serialize_tags(tags: &[String]) -> String {
    parse_tags(&tags.join(",")).join(",")
}

fn map_row(row: &Row) -> rusqlite::Result<SavedScriptRecord> {
    let raw_tags: String = row.get(3)?;
    Ok(SavedScriptRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        tags: parse_tags(&raw_tags),
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
    let tags_str = serialize_tags(&rec.tags);
    conn.execute(
        "INSERT INTO saved_scripts (id,name,content,tags,connection_id,last_run_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            rec.id,
            rec.name,
            rec.content,
            tags_str,
            rec.connection_id,
            rec.last_run_at,
            rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    let tags_str = serialize_tags(&rec.tags);
    conn.execute(
        "UPDATE saved_scripts SET name=?2,content=?3,tags=?4,connection_id=?5 WHERE id=?1",
        params![rec.id, rec.name, rec.content, tags_str, rec.connection_id],
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

/// Rename `old` → `new` across all scripts. Case-insensitive match on `old`.
/// Returns number of affected rows.
pub fn rename_tag_everywhere(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<usize> {
    let old_lower = old.trim().to_lowercase();
    let new_trim = new.trim();
    if old_lower.is_empty() || new_trim.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare("SELECT id, tags FROM saved_scripts")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut affected = 0usize;
    for (id, raw) in rows {
        let parsed = parse_tags(&raw);
        let mut changed = false;
        let mapped: Vec<String> = parsed
            .into_iter()
            .map(|t| {
                if t.to_lowercase() == old_lower {
                    changed = true;
                    new_trim.to_string()
                } else {
                    t
                }
            })
            .collect();
        if changed {
            let canonical = serialize_tags(&mapped);
            conn.execute(
                "UPDATE saved_scripts SET tags = ?2 WHERE id = ?1",
                params![id, canonical],
            )?;
            affected += 1;
        }
    }
    Ok(affected)
}

/// Delete `tag` from every script that has it. Case-insensitive match.
/// Returns number of affected rows.
pub fn delete_tag_everywhere(conn: &Connection, tag: &str) -> rusqlite::Result<usize> {
    let target = tag.trim().to_lowercase();
    if target.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare("SELECT id, tags FROM saved_scripts")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut affected = 0usize;
    for (id, raw) in rows {
        let parsed = parse_tags(&raw);
        let kept: Vec<String> = parsed
            .iter()
            .filter(|t| t.to_lowercase() != target)
            .cloned()
            .collect();
        if kept.len() != parsed.len() {
            let canonical = serialize_tags(&kept);
            conn.execute(
                "UPDATE saved_scripts SET tags = ?2 WHERE id = ?1",
                params![id, canonical],
            )?;
            affected += 1;
        }
    }
    Ok(affected)
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
            tags: vec!["mongo".into(), "find".into()],
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

    #[test]
    fn parse_tags_trims_dedupes_drops_empty() {
        assert_eq!(parse_tags(""), Vec::<String>::new());
        assert_eq!(parse_tags(" , ,, "), Vec::<String>::new());
        assert_eq!(
            parse_tags("a, b ,A,, b "),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn round_trip_preserves_canonical_tags() {
        let c = open_in_memory().unwrap();
        let mut rec = sample("1", "a");
        rec.tags = vec!["Prod".into(), "auth".into(), "PROD".into(), "  ".into()];
        insert(&c, &rec).unwrap();
        let got = get(&c, "1").unwrap().unwrap();
        assert_eq!(got.tags, vec!["Prod".to_string(), "auth".to_string()]);
    }

    #[test]
    fn rename_tag_everywhere_renames_and_dedupes() {
        let c = open_in_memory().unwrap();
        let mut r1 = sample("1", "a");
        r1.tags = vec!["prod".into(), "auth".into()];
        let mut r2 = sample("2", "b");
        r2.tags = vec!["PROD".into()];
        let mut r3 = sample("3", "c");
        r3.tags = vec!["other".into()];
        insert(&c, &r1).unwrap();
        insert(&c, &r2).unwrap();
        insert(&c, &r3).unwrap();
        let n = rename_tag_everywhere(&c, "prod", "production").unwrap();
        assert_eq!(n, 2);
        assert_eq!(
            get(&c, "1").unwrap().unwrap().tags,
            vec!["production".to_string(), "auth".to_string()]
        );
        assert_eq!(
            get(&c, "2").unwrap().unwrap().tags,
            vec!["production".to_string()]
        );
        assert_eq!(
            get(&c, "3").unwrap().unwrap().tags,
            vec!["other".to_string()]
        );
    }

    #[test]
    fn rename_collapses_when_target_already_present() {
        let c = open_in_memory().unwrap();
        let mut r = sample("1", "a");
        r.tags = vec!["prod".into(), "production".into()];
        insert(&c, &r).unwrap();
        let n = rename_tag_everywhere(&c, "prod", "production").unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            get(&c, "1").unwrap().unwrap().tags,
            vec!["production".to_string()]
        );
    }

    #[test]
    fn delete_tag_everywhere_removes_case_insensitively() {
        let c = open_in_memory().unwrap();
        let mut r1 = sample("1", "a");
        r1.tags = vec!["Prod".into(), "auth".into()];
        let mut r2 = sample("2", "b");
        r2.tags = vec!["other".into()];
        insert(&c, &r1).unwrap();
        insert(&c, &r2).unwrap();
        let n = delete_tag_everywhere(&c, "prod").unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            get(&c, "1").unwrap().unwrap().tags,
            vec!["auth".to_string()]
        );
        assert_eq!(
            get(&c, "2").unwrap().unwrap().tags,
            vec!["other".to_string()]
        );
    }
}
