# Phase 1 Connection Builder — Integration Test Report

> A pre-existing `TEST_REPORT.md` at repo root belongs to a different feature
> (`feat-ui-design-system-pr1-foundations`). This report uses a
> feature-specific filename to avoid clobbering it.

**Run date:** 2026-05-28
**Branch:** `worktree-conn-v2-phase1`
**Test commit:** `c57fc54` (test file) on top of `5a30462` (SOCKS5 feature fix)
**Driver:** mongodb v3 (rustls TLS backend)
**Suite:** `src-tauri/tests/integration_connection.rs` (8 mechanism tests + 1 sweep)
**Command:** `cd src-tauri && INTEGRATION=1 cargo test --test integration_connection -- --test-threads=1 --nocapture`
**Wall-clock:** 27.84 s (with all images pre-pulled)
**Container leaks:** 0 (final sweep ran clean)

---

## Summary

| # | Mechanism                          | Status | Ping latency |
|---|------------------------------------|--------|--------------|
| 1 | No-auth                            | PASS   | 5.96 ms      |
| 2 | SCRAM-SHA-256 (explicit)           | PASS   | 117.22 ms    |
| 3 | SCRAM auto-negotiate               | PASS   | 135.20 ms    |
| 4 | TLS w/ CA-trust verification       | PASS   | 11.23 ms     |
| 5 | TLS + `allow_invalid_certs=true`   | PASS   | 11.94 ms     |
| 6 | SSH tunnel — password auth         | PASS   | 6.71 ms      |
| 7 | SSH tunnel — key auth (no passphrase) | PASS | 7.72 ms     |
| 8 | SOCKS5 proxy                       | PASS   | 7.83 ms      |

**8 of 8 PASS.** The builder's full end-to-end stack — URI synthesis, TLS option assembly, credential dispatch, SSH bridge, SOCKS5 driver wiring — works against real backends.

> **Bug found & fixed during integration verification:** `src/connection/builder.rs:800`'s `#[cfg(feature = "socks5-proxy")]` checks the workspace's own `socks5-proxy` feature, but `Cargo.toml` had only enabled `mongodb/socks5-proxy` directly — there was no workspace feature with that name, so the cfg gate evaluated to false at compile time and the SOCKS5 codepath was dead. Fixed in commit `5a30462` by adding a workspace `[features]` table that re-exports `mongodb/socks5-proxy` with `default = ["socks5-proxy"]`. The unit tests couldn't catch this because they use the same cfg gate to decide which test variant to compile. The other gated mongodb features (`gssapi-auth`, `aws-auth`, `openssl-tls`, `*-compression`) remain intentionally un-wired at the workspace level — we don't pull those, so the cfg-false → "not compiled in" error is the right behaviour.

---

## Per-mechanism detail

### 1. No-auth — PASS

- **Container:** `mongo:7` (`docker.io/library/mongo:7`, digest `sha256:4b5bf3c2…`)
- **Command:** `mongod` defaults, port `0:27017` published.
- **Connection (redacted):**
  ```json
  { "target": { "kind": "direct", "host": "127.0.0.1", "port": <assigned>, "directConnection": true },
    "auth":   { "kind": "none" } }
  ```
- **Observed:** ping ok in 5.96 ms. URI synthesis (`mongodb://host:port/?directConnection=true`) and parse path exercised end-to-end.

### 2. SCRAM-SHA-256 (explicit) — PASS

- **Container:** `mongo:7` with `MONGO_INITDB_ROOT_USERNAME=root` / `MONGO_INITDB_ROOT_PASSWORD=***`.
- **Connection:**
  ```json
  { "target": { "kind": "direct", "host": "127.0.0.1", "port": <assigned>, "directConnection": true },
    "auth":   { "kind": "scram", "username": "root", "authDb": "admin", "mechanism": "SCRAM-SHA-256" } }
  ```
- **Observed:** ping ok in 117.22 ms. Driver sent `saslStart` with `mechanism: "SCRAM-SHA-256"` (explicit, no negotiation round-trip).
- **Notes:** Latency ≫ no-auth because of the SCRAM SHA-256 client-key derivation; one-time per connection.

### 3. SCRAM auto-negotiate — PASS

- **Container:** same as #2.
- **Connection:** `mechanism: "auto"` — builder leaves `credential.mechanism = None`, driver negotiates.
- **Observed:** ping ok in 135.20 ms. mongo:7 advertises `SCRAM-SHA-256` (and `SCRAM-SHA-1`); driver picked SHA-256. No panic, no fallback to SHA-1.

### 4. TLS — full CA-trust verification — PASS

