use crate::logctx;
use crate::logger::Logger;
use security_framework::item::{ItemClass, ItemSearchOptions};
use security_framework::os::macos::keychain::SecKeychain;
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.mongomacapp.app";

pub fn account_for(connection_id: &str) -> String {
    format!("mongomacapp.{}", connection_id)
}

/// Pre-authorizes keychain access at app startup.
///
/// Verifies the default keychain is reachable, then performs a non-destructive
/// probe of any existing items owned by this app (service = [`SERVICE`]).
/// Requesting item data (`load_data`) forces macOS to evaluate the item's
/// access-control list, which triggers the "allow / always allow" dialog if
/// the current binary is not yet trusted.
///
/// Once the user clicks **Always Allow**, macOS adds the binary to the item's
/// ACL and subsequent accesses proceed silently.
///
/// Returns `Ok(())` even if no items exist yet (nothing to pre-authorize).
/// Returns `Err` only if the keychain subsystem is entirely inaccessible.
pub fn authorize_keychain_access(log: &dyn Logger) -> Result<(), String> {
    log.info("keychain pre-auth starting", logctx! {});

    // Verify the default (login) keychain is reachable. This confirms the
    // Security framework is functional and the keychain was unlocked at login.
    let _keychain = SecKeychain::default().map_err(|e| {
        log.error("default keychain inaccessible", logctx! {
            "err" => e.to_string(),
        });
        e.to_string()
    })?;

    // Probe for existing app items. Requesting kSecReturnData via
    // `load_data(true)` forces macOS to check the item's ACL before
    // returning data — this is what triggers the access prompt.
    //
    // We intentionally limit to 1 item. Legacy keychain items (created via
    // SecKeychainAddGenericPassword) have per-item ACLs: "Always Allow"
    // grants the current binary access to that specific item only.  If the
    // user has N saved connections and the binary changed (update or dev
    // rebuild), probing all items would show N sequential dialogs at
    // startup — terrible UX.  With limit(1) the user sees at most one
    // prompt here; remaining items are prompted on-demand when each
    // connection is actually used, which is contextually appropriate.
    let mut search = ItemSearchOptions::new();
    search
        .class(ItemClass::generic_password())
        .service(SERVICE)
        .load_data(true)
        .limit(1);

    match search.search() {
        Ok(results) => {
            log.info("keychain pre-auth: items accessible", logctx! {
                "count" => results.len(),
            });
        }
        Err(e) => {
            let msg = e.to_string();
            // errSecItemNotFound (-25300): no items exist yet — expected on
            // first run, nothing to pre-authorize.
            if msg.contains("-25300")
                || msg.contains("not found")
                || msg.contains("could not be found")
            {
                log.info("keychain pre-auth: no existing items", logctx! {});
            } else if msg.contains("-25293") || msg.contains("denied") {
                // errSecAuthFailed: user denied access in the dialog.
                log.warn("keychain pre-auth: access denied by user", logctx! {
                    "err" => msg,
                });
            } else {
                log.warn("keychain pre-auth: probe returned error", logctx! {
                    "err" => msg,
                });
            }
        }
    }

    log.info("keychain pre-auth complete", logctx! {});
    Ok(())
}

pub fn set_password(connection_id: &str, password: &str, log: &dyn Logger) -> Result<(), String> {
    let account = account_for(connection_id);
    // NEVER log `password` — only log that a set happened.
    match set_generic_password(SERVICE, &account, password.as_bytes()) {
        Ok(()) => {
            log.info("keychain set", logctx! { "connId" => connection_id });
            Ok(())
        }
        Err(e) => {
            log.error("keychain set failed", logctx! {
                "connId" => connection_id,
                "err" => e.to_string(),
            });
            Err(e.to_string())
        }
    }
}

pub fn get_password(connection_id: &str, log: &dyn Logger) -> Result<Option<String>, String> {
    let account = account_for(connection_id);
    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => {
            // NEVER log the returned secret — only its presence.
            let s = String::from_utf8(bytes).map_err(|e| {
                log.error("keychain utf8 decode failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                e.to_string()
            })?;
            log.info("keychain get", logctx! {
                "connId" => connection_id,
                "found" => true,
            });
            Ok(Some(s))
        }
        Err(e) => {
            // errSecItemNotFound = -25300
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                log.info("keychain get", logctx! {
                    "connId" => connection_id,
                    "found" => false,
                });
                Ok(None)
            } else {
                log.error("keychain get failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                Err(e.to_string())
            }
        }
    }
}

pub fn delete_password(connection_id: &str, log: &dyn Logger) -> Result<(), String> {
    let account = account_for(connection_id);
    match delete_generic_password(SERVICE, &account) {
        Ok(()) => {
            log.info("keychain delete", logctx! { "connId" => connection_id });
            Ok(())
        }
        Err(e) => {
            let msg = format!("{}", e);
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("could not be found") {
                log.debug("keychain delete noop (not found)", logctx! {
                    "connId" => connection_id,
                });
                Ok(())
            } else {
                log.error("keychain delete failed", logctx! {
                    "connId" => connection_id,
                    "err" => e.to_string(),
                });
                Err(e.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::MemoryLogger;

    #[test]
    fn account_format() {
        assert_eq!(account_for("abc"), "mongomacapp.abc");
    }

    #[test]
    fn authorize_keychain_access_succeeds() {
        // Suppress keychain UI dialogs so the test doesn't hang when
        // existing items have ACLs that don't include this binary.
        // The _lock RAII guard re-enables interaction on drop.
        let _lock = SecKeychain::disable_user_interaction()
            .expect("disable_user_interaction");

        let log = MemoryLogger::new("test");
        // Must return Ok regardless of whether items exist or the probe
        // is denied — the function only fails if the keychain subsystem
        // itself is unreachable.
        let result = authorize_keychain_access(log.as_ref());
        assert!(result.is_ok(), "authorize_keychain_access failed: {:?}", result);

        let records = log.records();
        assert!(records.iter().any(|r| r.msg == "keychain pre-auth starting"));
        assert!(records.iter().any(|r| r.msg == "keychain pre-auth complete"));
        // No errors should have been logged (warnings are fine).
        assert!(
            !records.iter().any(|r| r.level == crate::logger::Level::Error),
            "unexpected error log: {:?}",
            records.iter().filter(|r| r.level == crate::logger::Level::Error).collect::<Vec<_>>(),
        );
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let log = MemoryLogger::new("test");
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2", log.as_ref()).unwrap();
        let got = get_password(&id, log.as_ref()).unwrap();
        assert_eq!(got.as_deref(), Some("hunter2"));
        delete_password(&id, log.as_ref()).unwrap();
        let after = get_password(&id, log.as_ref()).unwrap();
        assert!(after.is_none());
    }
}
