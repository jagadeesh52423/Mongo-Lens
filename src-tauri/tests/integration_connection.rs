//! End-to-end integration tests for `connection::builder::build_client_options`.
//!
//! These tests drive the builder against live Docker-launched backends:
//! they actually open sockets, complete handshakes, and run `{ping: 1}`
//! against `admin`. The 25 unit tests in `src/connection/builder.rs`
//! verify ClientOptions field assembly *without* connecting — these are
//! complementary, not duplicates.
//!
//! ## Running
//!
//!     cd src-tauri
//!     INTEGRATION=1 cargo test --test integration_connection -- \
//!         --test-threads=1 --nocapture
//!
//! Without `INTEGRATION=1` every test no-ops in O(μs). With it, each test
//! pulls an image (cached after first run), starts a container, runs the
//! ping, then tears down via the `ContainerGuard` Drop impl. The final
//! `zzz_final_cleanup_sweep` reaps anything that survived (e.g. on a
//! crash where Drop never fired).
//!
//! ## Scope
//!
//! Tests #1–#8 in TEST_REPORT.md. Out of scope (covered by unit tests in
//! builder.rs and explicitly documented in the report):
//!   * Kerberos / AWS IAM / OIDC / LDAP — need Enterprise mongod images
//!     AND mongodb crate features we don't compile in.
//!   * X.509 — community-supported but cert provisioning is fiddly and
//!     adds little signal beyond unit coverage.
//!   * SSH agent auth — needs an ssh-agent + ssh-add dance that doesn't
//!     fit a single-process test script.

mod common;

use std::time::Duration;

use common::*;
use mongo_lens::connection::builder::ResolvedConnection;
use mongo_lens::connection::model::ScramMechanism;

const MONGO_IMAGE: &str = "mongo:7";
const SSH_IMAGE: &str = "linuxserver/openssh-server:latest";
const SOCKS5_IMAGE: &str = "serjs/go-socks5-proxy:latest";