- **Container:** `mongo:7` with `--tlsMode requireTLS --tlsCertificateKeyFile /certs/server.pem --tlsCAFile /certs/ca.pem --tlsAllowConnectionsWithoutCertificates`.
- **Certs:** generated at runtime by `openssl` in `/tmp/conn-v2-tls-certs-XXXX/` — self-signed CA, server cert signed by CA, SAN = `DNS:localhost, IP:127.0.0.1`. CA + combined-PEM bind-mounted read-only into the container; permissions set 0644 so uid 999 (mongod) can read.
- **Connection:**
  ```json
  { "target": { "kind": "direct", "host": "127.0.0.1", "port": <assigned>, "directConnection": true },
    "auth":   { "kind": "none" },
    "tls":    { "enabled": true, "caFile": "/tmp/.../ca.pem" } }
  ```
- **Observed:** ping ok in 11.23 ms. rustls handshake completed against the in-process CA; SAN-based hostname check on `127.0.0.1` passed.

### 5. TLS — `allowInvalidCerts` — PASS

- **Container:** same TLS-mongod as #4.
- **Connection:** TLS enabled, `allow_invalid_certs: Some(true)`, **no** `ca_file` set.
- **Observed:** ping ok in 11.94 ms. With no CA trust anchor, the driver would have refused the cert; `allow_invalid_certs` correctly maps to `TlsOptions.allow_invalid_certificates = Some(true)` and the rustls verifier is bypassed.
- **Note on test design:** `mongo:7` refuses to enable TLS without `--tlsCAFile` (SERVER-72839), so the server side still has a CA. The client-side flag is what we're verifying, and the connection succeeding without `ca_file` on the client confirms validation was actually skipped.

### 6. SSH tunnel — password auth — PASS

- **Containers:** `mongo:7` + `linuxserver/openssh-server:latest` on a dedicated docker network (`conn-v2-net-<uuid>`); mongod has `--network-alias mongo` and is **not** port-published.
- **SSH env:** `PASSWORD_ACCESS=true`, `USER_NAME=mongo`, `USER_PASSWORD=***`. Mapped to host port `0:2222`.
- **Tweak applied post-start:** `linuxserver/openssh-server` ships with `AllowTcpForwarding no` in `/config/sshd/sshd_config`. The test exec-s a `sed -i` + `pkill -HUP sshd.pam` after the container is up to flip it on — without this the SSH channel-open succeeds but the upstream forward is silently refused, surfacing as `Connection reset by peer` on the local listener.
- **Connection:**
  ```json
  { "target": { "kind": "direct", "host": "mongo", "port": 27017, "directConnection": true },
    "auth":   { "kind": "none" },
    "ssh":    { "host": "127.0.0.1", "port": <assigned>, "user": "mongo",
                "auth": { "kind": "password" }, "knownHostsPolicy": "accept-any" } }
  ```
- **Observed:** ping ok in 6.71 ms. Builder opened the tunnel (russh), rewrote the URI to `mongodb://127.0.0.1:<tunnel_local>/`, parsed it, ran ping, then `TunnelHandle::close().await` drained cleanly.
- **Known-hosts policy:** `AcceptAny` — sufficient for tests; Strict + AddAndTrust still need the IPC user-confirmation round-trip per `builder.rs:303`.

### 7. SSH tunnel — key auth (no passphrase) — PASS

