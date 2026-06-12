# Backlog

Feature ideas for MongoMacApp, grouped by impact.

## High-value additions

- **Aggregation pipeline builder** — visual stage editor (`$match`, `$group`, `$lookup`) with live preview per stage; huge productivity win over hand-writing pipelines.
- **Explain plan visualizer** — run `.explain("executionStats")` and render the winning plan as a tree with index usage, docs examined, time per stage. Pairs with an "index suggestion" hint when COLLSCAN is detected.
- **Schema analyzer** — sample N docs per collection, infer field types/frequency/nullability, flag inconsistencies. Compass has this; users miss it elsewhere.
- **Index manager UI** — list/create/drop indexes, show size and usage stats from `$indexStats`.

## Workflow improvements

- **Query history with diff** — every executed query auto-saved with timestamp/connection/duration; re-run or compare. Different from saved scripts (intentional) vs history (automatic).
- **Bookmarks / pinned documents** — pin a specific `_id` for quick re-open, useful when debugging one record across sessions.
- **Multi-result tabs** — keep prior result sets open in tabs instead of replacing on each run.
- **Diff view between two documents** — pick two docs, see structural diff. Great for "why is this one broken."

## Power-user

- **Change streams viewer** — live tail a collection's oplog/change stream into a rolling panel.
- **Bulk operations UI** — select N rows in table view → updateMany/deleteMany with a generated preview query and dry-run count.
- **Import/export** — `mongoimport`/`mongodump`-equivalent for JSON/CSV/BSON with a UI.
- **Connection groups / environments** — tag connections as dev/staging/prod with a colored banner and a "confirm on write" guard for prod.
- **Cross-collection `$lookup` helper** — pick local/foreign fields from dropdowns, generate the stage.

## Polish

- **Dark mode + theme sync** with macOS appearance.
- **Cmd+P quick switcher** for collections/scripts (extend the tree's type-to-jump globally).
- **Keyboard-only navigation** for the results table (arrow keys, Enter to edit, Esc to cancel).
- **Per-tab connection** so one window can query multiple clusters side-by-side.

## Priority picks

The two to prioritize: **explain plan visualizer** and **prod-write guard with environment coloring** — both are differentiators vs Compass/Studio 3T.

## Plugin configuration follow-ups (from 2026-05-13 review)

- `SettingsSection` / `PluginConfigRoute` should subscribe to `ConfigService.onDidChange` so a second mount sees fresh values on remount.
- `ConfigService.fire()` payload filtering is per-plugin, not per-listener. Functionally equivalent today; revisit if the host ever subscribes.
- Persistent workspace store: `InMemoryWorkspaceLike` in `host.ts` is non-persistent. Plain config values evaporate on restart. Add a Tauri-fs backed `WorkspaceLike` (e.g., `~/.mongomacapp/plugins-workspace/<pluginId>.json`).
- `ConfigStore.setMany` change detection uses strict equality — switch to structural equality (JSON-stringify) when an `object` or `array` config field ships in a real plugin.
- Add a `// must precede stringField — both match type:string` comment above the `secretField` registration in `fieldRenderers/index.ts` to harden against accidental reorder.
- Plus the six "nits" in `CODE_REVIEW.md` if anything resurfaces.

## Keychain-recovery follow-ups (from 2026-06-12 session)

- **Fix pre-existing test flake: `HOME` env race.** `ssh/known_hosts.rs` tests (~line 97) mutate `HOME` without acquiring the cross-module env lock that `keychain.rs` tests (~line 756) use — `legacy_ciphertext_may_exist_fails_closed` fails intermittently under parallel `cargo test`. Serialize all `HOME`-mutating tests behind one shared lock.
- **`skipped_secret` over-counts on probe-failed migration sweep** — when the read-only probe fails, password-less rows are counted as skipped secrets too. Telemetry-only inaccuracy in `migrate_all` counters.
- **`ResolveMode::ReadOnly` doc wording** — says "fail-closed" unconditionally, but ReadOnly still mints a key on a genuine fresh install (Absent + no blobs). Tighten the doc comment.
- **Phase 2 of DESIGN_keychain_resilience.md** — passphrase-wrapped recovery key (`PassphraseWrappedKeyProvider`) so a forced keychain reset is recoverable without password re-entry. Phase 1 (quarantine + re-key on save) shipped in `8228286`/`2e45694`.
- **Recovery sweep UI (optional)** — surface quarantined `orphaned-*` dirs in settings so a user who restores their keychain from Time Machine can attempt re-decryption of preserved blobs.
