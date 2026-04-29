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
