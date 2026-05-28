// Rust mirror of the TypeScript tagged-union connection model
// (see src/connection/model.ts). The shared JSON fixtures under
// tests/fixtures/connection/ are the wire-format contract — round-tripped
// by model_contract_tests.rs.
//
// Conventions:
//   * Every tagged-union enum uses `#[serde(tag = "kind", rename_all = "kebab-case")]`.
//     Variants whose kebab-case spelling is ambiguous (e.g. `X509`, SCRAM
//     mechanism names with embedded SHA versions) carry an explicit
//     `#[serde(rename = "...")]`.
//   * Every struct uses `#[serde(rename_all = "camelCase")]` so JSON keys
//     match the TS object-literal keys.
//   * Optional fields are `Option<T>` + `#[serde(skip_serializing_if = "Option::is_none")]`
//     so an absent TS field round-trips to an absent JSON key (not `null`).
//   * Tls is modelled as a flat struct rather than an enum: TS discriminates
//     on the *value* of `enabled`, not on a `kind` tag, and a struct with
//     optional fields reproduces both `{ "enabled": false }` and
//     `{ "enabled": true, "allowInvalidCerts": ..., ... }` exactly.

use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────────────────────────────────
// AuthMode
// ──────────────────────────────────────────────────────────────────────────

/// SCRAM negotiation mechanism. `Auto` lets the driver pick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScramMechanism {
    #[serde(rename = "SCRAM-SHA-1")]
    ScramSha1,
    #[serde(rename = "SCRAM-SHA-256")]
    ScramSha256,
    #[serde(rename = "auto")]
    Auto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AuthMode {
    None,
    Scram {
        username: String,
        #[serde(rename = "authDb")]
        auth_db: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mechanism: Option<ScramMechanism>,
    },
    #[serde(rename = "legacy-cr")]
    LegacyCr {
        username: String,
        #[serde(rename = "authDb")]
        auth_db: String,
    },
    #[serde(rename = "x509")]
    X509 {
        #[serde(rename = "certFile")]
        cert_file: String,
        #[serde(
            rename = "certKeyFile",
            skip_serializing_if = "Option::is_none"
        )]
        cert_key_file: Option<String>,
    },
    Ldap {
        username: String,
    },
    Kerberos {
        principal: String,
        #[serde(
            rename = "serviceName",
            skip_serializing_if = "Option::is_none"
        )]
        service_name: Option<String>,
        #[serde(
            rename = "canonicalizeHostName",
            skip_serializing_if = "Option::is_none"
        )]
        canonicalize_host_name: Option<bool>,
    },
    #[serde(rename = "aws-iam")]
    AwsIam {
        #[serde(
            rename = "accessKeyId",
            skip_serializing_if = "Option::is_none"
        )]
        access_key_id: Option<String>,
        #[serde(
            rename = "sessionToken",
            skip_serializing_if = "Option::is_none"
        )]
        session_token: Option<String>,
        #[serde(
            rename = "useEnvCreds",
            skip_serializing_if = "Option::is_none"
        )]
        use_env_creds: Option<bool>,
    },
    Oidc {
        #[serde(skip_serializing_if = "Option::is_none")]
        principal: Option<String>,
        #[serde(
            rename = "providerName",
            skip_serializing_if = "Option::is_none"
        )]
        provider_name: Option<String>,
    },
}

// ──────────────────────────────────────────────────────────────────────────
// ConnectionTarget
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadPreference {
    Primary,
    PrimaryPreferred,
    Secondary,
    SecondaryPreferred,
    Nearest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ConnectionTarget {
    Uri {
        uri: String,
    },
    #[serde(rename_all = "camelCase")]
    Direct {
        host: String,
        port: u16,
        #[serde(skip_serializing_if = "Option::is_none")]
        replica_set: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        read_preference: Option<ReadPreference>,
        #[serde(skip_serializing_if = "Option::is_none")]
        direct_connection: Option<bool>,
    },
}

// ──────────────────────────────────────────────────────────────────────────
// TLS
// ──────────────────────────────────────────────────────────────────────────

/// TLS settings. Discriminated by the *value* of `enabled` rather than a
/// `kind` tag; modelled here as a flat struct so absent options round-trip
/// to absent JSON keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tls {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_invalid_certs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_invalid_hostnames: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ca_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_cert_file: Option<String>,
}

// ──────────────────────────────────────────────────────────────────────────
// SSH tunnel
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SshAuth {
    Password,
    #[serde(rename_all = "camelCase")]
    Key {
        key_path: String,
        has_passphrase: bool,
    },
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KnownHostsPolicy {
    Strict,
    AddAndTrust,
    AcceptAny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    pub known_hosts_policy: KnownHostsPolicy,
}

// ──────────────────────────────────────────────────────────────────────────
// Proxy
// ──────────────────────────────────────────────────────────────────────────

/// Proxy protocol. `kind` is a plain field on `Proxy`, not a union
/// discriminator — the carrier struct shape is identical across protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyKind {
    Http,
    Socks4,
    Socks5,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProxyAuth {
    pub username: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proxy {
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<ProxyAuth>,
}

// ──────────────────────────────────────────────────────────────────────────
// Overrides
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelliShellOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_complete_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_limit: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mongodump_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mongorestore_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mongoexport_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mongoimport_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Compressor {
    Snappy,
    Zlib,
    Zstd,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_writes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_reads: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressors: Option<Vec<Compressor>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_selection_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connect_timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub socket_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overrides {
    #[serde(rename = "intelliShell", skip_serializing_if = "Option::is_none")]
    pub intelli_shell: Option<IntelliShellOverrides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<ToolsOverrides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advanced: Option<AdvancedOverrides>,
}

// ──────────────────────────────────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub target: ConnectionTarget,
    pub auth: AuthMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tls: Option<Tls>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh: Option<SshTunnel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<Proxy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overrides: Option<Overrides>,
    pub created_at: String,
}