// One probe used by every test — abort if docker isn't reachable so the
// rest of the suite doesn't waste time waiting on timeouts.
fn require_docker() -> bool {
    match run_with_timeout("docker", &["version"], Duration::from_secs(5)) {
        Ok(_) => true,
        Err(e) => {
            eprintln!("docker not available, skipping: {e}");
            false
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// 1. No-auth ping
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_01_no_auth_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let name = unique_name("conn-v2-noauth");
    let _guard = ContainerGuard::new(name.clone());

    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    wait_for_mongo_ready_in_container(&name, &[], Duration::from_secs(30))
        .expect("mongod ready");

    let conn = direct_conn("127.0.0.1", host_port, mongo_lens::connection::model::AuthMode::None, None);
    let resolved = ResolvedConnection::bare(&conn);
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_01_no_auth_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 2. SCRAM-SHA-256 explicit
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_02_scram_sha256_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let name = unique_name("conn-v2-scram256");
    let _guard = ContainerGuard::new(name.clone());

    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        "-e", "MONGO_INITDB_ROOT_USERNAME=root",
        "-e", "MONGO_INITDB_ROOT_PASSWORD=rootpw",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    // mongod with --auth waits longer for init; authenticate via root creds
    // so we know it's truly ready (init scripts have run).
    wait_for_mongo_ready_in_container(
        &name,
        &["-u", "root", "-p", "rootpw", "--authenticationDatabase", "admin"],
        Duration::from_secs(45),
    )
    .expect("mongod ready");

    let conn = direct_conn(
        "127.0.0.1",
        host_port,
        scram_auth("root", Some(ScramMechanism::ScramSha256)),
        None,
    );
    let mut resolved = ResolvedConnection::bare(&conn);
    resolved.auth_password = Some("rootpw".into());
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_02_scram_sha256_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 3. SCRAM auto-negotiate
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_03_scram_auto_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let name = unique_name("conn-v2-scramauto");
    let _guard = ContainerGuard::new(name.clone());

    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        "-e", "MONGO_INITDB_ROOT_USERNAME=root",
        "-e", "MONGO_INITDB_ROOT_PASSWORD=rootpw",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    wait_for_mongo_ready_in_container(
        &name,
        &["-u", "root", "-p", "rootpw", "--authenticationDatabase", "admin"],
        Duration::from_secs(45),
    )
    .expect("mongod ready");

    // Mechanism = Auto → driver negotiates; mongo:7 advertises SCRAM-SHA-256
    // first, so that's what should be picked. We only assert ping succeeds.
    let conn = direct_conn(
        "127.0.0.1",
        host_port,
        scram_auth("root", Some(ScramMechanism::Auto)),
        None,
    );
    let mut resolved = ResolvedConnection::bare(&conn);
    resolved.auth_password = Some("rootpw".into());
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_03_scram_auto_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 4. TLS handshake (CA-trust verification)
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_04_tls_ca_trust_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let tls = generate_tls_assets().expect("generate certs");
    let name = unique_name("conn-v2-tls");
    let _guard = ContainerGuard::new(name.clone());

    let mount = format!("{}:/certs:ro", tls.ca_pem.parent().unwrap().display());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        "-v", &mount,
        MONGO_IMAGE,
        "--tlsMode", "requireTLS",
        "--tlsCertificateKeyFile", "/certs/server.pem",
        "--tlsCAFile", "/certs/ca.pem",
        "--tlsAllowConnectionsWithoutCertificates",
    ])
    .expect("docker run mongo tls");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    // Probe via mongosh with --tls + the CA so we know the server is up
    // before the test driver tries to hand-shake.
    wait_for_mongo_ready_in_container(
        &name,
        &["--tls", "--tlsCAFile", "/certs/ca.pem"],
        Duration::from_secs(45),
    )
    .expect("mongod tls ready");

    let conn = direct_conn(
        "127.0.0.1",
        host_port,
        mongo_lens::connection::model::AuthMode::None,
        Some(mongo_lens::connection::model::Tls {
            enabled: true,
            allow_invalid_certs: None,
            allow_invalid_hostnames: None,
            ca_file: Some(tls.ca_pem.to_string_lossy().into_owned()),
            client_cert_file: None,
        }),
    );
    let resolved = ResolvedConnection::bare(&conn);
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_04_tls_ca_trust_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 5. TLS + allowInvalidCerts (skips CA validation entirely)
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_05_tls_allow_invalid_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let tls = generate_tls_assets().expect("generate certs");
    let name = unique_name("conn-v2-tls-noverify");
    let _guard = ContainerGuard::new(name.clone());

    // mongo:7 refuses to enable TLS without `--tlsCAFile` (SERVER-72839).
    // We pass the CA on the server side so mongod boots, then on the
    // client we omit `ca_file` and set `allow_invalid_certs=true` so the
    // driver skips CA validation entirely. That's the codepath we care about.
    let mount = format!("{}:/certs:ro", tls.ca_pem.parent().unwrap().display());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        "-v", &mount,
        MONGO_IMAGE,
        "--tlsMode", "requireTLS",
        "--tlsCertificateKeyFile", "/certs/server.pem",
        "--tlsCAFile", "/certs/ca.pem",
        "--tlsAllowConnectionsWithoutCertificates",
    ])
    .expect("docker run mongo tls");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    wait_for_mongo_ready_in_container(
        &name,
        &["--tls", "--tlsCAFile", "/certs/ca.pem"],
        Duration::from_secs(45),
    )
    .expect("mongod tls ready");

    // No ca_file passed; allow_invalid_certs=true → driver skips CA check.
    let conn = direct_conn(
        "127.0.0.1",
        host_port,
        mongo_lens::connection::model::AuthMode::None,
        Some(mongo_lens::connection::model::Tls {
            enabled: true,
            allow_invalid_certs: Some(true),
            allow_invalid_hostnames: None,
            ca_file: None,
            client_cert_file: None,
        }),
    );
    let resolved = ResolvedConnection::bare(&conn);
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_05_tls_allow_invalid_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 6. SSH tunnel — password auth
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_06_ssh_password_tunnel_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let net = NetworkGuard::create("conn-v2-net").expect("create network");

    // mongod on the test-net, no port published — only reachable via SSH.
    let mongo_name = unique_name("conn-v2-mongo");
    let _mongo_guard = ContainerGuard::new(mongo_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &mongo_name,
        "--network", &net.name,
        "--network-alias", "mongo",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");
    wait_for_mongo_ready_in_container(&mongo_name, &[], Duration::from_secs(45))
        .expect("mongod ready");

    // SSH server on the same network, port 2222 published to host.
    let ssh_name = unique_name("conn-v2-ssh");
    let _ssh_guard = ContainerGuard::new(ssh_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &ssh_name,
        "--network", &net.name,
        "-p", "0:2222",
        "-e", "PUID=1000",
        "-e", "PGID=1000",
        "-e", "PASSWORD_ACCESS=true",
        "-e", "USER_NAME=mongo",
        "-e", "USER_PASSWORD=mongo-ssh-pw",
        SSH_IMAGE,
    ])
    .expect("docker run sshd");

    let ssh_port = assigned_port(&ssh_name, 2222).expect("ssh port");
    wait_for_tcp("127.0.0.1", ssh_port, Duration::from_secs(60))
        .await
        .expect("ssh tcp up");
    // linuxserver/openssh-server defaults to AllowTcpForwarding no — flip it.
    enable_ssh_tcp_forwarding(&ssh_name).expect("enable tcp forwarding");
    // sshd accepts TCP very early but rejects auth until it's fully booted —
    // small grace period after the HUP for it to re-read the config.
    tokio::time::sleep(Duration::from_secs(2)).await;

    // mongod target hostname is "mongo" — the SSH bridge resolves it inside
    // the sshd container's DNS via the docker network.
    let mut conn = direct_conn(
        "mongo",
        27017,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    add_ssh_password(&mut conn, "127.0.0.1", ssh_port, "mongo");
    let mut resolved = ResolvedConnection::bare(&conn);
    resolved.ssh_password = Some("mongo-ssh-pw".into());

    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_06_ssh_password_tunnel_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 7. SSH tunnel — key auth, no passphrase
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_07_ssh_key_tunnel_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let net = NetworkGuard::create("conn-v2-net-key").expect("create network");
    let keypair = generate_ssh_keypair().expect("ssh-keygen");

    let mongo_name = unique_name("conn-v2-mongo-key");
    let _mongo_guard = ContainerGuard::new(mongo_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &mongo_name,
        "--network", &net.name,
        "--network-alias", "mongo",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");
    wait_for_mongo_ready_in_container(&mongo_name, &[], Duration::from_secs(45))
        .expect("mongod ready");

    let ssh_name = unique_name("conn-v2-ssh-key");
    let _ssh_guard = ContainerGuard::new(ssh_name.clone());
    let public_key_env = format!("PUBLIC_KEY={}", keypair.public_str);
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &ssh_name,
        "--network", &net.name,
        "-p", "0:2222",
        "-e", "PUID=1000",
        "-e", "PGID=1000",
        "-e", "USER_NAME=mongo",
        "-e", &public_key_env,
        SSH_IMAGE,
    ])
    .expect("docker run sshd");

    let ssh_port = assigned_port(&ssh_name, 2222).expect("ssh port");
    wait_for_tcp("127.0.0.1", ssh_port, Duration::from_secs(60))
        .await
        .expect("ssh tcp up");
    enable_ssh_tcp_forwarding(&ssh_name).expect("enable tcp forwarding");
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut conn = direct_conn(
        "mongo",
        27017,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    add_ssh_key(&mut conn, "127.0.0.1", ssh_port, "mongo", &keypair.private_path);
    let resolved = ResolvedConnection::bare(&conn);

    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_07_ssh_key_tunnel_ping: ping ok in {latency:?}");
}

