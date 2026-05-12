use mongodb::error::{Error as MongoError, ErrorKind};

/// Returns true if the error is an `Unauthorized` (code 13) command failure.
/// Used to swallow metadata-listing failures for restricted users and degrade gracefully.
pub fn is_unauthorized(err: &MongoError) -> bool {
    if let ErrorKind::Command(cmd) = err.kind.as_ref() {
        // MongoDB error code 13 = Unauthorized.
        if cmd.code == 13 {
            return true;
        }
        if cmd.code_name.eq_ignore_ascii_case("Unauthorized") {
            return true;
        }
    }
    // String fallback for transport-layer wrappers.
    err.to_string().to_lowercase().contains("not authorized")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mongodb 3.x driver doesn't expose a public `Error::custom` constructor,
    /// so we build an error via `From<std::io::Error>`. `is_unauthorized` checks
    /// `err.to_string()` as a string fallback, so the message content drives the test.
    fn make_err(msg: &str) -> MongoError {
        MongoError::from(std::io::Error::new(std::io::ErrorKind::Other, msg.to_string()))
    }

    #[test]
    fn detects_not_authorized_text() {
        let err = make_err("not authorized on admin to execute command listDatabases");
        assert!(is_unauthorized(&err));
    }

    #[test]
    fn ignores_other_errors() {
        let err = make_err("network timeout");
        assert!(!is_unauthorized(&err));
    }
}
