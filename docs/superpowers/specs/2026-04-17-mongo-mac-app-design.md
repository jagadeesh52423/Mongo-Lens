# MongoMacApp — Design Spec

**Date:** 2026-04-17  
**Status:** Approved

## Overview

A native-feeling Mac desktop app for running MongoDB scripts, managing connections, and exploring collections — similar to Studio 3T but open source and team-friendly.

**Target users:** Open source community, engineering teams  
**Distribution:** Open source (GitHub), team use

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App shell | Tauri (Rust backend + WebView) |
| Frontend | React + TypeScript |
| State management | Zustand |
| Script execution | Node.js subprocess (bundled) |
| Collection browser / doc editing | MongoDB Rust driver |
| Local persistence | SQLite (via `rusqlite`) |
| Credential storage | macOS Keychain (via Tauri keychain API) |

**Rationale:** Tauri keeps the binary small (~10MB shell vs Electron's ~200MB). Node.js subprocess enables full JavaScript execution for complex multi-line scripts without bundling the heavier `mongosh`. The Rust driver handles low-latency operations (collection browsing, inline edits) directly.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React/TypeScript (Tauri WebView)               │
│  ├── UI Components (icon rail, panels, editor)  │
│  └── Zustand store (connections, tabs, results) │
├─────────────────────────────────────────────────┤
│  Tauri IPC Layer (Rust commands)                │
│  ├── connection_manager  (CRUD, test ping)      │
│  ├── script_runner       (spawn Node.js)        │
│  ├── collection_browser  (list dbs/colls/idxs)  │
│  └── document_editor     (inline save/delete)   │
├─────────────────────────────────────────────────┤
│  Rust Backend                                   │
│  ├── MongoDB Rust driver (browser, doc edits)   │
│  ├── Node.js subprocess  (script execution)     │
│  └── SQLite (connections metadata, saved scripts│
└─────────────────────────────────────────────────┘
```

The collection browser and inline document editing use the Rust MongoDB driver directly for low latency. Only script execution goes through Node.js, providing full JavaScript runtime capabilities.

---

## UI Layout

**VS Code-style icon rail + contextual panels:**

```
┌──┬──────────────┬────────────────────────────────┐
│  │              │  [tab1.js ✕] [tab2.js ✕] [+]  ▶ Run  dev/mydb │
│⚡ │ Connections  ├────────────────────────────────┤
│🗂 │ (panel       │  Script Editor                 │
│⭐ │  switches    │  (Monaco, syntax highlight,    │
│  │  with rail)  │   autocomplete, line numbers)  │
│  │              ├── resize handle ───────────────┤
│⚙️ │              │  Results  [JSON][Table]  ⬇Export│
└──┴──────────────┴────────────────────────────────┘
│ ● dev-local  mydb                  Node.js ready │
└─────────────────────────────────────────────────┘
```

**Icon rail panels:**
- ⚡ Connections — connection list + tree (databases → collections)
- 🗂 Collections — collection/index browser for active connection
- ⭐ Saved Scripts — searchable snippet library
- ⚙️ Settings — app preferences

---

## Feature Specs

### Connection Management

- Fields: name, host, port, authDB, username (password in Keychain)
- Connection string mode: paste a `mongodb://` or `mongodb+srv://` URI
- SSH tunnel: host, port, username, private key file path
- Actions: Add / Edit / Delete / Test Connection / Connect
- Passwords stored in macOS Keychain — never in SQLite plaintext
- Active connection indicated by green dot; error shown inline

### Script Editor

- **Engine:** Monaco Editor (same as VS Code)
- **Features:** Syntax highlighting (MongoDB JS), line numbers, multi-tab, autocomplete (collection names, MongoDB operators, JS keywords)
- **Tabs:** Each tab is an independent script; unsaved changes indicated with dot
- **Run button:** Executes current tab's script against the selected connection + database
- **Keyboard shortcut:** `Cmd+Enter` to run

### Script Execution Flow

```
User clicks ▶ Run (or Cmd+Enter)
  → Tauri IPC: run_script(connection_id, database, script)
  → Rust resolves connection string + decrypts credentials from Keychain
  → Rust spawns Node.js subprocess with:
      - MongoDB connection string injected as env var
      - Script wrapped in runner harness:
          const { MongoClient } = require('mongodb')
          const client = new MongoClient(process.env.MONGO_URI)
          const db = client.db(process.env.MONGO_DB)
          // user script injected here
          // each top-level expression result printed as JSON to stdout
          // multiple statements produce multiple result groups, each prefixed
          // with a separator line: {"__result_group": N}
  → stdout streamed back via Tauri event emitter
  → Results panel updates incrementally
  → Execution time + doc count shown in results header
  → Errors shown inline with line number reference
```

### Collection Browser (⚡ / 🗂 panels)

- Tree view: Connection → Databases → Collections → (Indexes sub-node)
- Lazy-loaded: expand a node to fetch its children
- Right-click context menu: Open in editor (inserts a `db.collection.find({})` snippet), View indexes, Drop collection (with confirmation)
- Collection click: opens a browse tab in the main area (distinct from script tabs) showing first 20 documents, with pagination

### Results View

- **JSON tab:** Pretty-printed, syntax-highlighted, collapsible nested objects/arrays
- **Table tab:** Columns auto-derived from first document's keys; missing fields shown as `—`; sortable columns
- **Inline editing:**
  - Table: click any cell → edit in place → Save / Cancel buttons appear
  - JSON: click any value → edit in place → Save / Cancel
  - Save triggers `updateOne` via Rust MongoDB driver using document `_id`
  - Delete document: trash icon per row (with confirmation)
- **Results header:** shows doc count, execution time, pagination (Next 20 / Prev 20)
- **Export:** toolbar button → choose CSV or JSON → native macOS save dialog (via Tauri file dialog API)

### Saved Scripts (⭐ panel)

- Stored in SQLite: `id`, `name`, `content`, `tags` (comma-separated), `last_run_at`, `connection_id` (nullable)
- Actions: Save current tab as script, open script into new tab, rename, delete, search by name/tag
- "Save Script" shortcut: `Cmd+Shift+S`

---

## Data Model (SQLite)

```sql
CREATE TABLE connections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  host        TEXT,
  port        INTEGER DEFAULT 27017,
  auth_db     TEXT DEFAULT 'admin',
  username    TEXT,
  conn_string TEXT,           -- if set, overrides host/port/auth fields
  ssh_host    TEXT,
  ssh_port    INTEGER,
  ssh_user    TEXT,
  ssh_key_path TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE saved_scripts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  content       TEXT NOT NULL,
  tags          TEXT DEFAULT '',
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL
);
```

Passwords stored separately in macOS Keychain with key `mongomacapp.{connection_id}`.

---

## Error Handling

- **Connection failure:** shown in connection panel with error message; "Retry" button
- **Script error:** Node.js stderr captured and shown in results panel with line number; execution time still shown
- **Inline edit failure:** toast notification with error; field reverts to original value
- **SSH tunnel failure:** specific error message distinguishing tunnel vs MongoDB auth failure

---

## Out of Scope (v1)

- Windows / Linux support (Tauri supports it but not targeted for v1)
- Query explain plans
- Data import (CSV/JSON → collection)
- User roles / team sharing of connections
- GridFS browser