// ──────────────────────────────────────────────────────────────────────────
// 8. SOCKS5 proxy
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_08_socks5_proxy_ping() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let net = NetworkGuard::create("conn-v2-socks").expect("create network");

    let mongo_name = unique_name("conn-v2-mongo-sx");
    let _mongo_guard = ContainerGuard::new(mongo_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &mongo_name,
        "--network", &net.name,
        "--network-alias", "mongo",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");
    wait_for_mongo_ready_in_container(&mongo_name, &[], Duration::from_secs(45))
        .expect("mongod ready");

    let proxy_name = unique_name("conn-v2-socks5");
    let _proxy_guard = ContainerGuard::new(proxy_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &proxy_name,
        "--network", &net.name,
        "-p", "0:1080",
        // serjs/go-socks5-proxy defaults REQUIRE_AUTH=true and refuses to
        // start without PROXY_USER/PROXY_PASSWORD — flip it off.
        "-e", "REQUIRE_AUTH=false",
        SOCKS5_IMAGE,
    ])
    .expect("docker run socks5");

    let proxy_port = assigned_port(&proxy_name, 1080).expect("proxy port");
    wait_for_tcp("127.0.0.1", proxy_port, Duration::from_secs(30))
        .await
        .expect("socks5 tcp up");

    // mongo is reachable from the socks5 container as `mongo:27017`;
    // the driver connects via the SOCKS5 proxy at 127.0.0.1:proxy_port.
    let mut conn = direct_conn(
        "mongo",
        27017,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    add_socks5(&mut conn, "127.0.0.1", proxy_port);
    let resolved = ResolvedConnection::bare(&conn);
    let latency = ping_via_builder(&resolved).await.expect("ping");
    println!("test_08_socks5_proxy_ping: ping ok in {latency:?}");
}