- **Containers:** same shape as #6.
- **Keypair:** ed25519 generated at runtime by `ssh-keygen -t ed25519 -N ""` into `/tmp/conn-v2-ssh-key-XXXX/`. Public key passed to the sshd container via `-e PUBLIC_KEY=<key contents>` (linuxserver's env-to-`authorized_keys` hook).
- **Connection:** same as #6 but `auth: { "kind": "key", "keyPath": "/tmp/.../id_ed25519", "hasPassphrase": false }`.
- **Observed:** ping ok in 7.72 ms. KeyFileAuth path in the russh bridge handled the no-passphrase case.

### 8. SOCKS5 proxy — PASS

- **Containers:** `mongo:7` + `serjs/go-socks5-proxy:latest` on a dedicated docker network. Proxy port `0:1080` published to host. mongo has `--network-alias mongo` and is not published.
- **Proxy env:** `REQUIRE_AUTH=false` (defaults to true; the image refuses to start without it).
- **Connection:**
  ```json
  { "target": { "kind": "direct", "host": "mongo", "port": 27017, "directConnection": true },
    "auth":   { "kind": "none" },
    "proxy":  { "kind": "socks5", "host": "127.0.0.1", "port": <assigned> } }
  ```
- **Observed:** ping ok in 7.83 ms. Driver established a SOCKS5 CONNECT to `mongo:27017` via the proxy; the docker network DNS resolved `mongo` for the proxy.
- **Prereq:** required the workspace `socks5-proxy` feature wire-up from commit `5a30462`.

---

## Cleanup audit

- All test containers carry `--label conn-v2-test=1`. All networks carry the same.
- `ContainerGuard` and `NetworkGuard` (RAII) call `docker rm -f` / `docker network rm` in their Drop impls; both happen during normal test teardown and on panic-unwind.
- A final `zzz_final_cleanup_sweep` test (runs last under `--test-threads=1` due to its `zzz_` prefix) reaps anything left over:
  ```
  docker rm -f $(docker ps -aq --filter label=conn-v2-test=1)
  docker network rm $(docker network ls -q --filter label=conn-v2-test=1)
  ```
  On this run the sweep had nothing to reap.
- TempDir prefixes are descriptive (`conn-v2-tls-certs-XXXX`, `conn-v2-ssh-key-XXXX`) so any leaked tempfiles in `/tmp` are easy to spot.

---

## Explicitly out of scope (and why)

| Mechanism | Why skipped |
|---|---|
| **LDAP** (PLAIN over $external) | Needs MongoDB **Enterprise** mongod image. Community edition does not implement the server side. Unit test `ldap_uses_plain_mechanism_and_external_source` in `builder.rs` covers the credential-shape contract. |
| **Kerberos** (GSSAPI) | Same as LDAP — Enterprise-only. Additionally requires `mongodb` crate feature `gssapi-auth`, which we do **not** enable. Unit test `kerberos_without_feature_returns_auth_stage_error` verifies the not-compiled-in error path. |
| **AWS IAM** (MONGODB-AWS) | Requires `mongodb` crate feature `aws-auth`, not enabled. Plus the server side needs MongoDB Atlas or an Enterprise build configured for IAM. Unit test `aws_iam_without_feature_returns_auth_stage_error` covers the disabled-feature error. |
| **OIDC** (MONGODB-OIDC) | Enterprise-only on the server side; provider setup (Azure/AWS) is out of scope for a local docker harness. Unit test `oidc_principal_and_provider_propagate` covers field propagation. |
| **X.509 user auth** | Community-supported in principle, but: (a) needs server `--tlsCAFile` matching a CA we control, (b) needs a client cert signed by that CA that mongod accepts as a user identity (subject DN must be added to admin DB), (c) the credential is implicit — driver lifts the subject DN from the TLS handshake, so the test surface beyond what is already exercised in #4 is small. Defer to Phase 2 if a real user need surfaces. Unit test `x509_uses_x509_mechanism_external_source_no_username` covers credential shape. |
| **SSH agent auth** (`SshAuth::Agent`) | Requires an `ssh-agent` process and `ssh-add` of an unencrypted key in the test's environment. Doesn't compose with a single-process test binary. Unit test `ssh_handshake_failure_stages_correctly` exercises the Agent dispatch path against an unreachable host. |
| **TLS `allowInvalidHostnames`** | Driver-side option only available under mongodb crate feature `openssl-tls`. We use rustls. Unit test `allow_invalid_hostnames_requires_openssl_feature` asserts the build-time error. |
| **HTTP / SOCKS4 proxies** | Deferred per the design spec — only SOCKS5 is in scope for Phase 1. Unit tests `http_proxy_returns_tls_stage_error` and `socks4_proxy_returns_tls_stage_error` lock in the "not yet supported" behaviour. |
| **Compressors** (snappy/zlib/zstd) | None of the `*-compression` mongodb features are enabled. Unit test `compressors_skipped_when_mongodb_feature_off` covers the warn-and-drop path. End-to-end coverage would only verify the driver's own compressor implementations — out of scope for builder testing. |

---

## Reproducing locally

```bash
# 1. Ensure docker, openssl, ssh-keygen are on PATH.
docker version          # >= 20.x
openssl version         # any modern build
ssh-keygen -V

# 2. Pre-pull images (optional — first run pulls anyway).
docker pull mongo:7
docker pull linuxserver/openssh-server:latest
docker pull serjs/go-socks5-proxy:latest

# 3. Run.
cd src-tauri
INTEGRATION=1 cargo test --test integration_connection -- \
    --test-threads=1 --nocapture
```

Without `INTEGRATION=1`, every test no-ops in microseconds — safe for `cargo test` in CI environments that don't ship docker.

---

## Files added

- `src-tauri/src/lib.rs` (commit `004a998`) — library target so integration tests can `use mongo_lens::...`.
- `src-tauri/tests/common/mod.rs` (commit `c57fc54`) — docker / cert / keypair helpers + RAII guards.
- `src-tauri/tests/integration_connection.rs` (commit `c57fc54`) — the 8 tests above + final sweep.
- `TEST_REPORT_conn_v2_phase1.md` (this file).

## Production code touched

- `Cargo.toml` (commit `5a30462`, by team-lead) — workspace `socks5-proxy` feature wired to `mongodb/socks5-proxy`. Builder's `#[cfg(feature = "socks5-proxy")]` now evaluates true under default builds, unblocking test_08.
