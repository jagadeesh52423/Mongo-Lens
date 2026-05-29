import { useEffect } from 'react';

/**
 * Bootstrap the plugin host: discover installed plugins and activate any that
 * declare `onStartup`. Guard on `__TAURI_INTERNALS__` so this is a no-op in
 * jsdom / unit tests (where Tauri IPC is absent) while still surfacing real
 * Tauri-side failures (FS errors, broken plugins) via `console.error` so they
 * appear in devtools and crash reports.
 *
 * The host is attached to `window.__pluginHost` so other subsystems (the
 * activity registry, plugin-view consumers) can pick it up after bootstrap.
 */
export function usePluginHostBootstrap(): void {
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return; // not in Tauri renderer
    let cancelled = false;
    (async () => {
      try {
        const { createTauriPluginFs } = await import('../plugins/io.tauri');
        const fs = await createTauriPluginFs();
        const { createPluginHost } = await import('../plugins/host');
        const { listV2, saveV2 } = await import('../connection/ipc');
        const host = createPluginHost({
          hostApiVersion: '1.0.0',
          logger: console as never, // replace with the app's structured logger
          fs,
          pluginsRoot: fs.pluginsRoot,
          hostBackend: {
            async dbFind() { throw new Error('Host backend not wired'); },
            async netFetch(url, init) {
              // The plugin host has already enforced the network:fetch scope
              // for this URL before reaching here. We then go through the
              // renderer's fetch (Tauri's webview has CSP set to null so any
              // HTTPS host is reachable). Body is parsed as JSON when the
              // response declares it; otherwise returned as text.
              const res = await fetch(url, init as RequestInit | undefined);
              const ctype = res.headers.get('content-type') ?? '';
              let body: unknown;
              if (ctype.includes('application/json')) {
                try { body = await res.json(); } catch { body = undefined; }
              } else {
                body = await res.text();
              }
              return { status: res.status, body };
            },
            async connectionsList() {
              // Map the connection-V2 model onto the flat ConnectionRef the
              // plugin host exposes to plugins (id/name + best-effort host/
              // port/username). Secrets never cross this boundary.
              const all = await listV2();
              return all.map((c) => {
                const auth = c.auth;
                const username =
                  auth.kind === 'scram' || auth.kind === 'legacy-cr' || auth.kind === 'ldap'
                    ? auth.username
                    : auth.kind === 'kerberos' || auth.kind === 'oidc'
                      ? auth.principal
                      : undefined;
                return {
                  id: c.id,
                  name: c.name,
                  ...(c.target.kind === 'direct'
                    ? { host: c.target.host, port: c.target.port }
                    : {}),
                  ...(username ? { username } : {}),
                };
              });
            },
            async connectionsUpdateCredentials(id, password) {
              // V2 keeps secrets in the OS keychain, passed out-of-band from the
              // connection record. Re-save the existing connection with a fresh
              // auth-password secret; all other fields are left unchanged.
              const all = await listV2();
              const current = all.find((c) => c.id === id);
              if (!current) throw new Error('Connection not found');
              await saveV2({ connection: current, secrets: [{ slot: 'auth-password', value: password }] });
            },
          },
        });
        (window as unknown as Record<string, unknown>).__pluginHost = host;
        await host.manager.discover();
        if (!cancelled) await host.manager.activateStartup();
      } catch (e) {
        console.error('Plugin host bootstrap failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);
}