// ══════════════════════════════════════════════════════════════════════════
// Task 17 — connections_v2_connect outcome tests
//
// These exercise the *outcome* surface of `build_client_options` —
// `BuildOutcome::Ready` vs `PassphraseRequired` vs `HostKeyUnknown` —
// which is the contract `connections_v2_connect` translates into
// `ConnectResultV2`. Driving the IPC command directly would need a Tauri
// AppHandle + state; building options directly is sufficient because the
// IPC layer's mapping is purely mechanical (one match arm per variant)
// and unit-tested separately in commands/connection_v2.rs.
//
// Each test asserts:
//   * the FIRST attempt produces the prompt outcome (PassphraseRequired /
//     HostKeyUnknown), with structured fields populated.
//   * the RETRY (passphrase set / accept_host_key=true) produces Ready
//     and a real `ping` round-trips successfully.
// ══════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────────
// 9. connect_v2 happy path — Ready outcome + ping
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_09_connect_v2_success_returns_connected() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let name = unique_name("conn-v2-connect-ok");
    let _guard = ContainerGuard::new(name.clone());

    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &name,
        "-p", "0:27017",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");

    let host_port = assigned_port(&name, 27017).expect("assigned port");
    wait_for_tcp("127.0.0.1", host_port, Duration::from_secs(30))
        .await
        .expect("tcp up");
    wait_for_mongo_ready_in_container(&name, &[], Duration::from_secs(30))
        .expect("mongod ready");

    let conn = direct_conn(
        "127.0.0.1",
        host_port,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    let resolved = ResolvedConnection::bare(&conn);
    let kind = connect_outcome(&resolved, false).await.expect("connect_outcome");
    assert!(
        matches!(kind, OutcomeKind::Ready),
        "expected Ready for no-auth mongo:7 direct connection"
    );
    println!("test_09_connect_v2_success_returns_connected: Ready ok");
}

