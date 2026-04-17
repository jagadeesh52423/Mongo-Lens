use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.mongomacapp.app";

pub fn account_for(connection_id: &str) -> String {
    format!("mongomacapp.{}", connection_id)
}

pub fn set_password(connection_id: &str, password: &str) -> Result<(), String> {
    let account = account_for(connection_id);
    set_generic_password(SERVICE, &account, password.as_bytes())
        .map_err(|e| e.to_string())
}

pub fn get_password(connection_id: &str) -> Result<Option<String>, String> {
    let account = account_for(connection_id);
    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => {
            let s = String::from_utf8(bytes).map_err(|e| e.to_string())?;
            Ok(Some(s))
        }
        Err(e) => {
            // errSecItemNotFound = -25300
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                Ok(None)
            } else {
                Err(e.to_string())
            }
        }
    }
}

pub fn delete_password(connection_id: &str) -> Result<(), String> {
    let account = account_for(connection_id);
    match delete_generic_password(SERVICE, &account) {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_format() {
        assert_eq!(account_for("abc"), "mongomacapp.abc");
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2").unwrap();
        let got = get_password(&id).unwrap();
        assert_eq!(got.as_deref(), Some("hunter2"));
        delete_password(&id).unwrap();
        let after = get_password(&id).unwrap();
        assert!(after.is_none());
    }
}
