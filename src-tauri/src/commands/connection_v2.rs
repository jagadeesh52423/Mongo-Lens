// IPC commands for the new tagged-union connection model
// (`connections_v2_*`). Gated at the registration site by `CONN_V2`
// (see `main.rs`); the legacy `commands::connection::*` handlers stay
// active unconditionally so the old dialog keeps working.
//
// Command shape — JSON wire keys are camelCase, matching the TS twins in
// `src/connection/ipc.ts`:
//
//   connections_v2_list   ()                 -> Vec<Connection>
//   connections_v2_save   (input: SaveInput) -> Connection
//   connections_v2_delete (id: String)       -> ()
//   connections_v2_test   (input: SaveInput) -> TestResultV2
//
// `SaveInput` carries a `Connection` plus a flat list of `SecretInput`
// rows ({ slot, value }). For save: each row is written through the
// `SecretStore`. For test: rows are consumed straight into a
// `ResolvedConnection` — no Keychain touch — so the dialog can validate
// pre-save form values.
//
// Extension contract: new secret kinds register themselves in
// `crate::connection::secrets::SecretSlot` (wire string in `as_wire` /
// `from_wire`). This module's per-row dispatch maps each `SecretSlot`
// variant to the matching `ResolvedConnection` field — add the new
// variant there and no callers update.

use crate::connection::builder::{
    build_client_options, BuildError, BuildOutcome, BuildStage, ResolvedConnection,
};
use crate::connection::model::Connection;
use crate::connection::secrets::{SecretError, SecretSlot, SecretStore};
use crate::connection::store;
use crate::logctx;
use crate::logger::Logger;
use crate::prefs;
use crate::ssh::TunnelHandle;
use crate::state::AppState;
use mongodb::bson::doc;
use mongodb::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

// ──────────────────────────────────────────────────────────────────────────
// Inputs
// ──────────────────────────────────────────────────────────────────────────

/// One pre-save secret value, identified by its wire-format slot name
/// (`"auth-password"`, `"ssh-password"`, …). Unknown slot strings are
/// rejected by `save` and ignored by `test` — see the call sites for the
/// exact policy.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretInput {
    pub slot: String,
    pub value: String,
}

/// Carrier for `connections_v2_save` and `connections_v2_test`. The
/// `Connection` is the full tagged-union form; `secrets` is the flat
/// slot/value list, decoupled from the connection payload so secrets
/// never end up serialized into the connections_v2 row.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    pub connection: Connection,
    pub secrets: Vec<SecretInput>,
}