// ──────────────────────────────────────────────────────────────────────────
// 10. connect_v2 passphrase-required on encrypted key, then succeed on retry
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_10_connect_v2_passphrase_required_when_key_encrypted() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    let passphrase = "trapdoor-passphrase";
    let (keypair, _pp) =
        generate_ssh_keypair_with_passphrase(passphrase).expect("ssh-keygen with passphrase");

    let net = NetworkGuard::create("conn-v2-net-pp").expect("create network");

    // Mongo on the test-net, unreachable from host.
    let mongo_name = unique_name("conn-v2-mongo-pp");
    let _mongo_guard = ContainerGuard::new(mongo_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &mongo_name,
        "--network", &net.name,
        "--network-alias", "mongo",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");
    wait_for_mongo_ready_in_container(&mongo_name, &[], Duration::from_secs(45))
        .expect("mongod ready");

    // SSH server accepts the (encrypted) key's public half.
    let ssh_name = unique_name("conn-v2-ssh-pp");
    let _ssh_guard = ContainerGuard::new(ssh_name.clone());
    let public_key_env = format!("PUBLIC_KEY={}", keypair.public_str);
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &ssh_name,
        "--network", &net.name,
        "-p", "0:2222",
        "-e", "PUID=1000",
        "-e", "PGID=1000",
        "-e", "USER_NAME=mongo",
        "-e", &public_key_env,
        SSH_IMAGE,
    ])
    .expect("docker run sshd");
    let ssh_port = assigned_port(&ssh_name, 2222).expect("ssh port");
    wait_for_tcp("127.0.0.1", ssh_port, Duration::from_secs(60))
        .await
        .expect("ssh tcp up");
    enable_ssh_tcp_forwarding(&ssh_name).expect("enable tcp forwarding");
    tokio::time::sleep(Duration::from_secs(2)).await;

    // The connection record references the encrypted key with
    // has_passphrase=true. Policy is AcceptAny so host-key signaling
    // doesn't shadow the passphrase signal.
    let mut conn = direct_conn(
        "mongo",
        27017,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    add_ssh_key_with_passphrase(
        &mut conn,
        "127.0.0.1",
        ssh_port,
        "mongo",
        &keypair.private_path,
        mongo_lens::connection::model::KnownHostsPolicy::AcceptAny,
    );

    // First attempt: no passphrase resolved → PassphraseRequired.
    let resolved_no_pp = ResolvedConnection::bare(&conn);
    let first = connect_outcome(&resolved_no_pp, false)
        .await
        .expect("connect_outcome (no passphrase)");
    assert!(
        matches!(first, OutcomeKind::PassphraseRequired),
        "expected PassphraseRequired on first attempt"
    );

    // Retry: dialog has populated the passphrase slot → Ready.
    let mut resolved_with_pp = ResolvedConnection::bare(&conn);
    resolved_with_pp.ssh_key_passphrase = Some(passphrase.to_string());
    let second = connect_outcome(&resolved_with_pp, false)
        .await
        .expect("connect_outcome (with passphrase)");
    assert!(
        matches!(second, OutcomeKind::Ready),
        "expected Ready after passphrase supplied"
    );
    println!("test_10_connect_v2_passphrase_required_when_key_encrypted: ok");
}

