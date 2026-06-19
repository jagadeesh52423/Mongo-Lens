# Project-Specific Rules

## Harness deployment

The `runner/` directory holds the **source**. The app at runtime executes the **installed copies** at `~/.mongomacapp/runner/`. The runner JS files are also `include_str!`'d into the Rust binary at **compile time**, and the integrity guard (`src-tauri/src/runner/executor.rs`) **self-heals** on startup: it rewrites every installed runner file from the binary's bundled copy whenever it drifts or is missing.

What this means after editing a `runner/*.js` file:

- **Rebuild the binary** (`npm run tauri dev` / `tauri build`) — the bundle updates at build time, and the next launch auto-deploys it to `~/.mongomacapp/runner/`. No manual copy needed.
- The integrity guard only knows the bundle as of the **last build**, so an edit without a rebuild does **not** reach the running app.

Only deploy manually when you want to test a `runner/*.js` change against an **already-built** binary **without** rebuilding:

```bash
cp runner/harness.js ~/.mongomacapp/runner/harness.js
# copy whichever runner/*.js files you changed
```

Two things to remember when testing in the UI:

- The harness process is **long-lived per connection** (spawned at connect). An existing connection won't pick up new harness code until you **disconnect + reconnect**.
- Verify with the CLI runner first: `node runner/cli.js --selftest` (proves the serve protocol + data ops against local Mongo).