// ──────────────────────────────────────────────────────────────────────────
// TestResult — wire-format matches the TS discriminated union
//
//   { ok: true,  serverInfo: ... }
//   { ok: false, stage: 'ssh'|'tls'|'auth'|'ping', error: ... }
//
// Modelled here as two structs + an untagged enum so the boolean `ok`
// rides as a plain field (the TS twin uses `ok: true | false`, not a
// string tag).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResultOk {
    /// Always `true`. Carried explicitly so the TS side can discriminate
    /// on `result.ok` without inspecting structural keys.
    pub ok: bool,
    pub server_info: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResultFail {
    /// Always `false`. See [`TestResultOk::ok`].
    pub ok: bool,
    pub stage: BuildStage,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum TestResultV2 {
    Ok(TestResultOk),
    Fail(TestResultFail),
}

impl TestResultV2 {
    fn success(server_info: serde_json::Value) -> Self {
        TestResultV2::Ok(TestResultOk {
            ok: true,
            server_info,
        })
    }
    fn failure(stage: BuildStage, error: impl Into<String>) -> Self {
        TestResultV2::Fail(TestResultFail {
            ok: false,
            stage,
            error: error.into(),
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/// Resolve the installed [`SecretStore`]. Returns an error string suitable
/// for the IPC boundary when `CONN_V2` is disabled (the store is `None`).
fn secret_store(state: &AppState) -> Result<Arc<dyn SecretStore>, String> {
    state
        .connection_secrets()
        .ok_or_else(|| "CONN_V2 not enabled: v2 secret store is not installed".to_string())
}

/// Project a flat `SecretInput[]` onto a `ResolvedConnection`, starting from an
/// empty bag. Test-only: the runtime `test`/`connect` paths resolve from the
/// keychain first (see [`overlay_input_secrets`]). Kept to document and pin the
/// slot→field mapping under test.
#[cfg(test)]
fn build_resolved<'a>(conn: &'a Connection, secrets: &[SecretInput]) -> ResolvedConnection<'a> {
    let mut bag = SecretBag::default();
    overlay_input_secrets(&mut bag, secrets);
    bag.apply(conn)
}

// ──────────────────────────────────────────────────────────────────────────
// list / save / delete
// ──────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn connections_v2_list(state: State<'_, AppState>) -> Result<Vec<Connection>, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.connection_v2" });
    log.info("connections_v2_list", logctx! {});
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    store::list(&conn).map_err(|e| {
        log.error("store::list failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })
}

#[tauri::command]
pub fn connections_v2_save(
    state: State<'_, AppState>,
    input: SaveInput,
) -> Result<Connection, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.connection_v2" });
    log.info(
        "connections_v2_save",
        logctx! { "connId" => input.connection.id.clone(), "name" => input.connection.name.clone() },
    );

    // Reject unknown slots up-front — saving an unrecognised slot would
    // silently drop the secret on the floor, which is worse than failing
    // the save.
    for entry in &input.secrets {
        if SecretSlot::from_wire(&entry.slot).is_none() {
            log.warn(
                "connections_v2_save: unknown secret slot",
                logctx! { "slot" => entry.slot.clone() },
            );
            return Err(format!("unknown secret slot: {}", entry.slot));
        }
    }

    // A new connection arrives with an empty id; generate one here so both
    // the DB row and the secret store use the same stable id.
    let mut connection = input.connection;
    if connection.id.is_empty() {
        connection.id = Uuid::new_v4().to_string();
    }

    let secrets = secret_store(&state)?;

    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    store::upsert(&conn, &connection).map_err(|e| {
        log.error("store::upsert failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    // Write each secret slot. If one fails partway, earlier writes stay —
    // the user can retry the save without losing the row. Logged at warn.
    for entry in &input.secrets {
        let slot = SecretSlot::from_wire(&entry.slot)
            .expect("unknown slot rejected above");
        if let Err(e) = secrets.set(&connection.id, slot, &entry.value) {
            log.warn(
                "connections_v2_save: secret set failed",
                logctx! { "slot" => entry.slot.clone(), "err" => e.to_string() },
            );
            return Err(format!("failed to store secret '{}': {}", entry.slot, e));
        }
    }

    Ok(connection)
}

#[tauri::command]
pub fn connections_v2_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.connection_v2" });
    log.info("connections_v2_delete", logctx! { "connId" => id.clone() });

    let secrets = secret_store(&state)?;
    let conn = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    store::delete(&conn, &id).map_err(|e| {
        log.error("store::delete failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;

    // Best-effort secret cleanup. The row is already gone; logging a
    // warning is the right response if we orphan a slot — the user can
    // run a sweep later. Returning an error here would falsely tell the
    // caller the delete didn't happen.
    if let Err(e) = secrets.delete_all_for(&id) {
        log.warn(
            "connections_v2_delete: secret cleanup failed",
            logctx! { "err" => e.to_string() },
        );
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// get_secrets — slot presence query for the connection dialog
// ──────────────────────────────────────────────────────────────────────────

fn get_secrets_for_connection(
    store: &dyn SecretStore,
    connection_id: &str,
) -> std::result::Result<std::collections::HashMap<String, String>, SecretError> {
    let mut out = std::collections::HashMap::new();
    for &slot in SecretSlot::ALL {
        match store.get(connection_id, slot) {
            Ok(Some(v)) => {
                out.insert(slot.as_wire().to_string(), v);
            }
            Ok(None) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn connections_v2_get_secrets(
    state: State<'_, AppState>,
    id: String,
) -> Result<std::collections::HashMap<String, String>, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.connection_v2" });
    log.info("connections_v2_get_secrets", logctx! { "connId" => id.clone() });
    let secrets = secret_store(&state)?;
    get_secrets_for_connection(&*secrets, &id).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────────────────────────────────
// test
// ──────────────────────────────────────────────────────────────────────────

/// Validate a pre-save connection form by building `ClientOptions` from
/// the provided secrets and running a single `hello` round-trip. Never
/// touches the Keychain or `connections_v2` — purely a probe.
///
/// Tunnel ownership: when the connection has an SSH tunnel the builder
/// returns its [`TunnelHandle`] in the tuple. This command owns that
/// handle for the lifetime of the probe and closes it on every exit path
/// — success, hello-failure, and client-init failure — before returning.
/// No handle is leaked.
#[tauri::command]
pub async fn connections_v2_test(
    state: State<'_, AppState>,
    handle: AppHandle,
    input: SaveInput,
) -> Result<TestResultV2, String> {
    let log = state
        .logger
        .child(logctx! { "logger" => "commands.connection_v2" });
    log.info(
        "connections_v2_test",
        logctx! { "connId" => input.connection.id.clone(), "name" => input.connection.name.clone() },
    );

    // 1. Resolve effective prefs from the global store + this connection's overrides.
    let global = match prefs::load(&handle) {
        Ok(g) => g,
        Err(e) => {
            log.warn(
                "connections_v2_test: prefs load failed",
                logctx! { "err" => e.to_string() },
            );
            return Err(format!("prefs load failed: {e}"));
        }
    };
    let effective = prefs::resolve_effective(&global, input.connection.overrides.as_ref());

    // 2. Resolve secrets. For an existing connection, start from the keychain
    //    (so "Edit → Test" works without re-typing the stored password), then
    //    overlay any dialog-supplied secret so a *changed* password is tested.
    //    A new connection (empty id) has no keychain entry — use only what the
    //    dialog provided. This mirrors `connections_v2_connect`'s resolution.
    let mut bag = if input.connection.id.is_empty() {
        SecretBag::default()
    } else {
        match secret_store(&state) {
            Ok(store) => match resolve_secrets_for_connect(
                store.as_ref(),
                &input.connection.id,
                None,
                log.as_ref(),
            ) {
                Ok(bag) => bag,
                // Store-wide secret failure (keychain reset / transient).
                // Surface as an Auth-stage failure so the dialog footer shows
                // the clear re-enter / retry message.
                Err(e) => {
                    log.warn(
                        "connections_v2_test: secret resolution failed",
                        logctx! { "err" => e.to_string() },
                    );
                    return Ok(TestResultV2::failure(BuildStage::Auth, e.to_string()));
                }
            },
            Err(e) => {
                log.warn(
                    "connections_v2_test: secret store unavailable; using dialog secrets only",
                    logctx! { "err" => e.clone() },
                );
                SecretBag::default()
            }
        }
    };
    overlay_input_secrets(&mut bag, &input.secrets);
    let resolved = bag.apply(&input.connection);

    // 3. Build ClientOptions + tunnel handle. Three success-shaped outcomes:
    //    Ready (proceed), PassphraseRequired (no retry loop here — fold
    //    into Fail), HostKeyUnknown (likewise). Genuine BuildError maps
    //    straight to Fail.
    //
    //    Test command is one-shot, not the interactive connect flow, so a
    //    user-input prompt can't be answered. We surface both as SSH-stage
    //    failures with a hint. accept_host_key is hard-coded false because
    //    test doesn't have a retry round-trip — if the dialog wants live
    //    confirmation, that's the connect flow's job.
    // `uri` is unused by the test path — we never write to mongo_uris
    // here (test is one-shot, never registers a live client).
    let (opts, tunnel) =
        match build_client_options(&resolved, &effective, false, log.clone()).await {
            Ok(BuildOutcome::Ready { options, tunnel, uri: _ }) => (options, tunnel),
            Ok(BuildOutcome::PassphraseRequired) => {
                log.info(
                    "connections_v2_test: passphrase required",
                    logctx! { "connId" => input.connection.id.clone() },
                );
                return Ok(TestResultV2::failure(
                    BuildStage::Ssh,
                    "SSH key is encrypted — provide the passphrase and retry.",
                ));
            }
            Ok(BuildOutcome::HostKeyUnknown {
                host,
                port,
                algorithm,
                fingerprint,
            }) => {
                log.info(
                    "connections_v2_test: host key unknown",
                    logctx! { "host" => host.clone(), "alg" => algorithm.clone() },
                );
                return Ok(TestResultV2::failure(
                    BuildStage::Ssh,
                    format!(
                        "SSH host key for {host}:{port} is not in any known_hosts store \
                         ({algorithm} fingerprint: {fingerprint}). Connect from the \
                         dialog and confirm the fingerprint to add it."
                    ),
                ));
            }
            Err(BuildError { stage, error }) => {
                log.info(
                    "connections_v2_test: build failed",
                    logctx! { "stage" => format!("{stage:?}"), "err" => error.clone() },
                );
                return Ok(TestResultV2::failure(stage, error));
            }
        };

    // 4. Construct the client. ClientOptions::parse already validated the
    //    URI; the only failure mode here is the driver rejecting our
    //    assembled options — closest BuildStage is Tls (transport setup).
    let client = match Client::with_options(opts) {
        Ok(c) => c,
        Err(e) => {
            log.warn(
                "connections_v2_test: client init failed",
                logctx! { "err" => e.to_string() },
            );
            // Tunnel was opened (Build OK) but we never bound a client to
            // it — close it before returning.
            if let Some(tunnel) = tunnel {
                tunnel.close().await;
            }
            return Ok(TestResultV2::failure(
                BuildStage::Tls,
                format!("client init failed: {e}"),
            ));
        }
    };

    // 5. `hello` round-trip — also serves as the ping for liveness. Use
    //    `hello` over `ping` because the response carries `serverInfo`
    //    fields the dialog wants to display (host, version, isWritable).
    let hello = client
        .database("admin")
        .run_command(doc! { "hello": 1 })
        .await;

    // Tear-down runs on every exit path: shut down the MongoDB client,
    // then close the tunnel (in that order — pool first so no in-flight
    // queries hit a dead tunnel, matching the on-window-close policy in
    // main.rs).
    let result = match hello {
        Ok(server_doc) => {
            // bson::Document → serde_json::Value via bson's Serialize impl.
            // Extended-JSON shapes (numeric subtypes, dates) are preserved
            // but the dialog only displays a few top-level scalar fields,
            // so any extra structure is harmless.
            let server_info = serde_json::to_value(&server_doc).unwrap_or_else(|e| {
                log.warn(
                    "connections_v2_test: hello bson→json failed",
                    logctx! { "err" => e.to_string() },
                );
                serde_json::Value::Null
            });
            log.info("connections_v2_test ok", logctx! {});
            TestResultV2::success(server_info)
        }
        Err(e) => {
            let err_str = e.to_string();
            log.warn(
                "connections_v2_test: hello failed",
                logctx! { "err" => err_str.clone() },
            );
            TestResultV2::failure(BuildStage::Ping, err_str)
        }
    };

    client.shutdown().await;
    if let Some(tunnel) = tunnel {
        tunnel.close().await;
    }
    Ok(result)
}

// ──────────────────────────────────────────────────────────────────────────
// connect / disconnect
//
// Mirrors the legacy `commands::connection::{connect_connection,
// disconnect_connection}` contract: same three-variant outcome
// (Connected / PassphraseRequired / HostKeyUnknown) so the existing
// PassphraseDialog + HostKeyDialog UX in the frontend continues to work
// against the v2 IPC unchanged.
//
// Wire shape is a serde `tag = "type"` tagged union. The TS twin lives in
// `src/connection/ipc.ts::ConnectResultV2`.
// ──────────────────────────────────────────────────────────────────────────

/// Outcome of `connections_v2_connect`. Each variant maps directly to a
/// frontend action:
///   * `Connected` — connection is live; the dialog closes.
///   * `PassphraseRequired` — open the passphrase dialog; retry connect
///     with the user-supplied `passphrase` set.
///   * `HostKeyUnknown` — open the host-key dialog showing
///     `fingerprint` + `algorithm`; retry with `accept_host_key = true`
///     after user confirmation.
///
/// Wire-format keys are camelCase (`connectionId`, `hostKeyUnknown`, …) so
/// the TS twin can pattern-match without translation.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectResultV2 {
    /// MongoDB client established; connection is live.
    Connected,
    /// SSH key is encrypted. Retry `connections_v2_connect` with `passphrase` set.
    //
    // `rename_all` on the enum renames variants ("PassphraseRequired" →
    // "passphraseRequired") but does NOT cascade to the struct variant's
    // fields — that's a separate context in serde. The per-variant
    // `rename_all` below is what turns `connection_id` into `connectionId`
    // on the wire. (The legacy `ConnectResult` in `commands::connection`
    // omits this; it ships snake_case to the frontend, but the v2 IPC
    // contract is camelCase end-to-end so the dialog can use the field
    // names directly without translation.)
    #[serde(rename_all = "camelCase")]
    PassphraseRequired { connection_id: String },
    /// SSH host key unknown. Show fingerprint to user; retry with `acceptHostKey: true`.
    #[serde(rename_all = "camelCase")]
    HostKeyUnknown {
        connection_id: String,
        fingerprint: String,
        algorithm: String,
        host: String,
        port: u16,
    },
}

/// Payload for the `ssh_session_lost` Tauri event emitted when an SSH
/// tunnel drops out from under a live connection. The frontend uses this
/// to flip the connection's tree-row state to disconnected.
///
/// Previously suffixed `V2` to coexist with the legacy emitter during
/// PR 4's dual-table phase; the legacy emitter is gone in PR 5 so this
/// is the only owner of the `ssh_session_lost` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionLostPayloadV2 {
    pub connection_id: String,
}

/// Watch a tunnel's liveness channel; on session-loss, drain state for the
/// connection (client + tunnel) and emit `ssh_session_lost` so the UI
/// can flip to disconnected.
///
/// Symmetric with the legacy `handle_session_loss` in `commands::connection`,
/// but operates on v2 state slots only and emits a v2-specific event so
/// the dual-table phase doesn't mix legacy + v2 frontend subscribers.
///
/// Idempotent with respect to explicit `connections_v2_disconnect` — both
/// paths re-check presence before draining.
async fn handle_session_loss_v2(
    mut alive_rx: tokio::sync::watch::Receiver<bool>,
    connection_id: String,
    app_handle: AppHandle,
    log: Arc<dyn Logger>,
) {
    loop {
        match alive_rx.changed().await {
            Err(_) => break, // sender dropped — explicit close, nothing to do
            Ok(()) => {
                if !*alive_rx.borrow() {
                    break;
                }
                // spurious true→true: keep waiting
            }
        }
    }

    // Sender dropped cleanly (explicit close) — not a crash.
    if *alive_rx.borrow() {
        return;
    }

    log.warn(
        "ssh session lost (v2)",
        logctx! { "connId" => connection_id.clone() },
    );

    let state: State<'_, AppState> = app_handle.state();
    let client: Option<Client> = state.mongo_clients.lock().unwrap().remove(&connection_id);
    state.mongo_uris.lock().unwrap().remove(&connection_id);
    state.mongo_runner_creds.lock().unwrap().remove(&connection_id);
    let tunnel: Option<TunnelHandle> = state.ssh_tunnels.lock().unwrap().remove(&connection_id);

    if let Some(c) = client {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), c.shutdown()).await;
    }
    if let Some(t) = tunnel {
        t.close().await;
    }

    let _ = app_handle.emit(
        "ssh_session_lost",
        SshSessionLostPayloadV2 { connection_id },
    );
}

/// Resolve all builder-input secrets for a connection from the secret
/// store. For `SshKeyPassphrase`, an explicit `passphrase_override` (from
/// the dialog's retry flow) takes precedence over any keychain entry —
/// otherwise we'd loop forever on a wrong cached passphrase.
///
/// Per-slot read errors (`Crypto`/`Io`/`InvalidId` — a single corrupt or
/// unreadable blob) are logged at warn and treated as "not present" so one
/// bad slot can't block the whole connect; the builder turns a genuinely
/// missing required secret into a clear `BuildError` downstream.
///
/// Store-WIDE errors are different and must NOT be swallowed:
/// [`SecretError::SecretsUnrecoverable`] (keychain reset over existing blobs)
/// and [`SecretError::SecretUnavailable`] (transient keychain failure) affect
/// every slot, so they propagate as `Err` for the IPC layer to surface as a
/// clear "re-enter your password" / "try again" state instead of a confusing
/// downstream auth failure.
fn resolve_secrets_for_connect(
    store: &dyn SecretStore,
    connection_id: &str,
    passphrase_override: Option<String>,
    log: &dyn Logger,
) -> std::result::Result<SecretBag, SecretError> {
    let read = |slot: SecretSlot| -> std::result::Result<Option<String>, SecretError> {
        match store.get(connection_id, slot) {
            Ok(value) => Ok(value),
            Err(e @ SecretError::SecretsUnrecoverable) => Err(e),
            Err(e @ SecretError::SecretUnavailable(_)) => Err(e),
            Err(other) => {
                log.warn(
                    "connections_v2_connect: secret read failed",
                    logctx! { "slot" => slot.as_wire(), "err" => other.to_string() },
                );
                Ok(None)
            }
        }
    };
    Ok(SecretBag {
        auth_password: read(SecretSlot::AuthPassword)?,
        ssh_password: read(SecretSlot::SshPassword)?,
        // Dialog-supplied passphrase wins over keychain (retry path).
        ssh_key_passphrase: match passphrase_override {
            Some(p) => Some(p),
            None => read(SecretSlot::SshKeyPassphrase)?,
        },
        proxy_password: read(SecretSlot::ProxyPassword)?,
        aws_secret_key: read(SecretSlot::AwsSecretKey)?,
    })
}

/// Owned secret values resolved from the [`SecretStore`] for a connect
/// attempt. Splitting `read` from `apply` keeps `connect` short and makes
/// the precedence rule (dialog override > keychain) visible at one site.
#[derive(Default)]
struct SecretBag {
    auth_password: Option<String>,
    ssh_password: Option<String>,
    ssh_key_passphrase: Option<String>,
    proxy_password: Option<String>,
    aws_secret_key: Option<String>,
}

/// Overlay dialog-supplied secrets onto a bag (e.g. one already populated from
/// the keychain). A provided slot wins over the stored value — this lets the
/// user test a *changed* password while leaving untouched fields resolved from
/// the keychain. Unknown/OIDC slots are no-ops, matching [`build_resolved`].
fn overlay_input_secrets(bag: &mut SecretBag, secrets: &[SecretInput]) {
    for entry in secrets {
        match SecretSlot::from_wire(&entry.slot) {
            Some(SecretSlot::AuthPassword) => bag.auth_password = Some(entry.value.clone()),
            Some(SecretSlot::SshPassword) => bag.ssh_password = Some(entry.value.clone()),
            Some(SecretSlot::SshKeyPassphrase) => {
                bag.ssh_key_passphrase = Some(entry.value.clone())
            }
            Some(SecretSlot::ProxyPassword) => bag.proxy_password = Some(entry.value.clone()),
            Some(SecretSlot::AwsSecretKey) => bag.aws_secret_key = Some(entry.value.clone()),
            Some(SecretSlot::OidcRefreshToken) => {}
            None => {}
        }
    }
}

impl SecretBag {
    fn apply<'a>(self, conn: &'a Connection) -> ResolvedConnection<'a> {
        ResolvedConnection {
            conn,
            auth_password: self.auth_password,
            ssh_password: self.ssh_password,
            ssh_key_passphrase: self.ssh_key_passphrase,
            proxy_password: self.proxy_password,
            aws_secret_key: self.aws_secret_key,
        }
    }
}

/// Connect to a MongoDB instance configured by the v2 model, optionally
/// through an SSH tunnel.
///
/// Three-shaped outcome (matches the legacy `connect_connection`):
///   * `Connected` — client live, registered in `AppState`.
///   * `PassphraseRequired{connection_id}` — encrypted SSH key, no
///     passphrase available. Frontend prompts; retry with `passphrase`.
///   * `HostKeyUnknown{...}` — SSH host key not trusted. Frontend shows
///     fingerprint; retry with `accept_host_key = true`.
///
/// Parameters:
/// - `id`: v2 connection id
/// - `passphrase`: SSH key passphrase supplied on the dialog's retry —
///   takes precedence over any keychain entry and is persisted to the
///   `SshKeyPassphrase` slot on success.
/// - `accept_host_key`: `true` on the retry after the user confirmed the
///   fingerprint in the UI. Threaded through `build_client_options` to
///   the host-key verifier.
#[tauri::command]
pub async fn connections_v2_connect(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    id: String,
    passphrase: Option<String>,
    accept_host_key: Option<bool>,
) -> Result<ConnectResultV2, String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection_v2",
        "connId" => id.clone(),
    });
    log.info("connections_v2_connect", logctx! {});

    // 1. Resolve secret store (requires CONN_V2).
    let secrets_store = secret_store(&state)?;

    // 2. Load the connection row from the v2 store.
    let db = state.open_db().map_err(|e| {
        log.error("open_db failed", logctx! { "err" => e.to_string() });
        e.to_string()
    })?;
    let connection = store::get(&db, &id)
        .map_err(|e| {
            log.error("store::get failed", logctx! { "err" => e.to_string() });
            e.to_string()
        })?
        .ok_or_else(|| {
            log.error("connection not found", logctx! {});
            "connection not found".to_string()
        })?;
    drop(db);

    // 3. Resolve secrets + effective prefs. A store-wide secret failure
    //    (keychain reset or transient unavailability) surfaces as a clear
    //    IPC error string — the frontend's ConnectionErrorDialog shows it
    //    verbatim (no stage prefix → plain message), telling the user to
    //    re-enter the password or retry. Connection metadata survives in
    //    SQLite, so only the secret needs re-entry.
    let bag = resolve_secrets_for_connect(
        secrets_store.as_ref(),
        &id,
        passphrase.clone(),
        log.as_ref(),
    )
    .map_err(|e| {
        log.warn(
            "connections_v2_connect: secret resolution failed",
            logctx! { "err" => e.to_string() },
        );
        e.to_string()
    })?;
    let resolved = bag.apply(&connection);

    let global = prefs::load(&app_handle).map_err(|e| {
        log.warn("prefs load failed", logctx! { "err" => e.to_string() });
        format!("prefs load failed: {e}")
    })?;
    let effective = prefs::resolve_effective(&global, connection.overrides.as_ref());

    let log_arc: Arc<dyn Logger> = log.clone();
    let accept_flag = accept_host_key.unwrap_or(false);

    // 4. Build ClientOptions. Three success-shaped outcomes plus
    //    BuildError. PassphraseRequired / HostKeyUnknown short-circuit
    //    back to the frontend retry loop.
    let (opts, tunnel, resolved_uri) =
        match build_client_options(&resolved, &effective, accept_flag, log_arc.clone()).await {
            Ok(BuildOutcome::Ready { options, tunnel, uri }) => (options, tunnel, uri),
            Ok(BuildOutcome::PassphraseRequired) => {
                log.info("connections_v2_connect: passphrase required", logctx! {});
                return Ok(ConnectResultV2::PassphraseRequired {
                    connection_id: id,
                });
            }
            Ok(BuildOutcome::HostKeyUnknown {
                host,
                port,
                algorithm,
                fingerprint,
            }) => {
                log.info(
                    "connections_v2_connect: host key unknown",
                    logctx! { "host" => host.clone(), "alg" => algorithm.clone() },
                );
                return Ok(ConnectResultV2::HostKeyUnknown {
                    connection_id: id,
                    fingerprint,
                    algorithm,
                    host,
                    port,
                });
            }
            Err(BuildError { stage, error }) => {
                log.warn(
                    "connections_v2_connect: build failed",
                    logctx! { "stage" => format!("{stage:?}"), "err" => error.clone() },
                );
                // Wire contract: connect returns String error on the IPC
                // boundary (matches legacy). The typed staged-error
                // envelope is the test command's job. Emit the lowercase
                // wire stage (not `{stage:?}` Debug, which is capitalized) so
                // the frontend's `ssh|tls|auth|ping` parser sees a uniform
                // `"<stage>: <detail>"` shape across every connect failure.
                return Err(format!("{}: {error}", stage.as_wire()));
            }
        };

    // 5. Instantiate the driver client.
    let client = match Client::with_options(opts) {
        Ok(c) => c,
        Err(e) => {
            log.warn(
                "connections_v2_connect: client init failed",
                logctx! { "err" => e.to_string() },
            );
            // Build succeeded but client init didn't — close the tunnel
            // we just opened so we don't leak it.
            if let Some(t) = tunnel {
                t.close().await;
            }
            // Closest stage is Tls (transport setup) — same classification
            // `connections_v2_test` uses for a client-init failure — so the
            // error keeps the uniform lowercase `"<stage>: <detail>"` shape.
            return Err(format!("{}: client init failed: {e}", BuildStage::Tls.as_wire()));
        }
    };

    // 5b. Verify liveness with a `hello` round-trip BEFORE persisting any
    //     secret or inserting into state. The MongoDB Rust driver connects
    //     LAZILY — `Client::with_options` never contacts the server — so an
    //     unreachable host, dead server, or bad credentials would otherwise
    //     report "Connected" until the first real query. Mirrors the
    //     liveness check in `connections_v2_test`. This await runs before any
    //     `state.*.lock()` is taken, so no mutex guard is held across it.
    if let Err(e) = client
        .database("admin")
        .run_command(doc! { "hello": 1 })
        .await
    {
        let err_str = e.to_string();
        log.warn(
            "connections_v2_connect: hello failed",
            logctx! { "err" => err_str.clone() },
        );
        // Real connection failure. Tear down WITHOUT mutating state — this
        // client was never inserted. Pool first, then tunnel (matches the
        // disconnect / on-window-close ordering so no in-flight query hits a
        // dead tunnel).
        client.shutdown().await;
        if let Some(t) = tunnel {
            t.close().await;
        }
        return Err(format!("{}: {err_str}", BuildStage::Ping.as_wire()));
    }

    // 6. Persist the passphrase the user just typed (if any) so the next
    //    connect doesn't re-prompt. Best-effort: a write failure here is
    //    not fatal to the connect itself; the user will see the prompt
    //    again on the next attempt.
    if let Some(pw) = &passphrase {
        if !pw.is_empty() {
            if let Err(e) = secrets_store.set(&id, SecretSlot::SshKeyPassphrase, pw) {
                log.warn(
                    "connections_v2_connect: persisting ssh key passphrase failed",
                    logctx! { "err" => e.to_string() },
                );
            }
        }
    }

    // 7. Drain any prior client + tunnel for this id (pool-before-tunnel),
    //    then insert the new pair. Holding the Mutex across `.shutdown()`
    //    / `.close()` would block the executor — release before awaiting.
    let prior_client = state.mongo_clients.lock().unwrap().remove(&id);
    let prior_tunnel = state.ssh_tunnels.lock().unwrap().remove(&id);
    if let Some(c) = prior_client {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), c.shutdown()).await;
    }
    if let Some(t) = prior_tunnel {
        t.close().await;
    }

    state.mongo_clients.lock().unwrap().insert(id.clone(), client);
    // mongo_uris stores the *real* MongoDB URI the builder used (post-SSH
    // rewrite where applicable). Downstream consumers — `mongo::active_uri`
    // and via that the Node script runner — re-use this string to launch
    // a Node-side connection without re-deriving from scratch (which would
    // re-run SDAM and possibly hit the same fallback that the Rust builder
    // already worked around).
    state
        .mongo_uris
        .lock()
        .unwrap()
        .insert(id.clone(), resolved_uri);

    // Store the runner credential alongside the URI so the Node child process
    // can authenticate. Only present for password-based modes; None is a no-op.
    if let Some(cred) = crate::connection::builder::runner_credential(&resolved) {
        state
            .mongo_runner_creds
            .lock()
            .unwrap()
            .insert(id.clone(), cred);
    }

    if let Some(t) = tunnel {
        // Spawn the session-loss monitor BEFORE inserting the handle
        // into state so a race-condition close can't disarm the watch.
        // The monitor holds its own watch::Receiver clone (N-8).
        let alive_rx = t.alive_watch();
        let monitor_log = log.clone();
        let monitor_id = id.clone();
        let monitor_handle = app_handle.clone();
        tokio::spawn(async move {
            handle_session_loss_v2(alive_rx, monitor_id, monitor_handle, monitor_log).await;
        });

        state.ssh_tunnels.lock().unwrap().insert(id.clone(), t);
    }

    log.info("connections_v2_connect ok", logctx! {});
    Ok(ConnectResultV2::Connected)
}

/// Disconnect a live v2 connection. Mirrors the legacy
/// `disconnect_connection`: shutdown the MongoDB pool with a 3-second
/// timeout, THEN close the SSH tunnel. Pool-first-then-tunnel is critical
/// so in-flight queries don't hit a dead tunnel.
///
/// Idempotent: a no-op if the id is not in state. Returns `Ok(())` in that
/// case so the UI's "disconnect" button can be safely double-clicked.
#[tauri::command]
pub async fn connections_v2_disconnect(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let log = state.logger.child(logctx! {
        "logger" => "commands.connection_v2",
        "connId" => id.clone(),
    });
    log.info("connections_v2_disconnect", logctx! {});

    // Drain the client + uri + runner-cred entries first (I-2: pool before tunnel).
    // Drop the Mutex before awaiting shutdown — never hold across await.
    let client = state.mongo_clients.lock().unwrap().remove(&id);
    state.mongo_uris.lock().unwrap().remove(&id);
    state.mongo_runner_creds.lock().unwrap().remove(&id);

    if let Some(c) = client {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), c.shutdown()).await;
    }

    // Now close the tunnel — pool is fully drained, no in-flight queries.
    let tunnel = state.ssh_tunnels.lock().unwrap().remove(&id);
    if let Some(t) = tunnel {
        t.close().await;
        log.info("ssh tunnel closed (v2)", logctx! {});
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
//
// Most of this module's surface is IPC glue around well-tested layers
// (`store`, `secrets`, `builder`, `prefs`) — covered by their own
// modules' tests plus the JSON contract tests. We unit-test only the
// pieces that live exclusively here:
//   * `TestResultV2` wire format (the discriminated union the frontend
//     pattern-matches on).
//   * `build_resolved` projection from `SecretInput[]` onto
//     `ResolvedConnection` slots.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{AuthMode, ConnectionTarget};

    fn dummy_connection() -> Connection {
        Connection {
            id: "test-id".to_string(),
            name: "test".to_string(),
            color: None,
            target: ConnectionTarget::Uri {
                uri: "mongodb://localhost:27017".to_string(),
            },
            auth: AuthMode::None,
            tls: None,
            ssh: None,
            proxy: None,
            overrides: None,
            created_at: "2026-05-28T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_result_ok_serializes_with_boolean_ok_and_server_info() {
        let result = TestResultV2::success(serde_json::json!({ "version": "7.0.0" }));
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["ok"], serde_json::Value::Bool(true));
        assert_eq!(value["serverInfo"]["version"], "7.0.0");
        // The Fail-side keys must NOT leak into the Ok variant.
        assert!(value.get("stage").is_none());
        assert!(value.get("error").is_none());
    }

    #[test]
    fn test_result_fail_serializes_with_boolean_ok_and_lowercase_stage() {
        let result = TestResultV2::failure(BuildStage::Ssh, "host unreachable");
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["ok"], serde_json::Value::Bool(false));
        // BuildStage uses lowercase serde (`ssh|tls|auth|ping`).
        assert_eq!(value["stage"], "ssh");
        assert_eq!(value["error"], "host unreachable");
        assert!(value.get("serverInfo").is_none());
    }

    #[test]
    fn test_result_fail_serializes_each_build_stage_as_lowercase() {
        for (stage, wire) in [
            (BuildStage::Ssh, "ssh"),
            (BuildStage::Tls, "tls"),
            (BuildStage::Auth, "auth"),
            (BuildStage::Ping, "ping"),
        ] {
            let value = serde_json::to_value(TestResultV2::failure(stage, "x")).unwrap();
            assert_eq!(value["stage"], wire, "stage {stage:?} → wire {wire}");
        }
    }

    #[test]
    fn save_input_deserializes_camel_case_secrets() {
        // Wire-format contract: the frontend sends camelCase keys.
        let raw = serde_json::json!({
            "connection": {
                "id": "c1",
                "name": "c1",
                "target": { "kind": "uri", "uri": "mongodb://h" },
                "auth": { "kind": "none" },
                "createdAt": "2026-05-28T00:00:00Z"
            },
            "secrets": [
                { "slot": "auth-password", "value": "hunter2" },
                { "slot": "ssh-password", "value": "ssh-pw" }
            ]
        });
        let input: SaveInput = serde_json::from_value(raw).expect("deserialize");
        assert_eq!(input.secrets.len(), 2);
        assert_eq!(input.secrets[0].slot, "auth-password");
        assert_eq!(input.secrets[0].value, "hunter2");
    }

    #[test]
    fn build_resolved_maps_every_known_slot_to_the_right_field() {
        let conn = dummy_connection();
        let secrets = vec![
            SecretInput {
                slot: "auth-password".to_string(),
                value: "ap".to_string(),
            },
            SecretInput {
                slot: "ssh-password".to_string(),
                value: "sp".to_string(),
            },
            SecretInput {
                slot: "ssh-key-passphrase".to_string(),
                value: "skp".to_string(),
            },
            SecretInput {
                slot: "proxy-password".to_string(),
                value: "pp".to_string(),
            },
            SecretInput {
                slot: "aws-secret-key".to_string(),
                value: "ask".to_string(),
            },
        ];
        let resolved = build_resolved(&conn, &secrets);
        assert_eq!(resolved.auth_password.as_deref(), Some("ap"));
        assert_eq!(resolved.ssh_password.as_deref(), Some("sp"));
        assert_eq!(resolved.ssh_key_passphrase.as_deref(), Some("skp"));
        assert_eq!(resolved.proxy_password.as_deref(), Some("pp"));
        assert_eq!(resolved.aws_secret_key.as_deref(), Some("ask"));
    }

    #[test]
    fn overlay_input_secrets_overrides_stored_value() {
        // Keychain supplied a stored password; the dialog typed a new one —
        // the typed value must win (testing a changed password).
        let mut bag = SecretBag {
            auth_password: Some("stored".to_string()),
            ..SecretBag::default()
        };
        overlay_input_secrets(
            &mut bag,
            &[SecretInput {
                slot: "auth-password".to_string(),
                value: "typed".to_string(),
            }],
        );
        assert_eq!(bag.auth_password.as_deref(), Some("typed"));
    }

    #[test]
    fn overlay_input_secrets_keeps_stored_when_slot_absent() {
        // The bug scenario: editing an existing connection and clicking Test
        // without re-typing the password must keep the keychain value.
        let mut bag = SecretBag {
            auth_password: Some("stored".to_string()),
            ..SecretBag::default()
        };
        overlay_input_secrets(&mut bag, &[]);
        assert_eq!(bag.auth_password.as_deref(), Some("stored"));
    }

    #[test]
    fn build_resolved_ignores_unknown_slot_strings() {
        let conn = dummy_connection();
        let secrets = vec![
            SecretInput {
                slot: "not-a-real-slot".to_string(),
                value: "x".to_string(),
            },
            SecretInput {
                slot: "auth-password".to_string(),
                value: "ap".to_string(),
            },
        ];
        let resolved = build_resolved(&conn, &secrets);
        // Unknown slot is dropped, known slot still applies.
        assert_eq!(resolved.auth_password.as_deref(), Some("ap"));
        assert!(resolved.ssh_password.is_none());
    }

    #[test]
    fn build_resolved_with_empty_list_yields_bare() {
        let conn = dummy_connection();
        let resolved = build_resolved(&conn, &[]);
        assert!(resolved.auth_password.is_none());
        assert!(resolved.ssh_password.is_none());
        assert!(resolved.ssh_key_passphrase.is_none());
        assert!(resolved.proxy_password.is_none());
        assert!(resolved.aws_secret_key.is_none());
    }

    #[test]
    fn build_resolved_does_not_carry_oidc_refresh_token_to_builder_inputs() {
        // OIDC refresh tokens are persisted but not consumed by the
        // builder. Confirm `build_resolved` simply drops them on the
        // floor (no panic, no field) so adding the variant to
        // `SecretSlot` doesn't quietly break this projection.
        let conn = dummy_connection();
        let secrets = vec![SecretInput {
            slot: "oidc-refresh-token".to_string(),
            value: "t".to_string(),
        }];
        let resolved = build_resolved(&conn, &secrets);
        assert!(resolved.auth_password.is_none());
    }

    // ── ConnectResultV2 wire-format contract ────────────────────────────
    //
    // The frontend pattern-matches on `result.type` (TS twin in
    // src/connection/ipc.ts). These tests pin the JSON keys + casing so a
    // future rename here can't silently break the dialog.

    #[test]
    fn connect_result_connected_serializes_as_type_connected_only() {
        let value = serde_json::to_value(ConnectResultV2::Connected).unwrap();
        assert_eq!(value["type"], "connected");
        // No leakage of the Passphrase/HostKey fields onto the Connected variant.
        assert!(value.get("connectionId").is_none());
        assert!(value.get("fingerprint").is_none());
    }

    #[test]
    fn connect_result_passphrase_required_uses_camel_case_connection_id() {
        let value = serde_json::to_value(ConnectResultV2::PassphraseRequired {
            connection_id: "c-1".into(),
        })
        .unwrap();
        assert_eq!(value["type"], "passphraseRequired");
        assert_eq!(value["connectionId"], "c-1");
        // snake_case must NOT leak through.
        assert!(value.get("connection_id").is_none());
    }

    #[test]
    fn connect_result_host_key_unknown_carries_structured_fields() {
        let value = serde_json::to_value(ConnectResultV2::HostKeyUnknown {
            connection_id: "c-1".into(),
            fingerprint: "SHA256:abc".into(),
            algorithm: "ssh-ed25519".into(),
            host: "bastion.example.com".into(),
            port: 22,
        })
        .unwrap();
        assert_eq!(value["type"], "hostKeyUnknown");
        assert_eq!(value["connectionId"], "c-1");
        assert_eq!(value["fingerprint"], "SHA256:abc");
        assert_eq!(value["algorithm"], "ssh-ed25519");
        assert_eq!(value["host"], "bastion.example.com");
        assert_eq!(value["port"], 22);
    }

    #[test]
    fn ssh_session_lost_payload_v2_uses_camel_case() {
        let value = serde_json::to_value(SshSessionLostPayloadV2 {
            connection_id: "c-1".into(),
        })
        .unwrap();
        assert_eq!(value["connectionId"], "c-1");
        assert!(value.get("connection_id").is_none());
    }
}