// ──────────────────────────────────────────────────────────────────────────
// 11. connect_v2 host-key-unknown on Strict policy, then succeed on accept
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_11_connect_v2_host_key_unknown_on_strict_policy() {
    if !is_integration() {
        eprintln!("skip: set INTEGRATION=1");
        return;
    }
    if !require_docker() {
        return;
    }

    // The SSH host-key verifier consults `~/.mongomacapp/known_hosts`.
    // We sandbox HOME so:
    //   1. The "first attempt" starts with an empty store (any persisted
    //      key from a prior run can't shadow the test).
    //   2. The key our retry-with-accept persists doesn't leak into the
    //      developer's real known_hosts file.
    // HomeGuard restores HOME on drop. Must hold for the whole test.
    let _home = HomeGuard::fresh().expect("HomeGuard");

    let keypair = generate_ssh_keypair().expect("ssh-keygen");
    let net = NetworkGuard::create("conn-v2-net-hk").expect("create network");

    let mongo_name = unique_name("conn-v2-mongo-hk");
    let _mongo_guard = ContainerGuard::new(mongo_name.clone());
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &mongo_name,
        "--network", &net.name,
        "--network-alias", "mongo",
        MONGO_IMAGE,
    ])
    .expect("docker run mongo");
    wait_for_mongo_ready_in_container(&mongo_name, &[], Duration::from_secs(45))
        .expect("mongod ready");

    let ssh_name = unique_name("conn-v2-ssh-hk");
    let _ssh_guard = ContainerGuard::new(ssh_name.clone());
    let public_key_env = format!("PUBLIC_KEY={}", keypair.public_str);
    run_docker(&[
        "run", "-d",
        "--label", TEST_LABEL,
        "--name", &ssh_name,
        "--network", &net.name,
        "-p", "0:2222",
        "-e", "PUID=1000",
        "-e", "PGID=1000",
        "-e", "USER_NAME=mongo",
        "-e", &public_key_env,
        SSH_IMAGE,
    ])
    .expect("docker run sshd");
    let ssh_port = assigned_port(&ssh_name, 2222).expect("ssh port");
    wait_for_tcp("127.0.0.1", ssh_port, Duration::from_secs(60))
        .await
        .expect("ssh tcp up");
    enable_ssh_tcp_forwarding(&ssh_name).expect("enable tcp forwarding");
    tokio::time::sleep(Duration::from_secs(2)).await;

    let mut conn = direct_conn(
        "mongo",
        27017,
        mongo_lens::connection::model::AuthMode::None,
        None,
    );
    add_ssh_key(&mut conn, "127.0.0.1", ssh_port, "mongo", &keypair.private_path);
    set_ssh_policy(&mut conn, mongo_lens::connection::model::KnownHostsPolicy::Strict);

    // First attempt: empty known_hosts + Strict → HostKeyUnknown with
    // structured fields populated.
    let resolved = ResolvedConnection::bare(&conn);
    let first = connect_outcome(&resolved, false)
        .await
        .expect("connect_outcome (strict first)");
    let (host, port, algorithm, fingerprint) = match first {
        OutcomeKind::HostKeyUnknown {
            host,
            port,
            algorithm,
            fingerprint,
        } => (host, port, algorithm, fingerprint),
        OutcomeKind::Ready => panic!("expected HostKeyUnknown, got Ready"),
        OutcomeKind::PassphraseRequired => {
            panic!("expected HostKeyUnknown, got PassphraseRequired")
        }
    };
    assert_eq!(host, "127.0.0.1");
    assert_eq!(port, ssh_port);
    assert!(!algorithm.is_empty(), "algorithm should be populated");
    assert!(
        fingerprint.starts_with("SHA256:"),
        "fingerprint should be SHA256: prefixed (got: {fingerprint})"
    );

    // Retry: accept_host_key=true → verifier persists the key → Ready.
    let second = connect_outcome(&resolved, true)
        .await
        .expect("connect_outcome (strict accept)");
    assert!(
        matches!(second, OutcomeKind::Ready),
        "expected Ready after accept_host_key=true"
    );
    println!("test_11_connect_v2_host_key_unknown_on_strict_policy: ok");
}

// ──────────────────────────────────────────────────────────────────────────
// Final cleanup sweep — runs alphabetically last (`zzz_`) under --test-threads=1.
// Catches anything that survived a panicking Drop or a `kill -9`.
// ──────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn zzz_final_cleanup_sweep() {
    if !is_integration() {
        return;
    }
    let list = run_with_timeout(
        "docker",
        &["ps", "-aq", "--filter", &format!("label={}", TEST_LABEL)],
        Duration::from_secs(10),
    )
    .unwrap_or_default();
    let containers: Vec<&str> = list.lines().filter(|l| !l.is_empty()).collect();
    if !containers.is_empty() {
        let mut args = vec!["rm", "-f"];
        args.extend(containers.iter().copied());
        let _ = run_with_timeout("docker", &args, Duration::from_secs(30));
        eprintln!("zzz_final_cleanup_sweep: reaped {} stray container(s)", containers.len());
    }
    let nets = run_with_timeout(
        "docker",
        &["network", "ls", "-q", "--filter", &format!("label={}", TEST_LABEL)],
        Duration::from_secs(10),
    )
    .unwrap_or_default();
    let net_ids: Vec<&str> = nets.lines().filter(|l| !l.is_empty()).collect();
    if !net_ids.is_empty() {
        let mut args = vec!["network", "rm"];
        args.extend(net_ids.iter().copied());
        let _ = run_with_timeout("docker", &args, Duration::from_secs(15));
        eprintln!("zzz_final_cleanup_sweep: reaped {} stray network(s)", net_ids.len());
    }
}
