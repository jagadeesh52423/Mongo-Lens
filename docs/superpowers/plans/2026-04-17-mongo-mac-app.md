# MongoMacApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native-feeling Mac desktop MongoDB client (Studio 3T–style) using Tauri v2 + React, supporting connection management, scripting with Monaco, collection browsing, inline document editing, and saved scripts.

**Architecture:** Tauri v2 shell (Rust backend + WebView React frontend). Rust owns SQLite metadata, macOS Keychain credentials, MongoDB driver for browsing/inline-edits, and Node.js subprocess management for script execution. Frontend uses Zustand for state, Monaco for editing, streams results over Tauri events.

**Tech Stack:** Tauri v2, React 18 + TypeScript + Vite, Zustand v4, Monaco Editor, MongoDB Rust driver v3, `rusqlite` (bundled), `security-framework` (Keychain), Node.js subprocess + `mongodb` npm package, Vitest + @testing-library/react, `cargo test`.

---

## File Structure

```
MongoMacApp/
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs
│       ├── state.rs
│       ├── db/
│       │   ├── mod.rs
│       │   ├── migrate.rs
│       │   ├── connections.rs
│       │   └── scripts.rs
│       ├── keychain.rs
│       ├── mongo.rs
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── connection.rs
│       │   ├── collection.rs
│       │   ├── document.rs
│       │   └── script.rs
│       └── runner/
│           ├── mod.rs
│           └── executor.rs
├── runner/
│   └── harness.js
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types.ts
│   ├── ipc.ts
│   ├── store/
│   │   ├── connections.ts
│   │   ├── editor.ts
│   │   └── results.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── IconRail.tsx
│   │   │   ├── SidePanel.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── connections/
│   │   │   ├── ConnectionPanel.tsx
│   │   │   ├── ConnectionTree.tsx
│   │   │   └── ConnectionDialog.tsx
│   │   ├── editor/
│   │   │   ├── EditorArea.tsx
│   │   │   ├── ScriptEditor.tsx
│   │   │   └── BrowseTab.tsx
│   │   ├── results/
│   │   │   ├── ResultsPanel.tsx
│   │   │   ├── JsonView.tsx
│   │   │   ├── TableView.tsx
│   │   │   └── InlineCell.tsx
│   │   └── saved-scripts/
│   │       ├── SavedScriptsPanel.tsx
│   │       └── SaveScriptDialog.tsx
│   ├── styles/globals.css
│   └── __tests__/
│       └── setup.ts
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
└── index.html
```

---

## Shared Type Contracts

**TypeScript (`src/types.ts`):**
```typescript
export interface Connection {
  id: string; name: string;
  host?: string; port?: number; authDb?: string; username?: string;
  connString?: string;
  sshHost?: string; sshPort?: number; sshUser?: string; sshKeyPath?: string;
  createdAt: string;
}
export interface SavedScript {
  id: string; name: string; content: string; tags: string;
  connectionId?: string; lastRunAt?: string; createdAt: string;
}
export interface EditorTab {
  id: string; title: string; content: string; isDirty: boolean;
  type: 'script' | 'browse';
  connectionId?: string; database?: string; collection?: string;
}
export interface ResultGroup { groupIndex: number; docs: unknown[]; error?: string; }
export interface ExecutionResult { groups: ResultGroup[]; executionMs: number; }
export interface DbNode { name: string; collections: CollectionNode[]; }
export interface CollectionNode { name: string; indexes?: IndexInfo[]; }
export interface IndexInfo { name: string; keys: Record<string, number>; }
```

**Rust (`src-tauri/src/commands/connection.rs`):**
```rust
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub auth_db: Option<String>,
    pub username: Option<String>,
    pub conn_string: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_key_path: Option<String>,
    pub created_at: String,
}
```

**SQLite schema (applied by migrations):**
```sql
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT, port INTEGER DEFAULT 27017,
  auth_db TEXT DEFAULT 'admin', username TEXT, conn_string TEXT,
  ssh_host TEXT, ssh_port INTEGER, ssh_user TEXT, ssh_key_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_scripts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
  tags TEXT DEFAULT '', connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  last_run_at TEXT, created_at TEXT NOT NULL
);
```

---

## Task 1: Scaffold Tauri v2 + React project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles/globals.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules
dist
src-tauri/target
src-tauri/gen
.DS_Store
*.log
.env
.env.local
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "mongomacapp",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@monaco-editor/react": "^4.6.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "monaco-editor": "^0.47.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.4.5",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.13",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MongoMacApp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `src/styles/globals.css`**

```css
:root {
  --bg: #1e1e1e;
  --bg-panel: #252526;
  --bg-rail: #333333;
  --bg-hover: #2a2d2e;
  --fg: #d4d4d4;
  --fg-dim: #858585;
  --border: #3c3c3c;
  --accent: #007acc;
  --accent-green: #4ec9b0;
  --accent-red: #f48771;
  --font-mono: "SF Mono", Menlo, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--font-sans); font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--border); padding: 4px 10px;
  border-radius: 3px; cursor: pointer;
}
button:hover { background: var(--bg-hover); }
input, select, textarea {
  font: inherit; color: inherit;
  background: var(--bg); border: 1px solid var(--border);
  padding: 4px 8px; border-radius: 3px;
}
input:focus, select:focus, textarea:focus { outline: 1px solid var(--accent); }
```

- [ ] **Step 8: Create `src/main.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Create skeleton `src/App.tsx`**

```typescript
export default function App() {
  return <div style={{ padding: 20 }}>MongoMacApp</div>;
}
```

- [ ] **Step 10: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "mongomacapp"
version = "0.1.0"
description = "A native Mac MongoDB client"
authors = ["MongoMacApp"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
mongodb = "3"
tokio = { version = "1", features = ["full"] }
security-framework = "2.11"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
thiserror = "1"
futures-util = "0.3"

[dev-dependencies]
tempfile = "3"

[[bin]]
name = "mongomacapp"
path = "src/main.rs"
```

- [ ] **Step 11: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 12: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MongoMacApp",
  "version": "0.1.0",
  "identifier": "com.mongomacapp.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "MongoMacApp",
        "width": 1280,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "icon": []
  },
  "plugins": {}
}
```

- [ ] **Step 13: Create `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 14: Create minimal `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 15: Verify install + compile**

Run: `npm install`
Expected: installs without errors.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles successfully (may download many crates the first time).

- [ ] **Step 16: Commit**

```bash
git add .
git commit -m "chore: scaffold tauri v2 + react + vite"
```

---

## Task 2: TypeScript types + IPC wrappers

**Files:**
- Create: `src/types.ts`
- Create: `src/ipc.ts`

- [ ] **Step 1: Create `src/types.ts`**

```typescript
export interface Connection {
  id: string;
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  createdAt: string;
}

export interface ConnectionInput {
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  password?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
}

export interface SavedScript {
  id: string;
  name: string;
  content: string;
  tags: string;
  connectionId?: string;
  lastRunAt?: string;
  createdAt: string;
}

export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script' | 'browse';
  connectionId?: string;
  database?: string;
  collection?: string;
}

export interface ResultGroup {
  groupIndex: number;
  docs: unknown[];
  error?: string;
}

export interface ExecutionResult {
  groups: ResultGroup[];
  executionMs: number;
}

export interface DbNode {
  name: string;
  collections: CollectionNode[];
}

export interface CollectionNode {
  name: string;
  indexes?: IndexInfo[];
}

export interface IndexInfo {
  name: string;
  keys: Record<string, number>;
}

export interface BrowsePage {
  docs: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done';
  groupIndex?: number;
  docs?: unknown[];
  error?: string;
  executionMs?: number;
}
```

- [ ] **Step 2: Create `src/ipc.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';
import type {
  Connection,
  ConnectionInput,
  SavedScript,
  DbNode,
  CollectionNode,
  IndexInfo,
  BrowsePage,
} from './types';

export async function listConnections(): Promise<Connection[]> {
  return invoke('list_connections');
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  return invoke('create_connection', { input });
}

export async function updateConnection(id: string, input: ConnectionInput): Promise<Connection> {
  return invoke('update_connection', { id, input });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke('delete_connection', { id });
}

export async function testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
  return invoke('test_connection', { id });
}

export async function connectConnection(id: string): Promise<void> {
  return invoke('connect_connection', { id });
}

export async function disconnectConnection(id: string): Promise<void> {
  return invoke('disconnect_connection', { id });
}

export async function listDatabases(connectionId: string): Promise<string[]> {
  return invoke('list_databases', { connectionId });
}

export async function listCollections(connectionId: string, database: string): Promise<CollectionNode[]> {
  return invoke('list_collections', { connectionId, database });
}

export async function listIndexes(
  connectionId: string,
  database: string,
  collection: string,
): Promise<IndexInfo[]> {
  return invoke('list_indexes', { connectionId, database, collection });
}

export async function browseCollection(
  connectionId: string,
  database: string,
  collection: string,
  page: number,
  pageSize: number,
): Promise<BrowsePage> {
  return invoke('browse_collection', { connectionId, database, collection, page, pageSize });
}

export async function updateDocument(
  connectionId: string,
  database: string,
  collection: string,
  id: string,
  updateJson: string,
): Promise<void> {
  return invoke('update_document', { connectionId, database, collection, id, updateJson });
}

export async function deleteDocument(
  connectionId: string,
  database: string,
  collection: string,
  id: string,
): Promise<void> {
  return invoke('delete_document', { connectionId, database, collection, id });
}

export async function runScript(
  tabId: string,
  connectionId: string,
  database: string,
  script: string,
): Promise<void> {
  return invoke('run_script', { tabId, connectionId, database, script });
}

export async function listScripts(): Promise<SavedScript[]> {
  return invoke('list_scripts');
}

export async function createScript(
  name: string,
  content: string,
  tags: string,
  connectionId?: string,
): Promise<SavedScript> {
  return invoke('create_script', { name, content, tags, connectionId });
}

export async function updateScript(
  id: string,
  name: string,
  content: string,
  tags: string,
  connectionId?: string,
): Promise<SavedScript> {
  return invoke('update_script', { id, name, content, tags, connectionId });
}

export async function deleteScript(id: string): Promise<void> {
  return invoke('delete_script', { id });
}

export async function touchScript(id: string): Promise<void> {
  return invoke('touch_script', { id });
}

export async function checkNodeRunner(): Promise<{ ready: boolean; nodeVersion?: string; message?: string }> {
  return invoke('check_node_runner');
}

export async function installNodeRunner(): Promise<void> {
  return invoke('install_node_runner');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/ipc.ts
git commit -m "feat(ipc): add TypeScript types and invoke wrappers"
```

---

## Task 3: Vitest setup + first passing test

**Files:**
- Create: `vitest.config.ts`
- Create: `src/__tests__/setup.ts`
- Create: `src/__tests__/types.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 2: Create `src/__tests__/setup.ts`**

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));
```

- [ ] **Step 3: Write failing test `src/__tests__/types.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import type { Connection, EditorTab } from '../types';

describe('types smoke', () => {
  it('Connection shape accepts all known fields', () => {
    const c: Connection = {
      id: '1',
      name: 'local',
      host: 'localhost',
      port: 27017,
      createdAt: '2026-04-17T00:00:00Z',
    };
    expect(c.name).toBe('local');
  });

  it('EditorTab allows browse type', () => {
    const tab: EditorTab = {
      id: 't1',
      title: 'users',
      content: '',
      isDirty: false,
      type: 'browse',
      connectionId: 'c1',
      database: 'mydb',
      collection: 'users',
    };
    expect(tab.type).toBe('browse');
  });
});
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts src/__tests__/setup.ts src/__tests__/types.test.ts
git commit -m "test: set up vitest with jsdom and tauri mocks"
```

---

## Task 4: Rust AppState + SQLite migrations

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/migrate.rs`
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write failing test in `src-tauri/src/db/migrate.rs`**

```rust
use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT,
            port INTEGER DEFAULT 27017,
            auth_db TEXT DEFAULT 'admin',
            username TEXT,
            conn_string TEXT,
            ssh_host TEXT,
            ssh_port INTEGER,
            ssh_user TEXT,
            ssh_key_path TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saved_scripts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT DEFAULT '',
            connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
            last_run_at TEXT,
            created_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_create_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('connections','saved_scripts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/db/mod.rs`**

```rust
pub mod migrate;
pub mod connections;
pub mod scripts;

use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate::run_migrations(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate::run_migrations(&conn)?;
    Ok(conn)
}
```

- [ ] **Step 3: Create stub `src-tauri/src/db/connections.rs`**

```rust
// Implemented in Task 5.
```

- [ ] **Step 4: Create stub `src-tauri/src/db/scripts.rs`**

```rust
// Implemented in Task 5.
```

- [ ] **Step 5: Create `src-tauri/src/state.rs`**

```rust
use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db_path: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
}

impl AppState {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            mongo_clients: Mutex::new(HashMap::new()),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }
}
```

- [ ] **Step 6: Update `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
```

- [ ] **Step 7: Add `dirs` dependency to `src-tauri/Cargo.toml`**

No new dependency — use `$HOME` via `std::env` (already in stdlib).

- [ ] **Step 8: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `migrations_create_tables ... ok`, `migrations_are_idempotent ... ok`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/
git commit -m "feat(db): add AppState + SQLite migrations"
```

---

## Task 5: Connection + Script SQLite CRUD

**Files:**
- Modify: `src-tauri/src/db/connections.rs`
- Modify: `src-tauri/src/db/scripts.rs`

- [ ] **Step 1: Write failing tests at bottom of `src-tauri/src/db/connections.rs`**

```rust
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub auth_db: Option<String>,
    pub username: Option<String>,
    pub conn_string: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_key_path: Option<String>,
    pub created_at: String,
}

fn map_row(row: &Row) -> rusqlite::Result<ConnectionRecord> {
    Ok(ConnectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        auth_db: row.get(4)?,
        username: row.get(5)?,
        conn_string: row.get(6)?,
        ssh_host: row.get(7)?,
        ssh_port: row.get(8)?,
        ssh_user: row.get(9)?,
        ssh_key_path: row.get(10)?,
        created_at: row.get(11)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ConnectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
         FROM connections ORDER BY name",
    )?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<ConnectionRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at
         FROM connections WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn insert(conn: &Connection, rec: &ConnectionRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO connections (id,name,host,port,auth_db,username,conn_string,ssh_host,ssh_port,ssh_user,ssh_key_path,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            rec.id, rec.name, rec.host, rec.port, rec.auth_db, rec.username,
            rec.conn_string, rec.ssh_host, rec.ssh_port, rec.ssh_user, rec.ssh_key_path,
            rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &ConnectionRecord) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE connections SET name=?2,host=?3,port=?4,auth_db=?5,username=?6,conn_string=?7,
            ssh_host=?8,ssh_port=?9,ssh_user=?10,ssh_key_path=?11 WHERE id=?1",
        params![
            rec.id, rec.name, rec.host, rec.port, rec.auth_db, rec.username,
            rec.conn_string, rec.ssh_host, rec.ssh_port, rec.ssh_user, rec.ssh_key_path,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str, name: &str) -> ConnectionRecord {
        ConnectionRecord {
            id: id.into(),
            name: name.into(),
            host: Some("localhost".into()),
            port: Some(27017),
            auth_db: Some("admin".into()),
            username: Some("u".into()),
            conn_string: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_key_path: None,
            created_at: "2026-04-17T00:00:00Z".into(),
        }
    }

    #[test]
    fn insert_then_list() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        insert(&c, &sample("2", "prod")).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "local");
        assert_eq!(rows[1].name, "prod");
    }

    #[test]
    fn update_changes_name() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        let mut rec = sample("1", "renamed");
        update(&c, &rec).unwrap();
        rec = get(&c, "1").unwrap().unwrap();
        assert_eq!(rec.name, "renamed");
    }

    #[test]
    fn delete_removes_row() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "local")).unwrap();
        delete(&c, "1").unwrap();
        assert!(get(&c, "1").unwrap().is_none());
    }
}
```

- [ ] **Step 2: Write `src-tauri/src/db/scripts.rs`**

```rust
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScriptRecord {
    pub id: String,
    pub name: String,
    pub content: String,
    pub tags: String,
    pub connection_id: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

fn map_row(row: &Row) -> rusqlite::Result<SavedScriptRecord> {
    Ok(SavedScriptRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        tags: row.get(3)?,
        connection_id: row.get(4)?,
        last_run_at: row.get(5)?,
        created_at: row.get(6)?,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<SavedScriptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,content,tags,connection_id,last_run_at,created_at
         FROM saved_scripts ORDER BY name",
    )?;
    let rows = stmt.query_map([], map_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<SavedScriptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id,name,content,tags,connection_id,last_run_at,created_at
         FROM saved_scripts WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

pub fn insert(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO saved_scripts (id,name,content,tags,connection_id,last_run_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            rec.id, rec.name, rec.content, rec.tags,
            rec.connection_id, rec.last_run_at, rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE saved_scripts SET name=?2,content=?3,tags=?4,connection_id=?5 WHERE id=?1",
        params![rec.id, rec.name, rec.content, rec.tags, rec.connection_id],
    )?;
    Ok(())
}

pub fn touch(conn: &Connection, id: &str, ts: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE saved_scripts SET last_run_at=?2 WHERE id=?1",
        params![id, ts],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM saved_scripts WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str, name: &str) -> SavedScriptRecord {
        SavedScriptRecord {
            id: id.into(),
            name: name.into(),
            content: "db.users.find({})".into(),
            tags: "mongo,find".into(),
            connection_id: None,
            last_run_at: None,
            created_at: "2026-04-17T00:00:00Z".into(),
        }
    }

    #[test]
    fn insert_then_list_scripts() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "a")).unwrap();
        insert(&c, &sample("2", "b")).unwrap();
        assert_eq!(list(&c).unwrap().len(), 2);
    }

    #[test]
    fn touch_sets_last_run() {
        let c = open_in_memory().unwrap();
        insert(&c, &sample("1", "a")).unwrap();
        touch(&c, "1", "2026-04-18T10:00:00Z").unwrap();
        let s = get(&c, "1").unwrap().unwrap();
        assert_eq!(s.last_run_at.as_deref(), Some("2026-04-18T10:00:00Z"));
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all connection and script tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/
git commit -m "feat(db): connections and saved_scripts CRUD"
```

---

## Task 6: macOS Keychain wrapper

**Files:**
- Create: `src-tauri/src/keychain.rs`
- Modify: `src-tauri/src/main.rs` (add `mod keychain;`)

- [ ] **Step 1: Write `src-tauri/src/keychain.rs`**

```rust
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "com.mongomacapp.app";

pub fn account_for(connection_id: &str) -> String {
    format!("mongomacapp.{}", connection_id)
}

pub fn set_password(connection_id: &str, password: &str) -> Result<(), String> {
    let account = account_for(connection_id);
    set_generic_password(SERVICE, &account, password.as_bytes())
        .map_err(|e| e.to_string())
}

pub fn get_password(connection_id: &str) -> Result<Option<String>, String> {
    let account = account_for(connection_id);
    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => {
            let s = String::from_utf8(bytes).map_err(|e| e.to_string())?;
            Ok(Some(s))
        }
        Err(e) => {
            // errSecItemNotFound = -25300
            if format!("{}", e).contains("-25300") || format!("{}", e).contains("not found") {
                Ok(None)
            } else {
                Err(e.to_string())
            }
        }
    }
}

pub fn delete_password(connection_id: &str) -> Result<(), String> {
    let account = account_for(connection_id);
    match delete_generic_password(SERVICE, &account) {
        Ok(()) => Ok(()),
        Err(e) => {
            if format!("{}", e).contains("-25300") || format!("{}", e).contains("not found") {
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_format() {
        assert_eq!(account_for("abc"), "mongomacapp.abc");
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set_password(&id, "hunter2").unwrap();
        let got = get_password(&id).unwrap();
        assert_eq!(got.as_deref(), Some("hunter2"));
        delete_password(&id).unwrap();
        let after = get_password(&id).unwrap();
        assert!(after.is_none());
    }
}
```

- [ ] **Step 2: Update `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod keychain;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
```

- [ ] **Step 3: Run tests (Keychain test requires a login keychain — may prompt first time)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml keychain`
Expected: `account_format` passes; `set_get_delete_roundtrip` passes (macOS may prompt to allow access — approve).

Note: If running on CI without a GUI keychain, skip roundtrip with `--skip set_get_delete`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/keychain.rs src-tauri/src/main.rs
git commit -m "feat(keychain): macOS Keychain wrapper for passwords"
```

---

## Task 7: Connection IPC commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/connection.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/mongo.rs` (minimal stub for test/connect)

- [ ] **Step 1: Create minimal `src-tauri/src/mongo.rs`**

```rust
use crate::db::connections::ConnectionRecord;

pub fn build_uri(rec: &ConnectionRecord, password: Option<&str>) -> String {
    if let Some(cs) = &rec.conn_string {
        if !cs.is_empty() {
            return cs.clone();
        }
    }
    let host = rec.host.clone().unwrap_or_else(|| "localhost".into());
    let port = rec.port.unwrap_or(27017);
    let auth_db = rec.auth_db.clone().unwrap_or_else(|| "admin".into());
    match (&rec.username, password) {
        (Some(u), Some(p)) if !u.is_empty() => {
            let u_enc = urlencoding_encode(u);
            let p_enc = urlencoding_encode(p);
            format!("mongodb://{}:{}@{}:{}/{}", u_enc, p_enc, host, port, auth_db)
        }
        _ => format!("mongodb://{}:{}/{}", host, port, auth_db),
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub async fn ping(uri: &str) -> Result<(), String> {
    use mongodb::{options::ClientOptions, Client};
    let opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    let client = Client::with_options(opts).map_err(|e| e.to_string())?;
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn client_for(uri: &str) -> Result<mongodb::Client, String> {
    use mongodb::{options::ClientOptions, Client};
    let opts = ClientOptions::parse(uri).await.map_err(|e| e.to_string())?;
    Client::with_options(opts).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec() -> ConnectionRecord {
        ConnectionRecord {
            id: "1".into(),
            name: "t".into(),
            host: Some("example.com".into()),
            port: Some(27018),
            auth_db: Some("mydb".into()),
            username: Some("alice".into()),
            conn_string: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_key_path: None,
            created_at: "2026-04-17".into(),
        }
    }

    #[test]
    fn uri_with_password() {
        let u = build_uri(&rec(), Some("p@ss"));
        assert_eq!(u, "mongodb://alice:p%40ss@example.com:27018/mydb");
    }

    #[test]
    fn uri_without_password() {
        let mut r = rec();
        r.username = None;
        assert_eq!(build_uri(&r, None), "mongodb://example.com:27018/mydb");
    }

    #[test]
    fn conn_string_overrides() {
        let mut r = rec();
        r.conn_string = Some("mongodb+srv://cluster.foo/admin".into());
        assert_eq!(build_uri(&r, Some("x")), "mongodb+srv://cluster.foo/admin");
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/commands/mod.rs`**

```rust
pub mod connection;
pub mod collection;
pub mod document;
pub mod script;
```

- [ ] **Step 3: Create stubs `src-tauri/src/commands/collection.rs`, `document.rs`, `script.rs`**

```rust
// src-tauri/src/commands/collection.rs
// Implemented in Task 11.
```

```rust
// src-tauri/src/commands/document.rs
// Implemented in Task 11 / 17.
```

```rust
// src-tauri/src/commands/script.rs
// Implemented in Task 15.
```

- [ ] **Step 4: Write `src-tauri/src/commands/connection.rs`**

```rust
use crate::db::{self, connections::ConnectionRecord};
use crate::keychain;
use crate::mongo;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub auth_db: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub conn_string: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_key_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub error: Option<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionRecord>, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let rec = ConnectionRecord {
        id: id.clone(),
        name: input.name,
        host: input.host,
        port: input.port,
        auth_db: input.auth_db,
        username: input.username,
        conn_string: input.conn_string,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user,
        ssh_key_path: input.ssh_key_path,
        created_at: now_iso(),
    };
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::insert(&conn, &rec).map_err(|e| e.to_string())?;
    if let Some(pw) = input.password {
        if !pw.is_empty() {
            keychain::set_password(&id, &pw)?;
        }
    }
    Ok(rec)
}

#[tauri::command]
pub fn update_connection(
    state: State<'_, AppState>,
    id: String,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let existing = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    let rec = ConnectionRecord {
        id: id.clone(),
        name: input.name,
        host: input.host,
        port: input.port,
        auth_db: input.auth_db,
        username: input.username,
        conn_string: input.conn_string,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user,
        ssh_key_path: input.ssh_key_path,
        created_at: existing.created_at,
    };
    db::connections::update(&conn, &rec).map_err(|e| e.to_string())?;
    if let Some(pw) = input.password {
        if pw.is_empty() {
            keychain::delete_password(&id)?;
        } else {
            keychain::set_password(&id, &pw)?;
        }
    }
    Ok(rec)
}

#[tauri::command]
pub fn delete_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::connections::delete(&conn, &id).map_err(|e| e.to_string())?;
    keychain::delete_password(&id)?;
    let mut clients = state.mongo_clients.lock().unwrap();
    clients.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<TestResult, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    match mongo::ping(&uri).await {
        Ok(()) => Ok(TestResult { ok: true, error: None }),
        Err(e) => Ok(TestResult { ok: false, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn connect_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());
    let client = mongo::client_for(&uri).await?;
    // ping to verify
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| e.to_string())?;
    state.mongo_clients.lock().unwrap().insert(id, client);
    Ok(())
}

#[tauri::command]
pub fn disconnect_connection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mongo_clients.lock().unwrap().remove(&id);
    Ok(())
}
```

- [ ] **Step 5: Update `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod keychain;
mod mongo;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
```

- [ ] **Step 6: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing + new URI tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/
git commit -m "feat(commands): connection CRUD + test/connect IPC commands"
```

---

## Task 8: Zustand stores

**Files:**
- Create: `src/store/connections.ts`
- Create: `src/store/editor.ts`
- Create: `src/store/results.ts`
- Create: `src/__tests__/store.test.ts`

- [ ] **Step 1: Create `src/store/connections.ts`**

```typescript
import { create } from 'zustand';
import type { Connection } from '../types';

interface ConnectionsState {
  connections: Connection[];
  activeConnectionId: string | null;
  activeDatabase: string | null;
  connectedIds: Set<string>;
  setConnections: (list: Connection[]) => void;
  addConnection: (c: Connection) => void;
  updateConnection: (c: Connection) => void;
  removeConnection: (id: string) => void;
  setActive: (connectionId: string | null, database?: string | null) => void;
  markConnected: (id: string) => void;
  markDisconnected: (id: string) => void;
}

export const useConnectionsStore = create<ConnectionsState>((set) => ({
  connections: [],
  activeConnectionId: null,
  activeDatabase: null,
  connectedIds: new Set(),
  setConnections: (list) => set({ connections: list }),
  addConnection: (c) => set((s) => ({ connections: [...s.connections, c] })),
  updateConnection: (c) =>
    set((s) => ({
      connections: s.connections.map((x) => (x.id === c.id ? c : x)),
    })),
  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((x) => x.id !== id),
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)),
    })),
  setActive: (connectionId, database) =>
    set({ activeConnectionId: connectionId, activeDatabase: database ?? null }),
  markConnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds, id]) })),
  markDisconnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)) })),
}));
```

- [ ] **Step 2: Create `src/store/editor.ts`**

```typescript
import { create } from 'zustand';
import type { EditorTab } from '../types';

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, title: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.id === tab.id);
      if (existing) return { activeTabId: tab.id };
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),
  closeTab: (id) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      const nextActive =
        s.activeTabId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.activeTabId;
      return { tabs: remaining, activeTabId: nextActive };
    }),
  setActive: (id) => set({ activeTabId: id }),
  updateContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, content, isDirty: true } : t,
      ),
    })),
  markClean: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
    })),
  renameTab: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
}));
```

- [ ] **Step 3: Create `src/store/results.ts`**

```typescript
import { create } from 'zustand';
import type { ResultGroup } from '../types';

interface TabResults {
  groups: ResultGroup[];
  isRunning: boolean;
  executionMs?: number;
  lastError?: string;
}

interface ResultsState {
  byTab: Record<string, TabResults>;
  startRun: (tabId: string) => void;
  appendGroup: (tabId: string, group: ResultGroup) => void;
  setError: (tabId: string, error: string) => void;
  finishRun: (tabId: string, executionMs: number) => void;
  clearTab: (tabId: string) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  byTab: {},
  startRun: (tabId) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: { groups: [], isRunning: true, executionMs: undefined, lastError: undefined },
      },
    })),
  appendGroup: (tabId, group) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, groups: [...cur.groups, group] } } };
    }),
  setError: (tabId, error) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, lastError: error } } };
    }),
  finishRun: (tabId, executionMs) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, isRunning: false, executionMs } } };
    }),
  clearTab: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
}));
```

- [ ] **Step 4: Write failing test `src/__tests__/store.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionsStore } from '../store/connections';
import { useEditorStore } from '../store/editor';
import { useResultsStore } from '../store/results';

beforeEach(() => {
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useResultsStore.setState({ byTab: {} });
});

describe('connections store', () => {
  it('adds and removes connections', () => {
    const s = useConnectionsStore.getState();
    s.addConnection({ id: '1', name: 'a', createdAt: 't' });
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    useConnectionsStore.getState().removeConnection('1');
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
  });

  it('tracks connected ids', () => {
    useConnectionsStore.getState().markConnected('x');
    expect(useConnectionsStore.getState().connectedIds.has('x')).toBe(true);
    useConnectionsStore.getState().markDisconnected('x');
    expect(useConnectionsStore.getState().connectedIds.has('x')).toBe(false);
  });
});

describe('editor store', () => {
  it('opens then closes a tab', () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: '', isDirty: false, type: 'script',
    });
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe('t1');
    useEditorStore.getState().closeTab('t1');
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabId).toBeNull();
  });

  it('marks dirty on content update', () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'x', isDirty: false, type: 'script',
    });
    useEditorStore.getState().updateContent('t1', 'y');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe('y');
    expect(tab.isDirty).toBe(true);
  });
});

describe('results store', () => {
  it('appends groups during a run', () => {
    useResultsStore.getState().startRun('t1');
    useResultsStore.getState().appendGroup('t1', { groupIndex: 0, docs: [{ a: 1 }] });
    useResultsStore.getState().finishRun('t1', 42);
    const r = useResultsStore.getState().byTab['t1'];
    expect(r.groups).toHaveLength(1);
    expect(r.isRunning).toBe(false);
    expect(r.executionMs).toBe(42);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all store tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/ src/__tests__/store.test.ts
git commit -m "feat(store): zustand stores for connections, editor, results"
```

---

## Task 9: App layout shell

**Files:**
- Create: `src/components/layout/IconRail.tsx`
- Create: `src/components/layout/SidePanel.tsx`
- Create: `src/components/layout/StatusBar.tsx`
- Modify: `src/App.tsx`
- Create: `src/__tests__/layout.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/layout.test.tsx`**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

describe('App shell', () => {
  it('renders icon rail with four buttons', () => {
    render(<App />);
    expect(screen.getByLabelText('Connections')).toBeInTheDocument();
    expect(screen.getByLabelText('Collections')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved Scripts')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('toggles side panel when icon clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText('Saved Scripts'));
    expect(screen.getByTestId('side-panel-title')).toHaveTextContent('Saved Scripts');
  });
});
```

- [ ] **Step 2: Create `src/components/layout/IconRail.tsx`**

```typescript
export type PanelKey = 'connections' | 'collections' | 'saved' | 'settings';

interface Props {
  active: PanelKey;
  onChange: (p: PanelKey) => void;
}

const items: { key: PanelKey; label: string; icon: string }[] = [
  { key: 'connections', label: 'Connections', icon: '⚡' },
  { key: 'collections', label: 'Collections', icon: '🗂' },
  { key: 'saved', label: 'Saved Scripts', icon: '⭐' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export function IconRail({ active, onChange }: Props) {
  return (
    <div
      style={{
        width: 44,
        background: 'var(--bg-rail)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          aria-label={it.label}
          onClick={() => onChange(it.key)}
          style={{
            height: 44,
            border: 'none',
            borderLeft:
              active === it.key ? '2px solid var(--accent)' : '2px solid transparent',
            background: 'transparent',
            color: active === it.key ? 'var(--fg)' : 'var(--fg-dim)',
            fontSize: 18,
            cursor: 'pointer',
          }}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/layout/SidePanel.tsx`**

```typescript
import type { PanelKey } from './IconRail';

interface Props {
  active: PanelKey;
  children?: React.ReactNode;
}

const titles: Record<PanelKey, string> = {
  connections: 'Connections',
  collections: 'Collections',
  saved: 'Saved Scripts',
  settings: 'Settings',
};

export function SidePanel({ active, children }: Props) {
  return (
    <div
      style={{
        width: 280,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        data-testid="side-panel-title"
        style={{
          padding: '8px 12px',
          fontSize: 11,
          textTransform: 'uppercase',
          color: 'var(--fg-dim)',
          letterSpacing: 1,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {titles[active]}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/layout/StatusBar.tsx`**

```typescript
interface Props {
  connectionName?: string;
  database?: string;
  nodeStatus?: string;
}

export function StatusBar({ connectionName, database, nodeStatus }: Props) {
  return (
    <div
      style={{
        height: 22,
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        fontSize: 11,
        color: 'var(--fg-dim)',
        gap: 14,
      }}
    >
      <span>
        <span style={{ color: connectionName ? 'var(--accent-green)' : 'var(--fg-dim)' }}>
          ●
        </span>{' '}
        {connectionName ?? 'No connection'}
      </span>
      {database && <span>{database}</span>}
      <span style={{ marginLeft: 'auto' }}>{nodeStatus ?? ''}</span>
    </div>
  );
}
```

- [ ] **Step 5: Update `src/App.tsx`**

```typescript
import { useState } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';

export default function App() {
  const [panel, setPanel] = useState<PanelKey>('connections');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail active={panel} onChange={setPanel} />
        <SidePanel active={panel}>
          <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Panel content</div>
        </SidePanel>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, padding: 20, color: 'var(--fg-dim)' }}>
            Open a connection to get started.
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: both layout tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/ src/App.tsx src/__tests__/layout.test.tsx
git commit -m "feat(layout): icon rail + side panel + status bar shell"
```

---

## Task 10: Connection UI

**Files:**
- Create: `src/components/connections/ConnectionPanel.tsx`
- Create: `src/components/connections/ConnectionDialog.tsx`
- Modify: `src/App.tsx`
- Create: `src/__tests__/connection-panel.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/connection-panel.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionPanel } from '../components/connections/ConnectionPanel';
import { useConnectionsStore } from '../store/connections';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('ConnectionPanel', () => {
  it('loads connections on mount', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'local', host: 'localhost', port: 27017, createdAt: 't' },
    ]);
    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('local')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith('list_connections');
  });

  it('opens the add dialog', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await user.click(screen.getByText('+ Add'));
    expect(screen.getByText('New Connection')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create `src/components/connections/ConnectionDialog.tsx`**

```typescript
import { useState } from 'react';
import type { Connection, ConnectionInput } from '../../types';

interface Props {
  initial?: Connection;
  onSave: (input: ConnectionInput) => Promise<void>;
  onCancel: () => void;
}

export function ConnectionDialog({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? 'localhost');
  const [port, setPort] = useState(String(initial?.port ?? 27017));
  const [authDb, setAuthDb] = useState(initial?.authDb ?? 'admin');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [connString, setConnString] = useState(initial?.connString ?? '');
  const [sshHost, setSshHost] = useState(initial?.sshHost ?? '');
  const [sshPort, setSshPort] = useState(String(initial?.sshPort ?? ''));
  const [sshUser, setSshUser] = useState(initial?.sshUser ?? '');
  const [sshKeyPath, setSshKeyPath] = useState(initial?.sshKeyPath ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        host: host || undefined,
        port: port ? Number(port) : undefined,
        authDb: authDb || undefined,
        username: username || undefined,
        password: password || undefined,
        connString: connString || undefined,
        sshHost: sshHost || undefined,
        sshPort: sshPort ? Number(sshPort) : undefined,
        sshUser: sshUser || undefined,
        sshKeyPath: sshKeyPath || undefined,
      });
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (t: string) => (
    <div style={{ fontSize: 11, color: 'var(--fg-dim)', marginBottom: 2 }}>{t}</div>
  );

  return (
    <div
      role="dialog"
      aria-label="Connection Dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 20,
          width: 520,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 14px' }}>{initial ? 'Edit Connection' : 'New Connection'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            {label('Name')}
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Host')}
            <input value={host} onChange={(e) => setHost(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Port')}
            <input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Auth DB')}
            <input value={authDb} onChange={(e) => setAuthDb(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div />
          <div>
            {label('Username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('Password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%' }}
              placeholder={initial ? '(unchanged)' : ''}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            {label('Connection String (overrides above if set)')}
            <input
              value={connString}
              onChange={(e) => setConnString(e.target.value)}
              style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
              placeholder="mongodb+srv://..."
            />
          </div>
          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
            <strong style={{ fontSize: 12 }}>SSH Tunnel (optional)</strong>
          </div>
          <div>
            {label('SSH Host')}
            <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH Port')}
            <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH User')}
            <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            {label('SSH Key Path')}
            <input value={sshKeyPath} onChange={(e) => setSshKeyPath(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        {err && <div style={{ color: 'var(--accent-red)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/connections/ConnectionPanel.tsx`**

```typescript
import { useEffect, useState } from 'react';
import {
  listConnections,
  createConnection,
  updateConnection as ipcUpdate,
  deleteConnection as ipcDelete,
  testConnection,
  connectConnection,
  disconnectConnection,
} from '../../ipc';
import { useConnectionsStore } from '../../store/connections';
import { ConnectionDialog } from './ConnectionDialog';
import type { Connection, ConnectionInput } from '../../types';

export function ConnectionPanel() {
  const {
    connections,
    connectedIds,
    activeConnectionId,
    setConnections,
    addConnection,
    updateConnection,
    removeConnection,
    setActive,
    markConnected,
    markDisconnected,
  } = useConnectionsStore();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    listConnections().then(setConnections).catch((e) => console.error(e));
  }, [setConnections]);

  async function handleSave(input: ConnectionInput) {
    if (editing) {
      const updated = await ipcUpdate(editing.id, input);
      updateConnection(updated);
    } else {
      const c = await createConnection(input);
      addConnection(c);
    }
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(c: Connection) {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await ipcDelete(c.id);
    removeConnection(c.id);
  }

  async function handleTest(c: Connection) {
    setStatus((s) => ({ ...s, [c.id]: 'Testing…' }));
    const r = await testConnection(c.id);
    setStatus((s) => ({ ...s, [c.id]: r.ok ? 'OK' : `Error: ${r.error ?? 'unknown'}` }));
  }

  async function handleConnect(c: Connection) {
    try {
      await connectConnection(c.id);
      markConnected(c.id);
      setActive(c.id, null);
    } catch (e) {
      setStatus((s) => ({ ...s, [c.id]: `Error: ${(e as Error).message}` }));
    }
  }

  async function handleDisconnect(c: Connection) {
    await disconnectConnection(c.id);
    markDisconnected(c.id);
    if (activeConnectionId === c.id) setActive(null, null);
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setCreating(true)}>+ Add</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {connections.map((c) => {
          const connected = connectedIds.has(c.id);
          return (
            <li
              key={c.id}
              style={{
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: connected ? 'var(--accent-green)' : 'var(--fg-dim)' }}>●</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                {connected ? (
                  <button onClick={() => handleDisconnect(c)}>Disconnect</button>
                ) : (
                  <button onClick={() => handleConnect(c)}>Connect</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                <button onClick={() => handleTest(c)}>Test</button>
                <button onClick={() => setEditing(c)}>Edit</button>
                <button onClick={() => handleDelete(c)}>Delete</button>
              </div>
              {status[c.id] && (
                <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{status[c.id]}</div>
              )}
            </li>
          );
        })}
      </ul>
      {(creating || editing) && (
        <ConnectionDialog
          initial={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `src/App.tsx` to render `ConnectionPanel`**

```typescript
import { useState } from 'react';
import { IconRail, type PanelKey } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { StatusBar } from './components/layout/StatusBar';
import { ConnectionPanel } from './components/connections/ConnectionPanel';
import { useConnectionsStore } from './store/connections';

export default function App() {
  const [panel, setPanel] = useState<PanelKey>('connections');
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail active={panel} onChange={setPanel} />
        <SidePanel active={panel}>
          {panel === 'connections' && <ConnectionPanel />}
          {panel !== 'connections' && (
            <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Coming soon</div>
          )}
        </SidePanel>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, padding: 20, color: 'var(--fg-dim)' }}>
            Open a connection to get started.
          </div>
        </div>
      </div>
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: connection-panel tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/connections/ src/App.tsx src/__tests__/connection-panel.test.tsx
git commit -m "feat(ui): connection panel and dialog"
```

---

## Task 11: MongoDB Rust helpers + browser + document IPC commands

**Files:**
- Modify: `src-tauri/src/mongo.rs`
- Modify: `src-tauri/src/commands/collection.rs`
- Modify: `src-tauri/src/commands/document.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Extend `src-tauri/src/mongo.rs` with a helper to fetch a cached client**

Add at bottom of `mongo.rs`:

```rust
use crate::state::AppState;
use tauri::State;

pub fn active_client(state: &State<'_, AppState>, id: &str) -> Result<mongodb::Client, String> {
    state
        .mongo_clients
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| "connection not active — connect first".to_string())
}
```

- [ ] **Step 2: Write `src-tauri/src/commands/collection.rs`**

```rust
use crate::mongo;
use crate::state::AppState;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, Document};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionNode {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub keys: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowsePage {
    pub docs: Vec<serde_json::Value>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let names = client
        .list_database_names()
        .await
        .map_err(|e| e.to_string())?;
    Ok(names.into_iter().filter(|n| n != "local").collect())
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<Vec<CollectionNode>, String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let names = client
        .database(&database)
        .list_collection_names()
        .await
        .map_err(|e| e.to_string())?;
    Ok(names.into_iter().map(|name| CollectionNode { name }).collect())
}

#[tauri::command]
pub async fn list_indexes(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<Vec<IndexInfo>, String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let mut cursor = coll.list_indexes().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(idx) = cursor.try_next().await.map_err(|e| e.to_string())? {
        let name = idx
            .options
            .and_then(|o| o.name)
            .unwrap_or_else(|| "(unnamed)".into());
        let keys_json = serde_json::to_value(&idx.keys).unwrap_or(serde_json::Value::Null);
        out.push(IndexInfo { name, keys: keys_json });
    }
    Ok(out)
}

#[tauri::command]
pub async fn browse_collection(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    page: i64,
    page_size: i64,
) -> Result<BrowsePage, String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let total = coll
        .count_documents(doc! {})
        .await
        .map_err(|e| e.to_string())? as i64;
    let skip = (page.max(0)) * page_size;
    let find_opts = mongodb::options::FindOptions::builder()
        .skip(skip as u64)
        .limit(page_size)
        .build();
    let mut cursor = coll
        .find(doc! {})
        .with_options(find_opts)
        .await
        .map_err(|e| e.to_string())?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await.map_err(|e| e.to_string())? {
        let json: serde_json::Value =
            mongodb::bson::to_bson(&d).map_err(|e| e.to_string())?.into();
        docs.push(json);
    }
    Ok(BrowsePage { docs, total, page, page_size })
}
```

- [ ] **Step 3: Write `src-tauri/src/commands/document.rs`**

```rust
use crate::mongo;
use crate::state::AppState;
use mongodb::bson::{doc, oid::ObjectId, Document};
use tauri::State;

fn id_filter(id: &str) -> Document {
    match ObjectId::parse_str(id) {
        Ok(oid) => doc! { "_id": oid },
        Err(_) => doc! { "_id": id },
    }
}

#[tauri::command]
pub async fn update_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
    update_json: String,
) -> Result<(), String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let value: serde_json::Value = serde_json::from_str(&update_json).map_err(|e| e.to_string())?;
    let bson_value = mongodb::bson::to_bson(&value).map_err(|e| e.to_string())?;
    let mut updated: Document = match bson_value {
        mongodb::bson::Bson::Document(d) => d,
        _ => return Err("updateJson must be a JSON object".into()),
    };
    updated.remove("_id");
    coll.update_one(id_filter(&id), doc! { "$set": updated })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
    collection: String,
    id: String,
) -> Result<(), String> {
    let client = mongo::active_client(&state, &connection_id)?;
    let coll = client.database(&database).collection::<Document>(&collection);
    coll.delete_one(id_filter(&id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Update `src-tauri/src/main.rs` with new command handlers**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod keychain;
mod mongo;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
            commands::collection::list_databases,
            commands::collection::list_collections,
            commands::collection::list_indexes,
            commands::collection::browse_collection,
            commands::document::update_document,
            commands::document::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
```

- [ ] **Step 5: Run `cargo check` to confirm compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. (Runtime integration against a real Mongo is tested manually in Task 13.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/mongo.rs src-tauri/src/main.rs
git commit -m "feat(mongo): list dbs/collections/indexes + browse + update/delete"
```

---

## Task 12: Collection tree UI

**Files:**
- Create: `src/components/connections/ConnectionTree.tsx`
- Modify: `src/components/connections/ConnectionPanel.tsx`
- Create: `src/__tests__/connection-tree.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/connection-tree.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionTree } from '../components/connections/ConnectionTree';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
});

describe('ConnectionTree', () => {
  it('lists databases and lazily loads collections', async () => {
    invokeMock
      .mockResolvedValueOnce(['mydb', 'otherdb'])
      .mockResolvedValueOnce([{ name: 'users' }, { name: 'orders' }]);

    const user = userEvent.setup();
    render(<ConnectionTree connectionId="c1" onOpenCollection={() => {}} />);

    await waitFor(() => expect(screen.getByText('mydb')).toBeInTheDocument());
    await user.click(screen.getByText('mydb'));
    await waitFor(() => expect(screen.getByText('users')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Create `src/components/connections/ConnectionTree.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { listDatabases, listCollections } from '../../ipc';
import type { CollectionNode } from '../../types';

interface Props {
  connectionId: string;
  onOpenCollection: (database: string, collection: string) => void;
}

export function ConnectionTree({ connectionId, onOpenCollection }: Props) {
  const [dbs, setDbs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collections, setCollections] = useState<Record<string, CollectionNode[]>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listDatabases(connectionId)
      .then(setDbs)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId]);

  async function toggle(db: string) {
    const isOpen = expanded[db];
    setExpanded((s) => ({ ...s, [db]: !isOpen }));
    if (!isOpen && !collections[db]) {
      try {
        const list = await listCollections(connectionId, db);
        setCollections((s) => ({ ...s, [db]: list }));
      } catch (e) {
        setErr((e as Error).message ?? String(e));
      }
    }
  }

  return (
    <div style={{ padding: 4 }}>
      {err && <div style={{ color: 'var(--accent-red)', padding: 6 }}>{err}</div>}
      {dbs.map((db) => (
        <div key={db}>
          <div
            onClick={() => toggle(db)}
            style={{
              padding: '4px 6px',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{expanded[db] ? '▼' : '▶'}</span>
            <span>{db}</span>
          </div>
          {expanded[db] && collections[db] && (
            <div style={{ paddingLeft: 18 }}>
              {collections[db].map((c) => (
                <div
                  key={c.name}
                  onClick={() => onOpenCollection(db, c.name)}
                  style={{
                    padding: '3px 6px',
                    cursor: 'pointer',
                    color: 'var(--fg-dim)',
                  }}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire tree into `ConnectionPanel`**

Modify `src/components/connections/ConnectionPanel.tsx` — replace the list `<li>` block with this block so the expanded connection shows the tree. Add import at top:

```typescript
import { ConnectionTree } from './ConnectionTree';
import { useEditorStore } from '../../store/editor';
```

Add inside the component (after `status` state):

```typescript
const openTab = useEditorStore((s) => s.openTab);

function openBrowseTab(db: string, col: string, connectionId: string) {
  openTab({
    id: `browse:${connectionId}:${db}:${col}`,
    title: `${col}`,
    content: '',
    isDirty: false,
    type: 'browse',
    connectionId,
    database: db,
    collection: col,
  });
}
```

Replace the `<li>` rendering with:

```typescript
<li
  key={c.id}
  style={{
    padding: '6px 10px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }}
>
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <span style={{ color: connected ? 'var(--accent-green)' : 'var(--fg-dim)' }}>●</span>
    <span style={{ flex: 1 }}>{c.name}</span>
    {connected ? (
      <button onClick={() => handleDisconnect(c)}>Disconnect</button>
    ) : (
      <button onClick={() => handleConnect(c)}>Connect</button>
    )}
  </div>
  <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
    <button onClick={() => handleTest(c)}>Test</button>
    <button onClick={() => setEditing(c)}>Edit</button>
    <button onClick={() => handleDelete(c)}>Delete</button>
  </div>
  {status[c.id] && (
    <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>{status[c.id]}</div>
  )}
  {connected && (
    <ConnectionTree
      connectionId={c.id}
      onOpenCollection={(db, col) => openBrowseTab(db, col, c.id)}
    />
  )}
</li>
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `ConnectionTree` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/connections/ src/__tests__/connection-tree.test.tsx
git commit -m "feat(ui): collection tree with lazy-loaded collections"
```

---

## Task 13: Monaco editor + EditorArea + BrowseTab

**Files:**
- Create: `src/components/editor/ScriptEditor.tsx`
- Create: `src/components/editor/BrowseTab.tsx`
- Create: `src/components/editor/EditorArea.tsx`
- Modify: `src/App.tsx`
- Create: `src/__tests__/editor-area.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/editor-area.test.tsx`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
import { useEditorStore } from '../store/editor';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('EditorArea', () => {
  it('renders placeholder with no tabs', () => {
    render(<EditorArea />);
    expect(screen.getByText(/No editor tab/i)).toBeInTheDocument();
  });

  it('renders a script tab and updates content', async () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
    });
    const user = userEvent.setup();
    render(<EditorArea />);
    const ta = screen.getByTestId('mock-monaco') as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, 'x');
    expect(useEditorStore.getState().tabs[0].content).toBe('x');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
});
```

- [ ] **Step 2: Create `src/components/editor/ScriptEditor.tsx`**

```typescript
import Editor, { OnMount } from '@monaco-editor/react';
import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
}

export function ScriptEditor({ value, onChange, onRun }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun?.();
    });
  };

  return (
    <Editor
      height="100%"
      language="javascript"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        minimap: { enabled: false },
        tabSize: 2,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
```

- [ ] **Step 3: Create `src/components/editor/BrowseTab.tsx`**

```typescript
import { useEffect, useState } from 'react';
import { browseCollection } from '../../ipc';
import type { BrowsePage } from '../../types';

interface Props {
  connectionId: string;
  database: string;
  collection: string;
}

const PAGE_SIZE = 20;

export function BrowseTab({ connectionId, database, collection }: Props) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BrowsePage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    browseCollection(connectionId, database, collection, page, PAGE_SIZE)
      .then(setData)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId, database, collection, page]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong>{database}.{collection}</strong>
        <span style={{ color: 'var(--fg-dim)' }}>
          {data ? `${data.total} documents` : 'loading…'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span style={{ margin: '0 8px' }}>Page {page + 1}</span>
          <button
            disabled={!data || (page + 1) * PAGE_SIZE >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'var(--font-mono)', padding: 10 }}>
        {err && <div style={{ color: 'var(--accent-red)' }}>{err}</div>}
        {data?.docs.map((d, i) => (
          <pre key={i} style={{ margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(d, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/editor/EditorArea.tsx`**

```typescript
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { ScriptEditor } from './ScriptEditor';
import { BrowseTab } from './BrowseTab';
import { runScript } from '../../ipc';
import { useResultsStore } from '../../store/results';

export function EditorArea() {
  const { tabs, activeTabId, setActive, closeTab, updateContent, openTab } = useEditorStore();
  const { activeConnectionId, activeDatabase } = useConnectionsStore();
  const startRun = useResultsStore((s) => s.startRun);
  const active = tabs.find((t) => t.id === activeTabId);

  async function handleRun() {
    if (!active || active.type !== 'script') return;
    if (!activeConnectionId || !activeDatabase) {
      alert('Select a connection and database first');
      return;
    }
    startRun(active.id);
    await runScript(active.id, activeConnectionId, activeDatabase, active.content);
  }

  function newScriptTab() {
    const id = `script:${Date.now()}`;
    openTab({
      id,
      title: 'untitled.js',
      content: '// write your MongoDB script here\n',
      isDirty: false,
      type: 'script',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          height: 32,
          minHeight: 32,
        }}
      >
        <div style={{ display: 'flex', overflow: 'auto', flex: 1 }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                padding: '0 10px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                background: t.id === activeTabId ? 'var(--bg)' : 'transparent',
                borderRight: '1px solid var(--border)',
              }}
            >
              <span>
                {t.title}
                {t.isDirty && ' •'}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                style={{ color: 'var(--fg-dim)' }}
              >
                ✕
              </span>
            </div>
          ))}
          <button onClick={newScriptTab} style={{ margin: '0 6px' }}>
            + New
          </button>
        </div>
        <div style={{ paddingRight: 10 }}>
          <button onClick={handleRun} disabled={!active || active.type !== 'script'}>
            ▶ Run
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {!active && (
          <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
        )}
        {active?.type === 'script' && (
          <ScriptEditor
            value={active.content}
            onChange={(v) => updateContent(active.id, v)}
            onRun={handleRun}
          />
        )}
        {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
          <BrowseTab
            connectionId={active.connectionId}
            database={active.database}
            collection={active.collection}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update `src/App.tsx` to render `EditorArea`**

Replace the middle placeholder div:

```typescript
<div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
  <EditorArea />
</div>
```

Add import:

```typescript
import { EditorArea } from './components/editor/EditorArea';
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: EditorArea tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/ src/App.tsx src/__tests__/editor-area.test.tsx
git commit -m "feat(editor): Monaco script editor + browse tab + tab bar"
```

---

## Task 14: Node.js runner setup + first-run install

**Files:**
- Create: `runner/harness.js`
- Create: `src-tauri/src/runner/mod.rs`
- Create: `src-tauri/src/runner/executor.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Create `runner/harness.js`**

```javascript
const { MongoClient } = require('mongodb');
const fs = require('fs');

const [uri, dbName, scriptPath] = process.argv.slice(2);
const userScript = fs.readFileSync(scriptPath, 'utf8');

let groupIndex = 0;

function emitGroup(docs) {
  const arr = Array.isArray(docs) ? docs : [docs];
  const safe = JSON.parse(JSON.stringify(arr, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && v._bsontype === 'ObjectId') return v.toString();
    return v;
  }));
  process.stdout.write(
    JSON.stringify({ __group: groupIndex++, docs: safe }) + '\n',
  );
}

function makeCollectionProxy(col) {
  const autoCapture = new Set([
    'find', 'aggregate', 'insertOne', 'insertMany',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
    'replaceOne', 'findOne', 'countDocuments', 'distinct',
  ]);
  return new Proxy(col, {
    get(target, prop) {
      if (typeof prop === 'string' && autoCapture.has(prop)) {
        return (...args) => {
          const op = target[prop](...args);
          if (op && typeof op.toArray === 'function') {
            return op.toArray().then((docs) => { emitGroup(docs); return docs; });
          }
          return Promise.resolve(op).then((r) => {
            emitGroup(r === undefined ? null : r);
            return r;
          });
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function wrapDb(raw) {
  return new Proxy(raw, {
    get(target, prop) {
      if (prop === 'collection') {
        return (n) => makeCollectionProxy(target.collection(n));
      }
      const val = target[prop];
      if (val === undefined && typeof prop === 'string' && !prop.startsWith('_')) {
        return makeCollectionProxy(target.collection(prop));
      }
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function extractLine(err) {
  const m = err.stack && err.stack.match(/<anonymous>:(\d+)/);
  return m ? parseInt(m[1], 10) - 1 : null;
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = wrapDb(client.db(dbName));
  try {
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFn('db', 'print', userScript);
    const print = (v) => emitGroup(v);
    await fn(db, print);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({ __error: err.message, line: extractLine(err) }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  process.stderr.write(JSON.stringify({ __error: err.message }) + '\n');
  process.exit(1);
});
```

- [ ] **Step 2: Create `src-tauri/src/runner/mod.rs`**

```rust
pub mod executor;

use std::path::PathBuf;

pub fn runner_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".mongomacapp").join("runner")
}

pub fn harness_path() -> PathBuf {
    runner_dir().join("harness.js")
}

pub fn node_modules_dir() -> PathBuf {
    runner_dir().join("node_modules")
}
```

- [ ] **Step 3: Create `src-tauri/src/runner/executor.rs`**

```rust
use crate::runner::{harness_path, node_modules_dir, runner_dir};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatus {
    pub ready: bool,
    pub node_version: Option<String>,
    pub message: Option<String>,
}

pub fn check_runner() -> RunnerStatus {
    let node_version = match Command::new("node").arg("--version").output() {
        Ok(o) if o.status.success() => {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        }
        _ => None,
    };
    if node_version.is_none() {
        return RunnerStatus {
            ready: false,
            node_version: None,
            message: Some("Node.js not found on PATH. Install Node 18+.".into()),
        };
    }
    let installed = node_modules_dir().join("mongodb").is_dir();
    let harness_ok = harness_path().is_file();
    let ready = installed && harness_ok;
    RunnerStatus {
        ready,
        node_version,
        message: if ready {
            None
        } else {
            Some("mongodb package not yet installed — run install_node_runner.".into())
        },
    }
}

pub fn install_runner(bundled_harness: &str) -> Result<(), String> {
    let dir = runner_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(harness_path(), bundled_harness).map_err(|e| e.to_string())?;
    let pkg = r#"{"name":"mongomacapp-runner","version":"1.0.0","dependencies":{"mongodb":"^6.8.0"}}"#;
    fs::write(dir.join("package.json"), pkg).map_err(|e| e.to_string())?;
    let status = Command::new("npm")
        .arg("install")
        .arg("--silent")
        .arg("--no-audit")
        .arg("--no-fund")
        .current_dir(&dir)
        .status()
        .map_err(|e| format!("failed to run npm install: {}", e))?;
    if !status.success() {
        return Err("npm install failed".into());
    }
    Ok(())
}

pub fn spawn_script(
    uri: &str,
    database: &str,
    script_path: &PathBuf,
) -> Result<std::process::Child, String> {
    Command::new("node")
        .arg(harness_path())
        .arg(uri)
        .arg(database)
        .arg(script_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_node_runner() -> RunnerStatus {
    check_runner()
}

#[tauri::command]
pub fn install_node_runner() -> Result<(), String> {
    const HARNESS: &str = include_str!("../../../runner/harness.js");
    install_runner(HARNESS)
}
```

- [ ] **Step 4: Update `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod keychain;
mod mongo;
mod runner;
mod state;

use state::AppState;
use std::fs;

fn main() {
    let base = dirs_dir();
    fs::create_dir_all(&base).expect("create app dir");
    let db_path = base.join("mongomacapp.sqlite");
    let _ = db::open(&db_path).expect("open & migrate sqlite");
    let app_state = AppState::new(db_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
            commands::collection::list_databases,
            commands::collection::list_collections,
            commands::collection::list_indexes,
            commands::collection::browse_collection,
            commands::document::update_document,
            commands::document::delete_document,
            runner::executor::check_node_runner,
            runner::executor::install_node_runner,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".mongomacapp")
}
```

- [ ] **Step 5: Compile check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git add runner/ src-tauri/src/runner/ src-tauri/src/main.rs
git commit -m "feat(runner): harness.js + Node.js installer IPC"
```

---

## Task 15: Script runner IPC + results streaming

**Files:**
- Modify: `src-tauri/src/commands/script.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src/hooks/useScriptEvents.ts`
- Modify: `src/components/editor/EditorArea.tsx`

- [ ] **Step 1: Write `src-tauri/src/commands/script.rs`**

```rust
use crate::db;
use crate::keychain;
use crate::mongo;
use crate::runner::executor::spawn_script;
use crate::state::AppState;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEvent {
    pub tab_id: String,
    pub kind: String,
    pub group_index: Option<i64>,
    pub docs: Option<serde_json::Value>,
    pub error: Option<String>,
    pub execution_ms: Option<u128>,
}

#[tauri::command]
pub async fn run_script(
    app: AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    connection_id: String,
    database: String,
    script: String,
) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = db::connections::get(&conn, &connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "connection not found".to_string())?;
    drop(conn);
    let pw = keychain::get_password(&connection_id)?;
    let uri = mongo::build_uri(&rec, pw.as_deref());

    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("mongomacapp-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    let tab_id_arc: Arc<String> = Arc::new(tab_id);
    let app_handle = app.clone();

    let start = Instant::now();
    let mut child = spawn_script(&uri, &database, &script_path)?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let stdout_handle = {
        let ah = app_handle.clone();
        let tab = tab_id_arc.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let (Some(idx), Some(docs)) =
                        (v.get("__group").and_then(|x| x.as_i64()), v.get("docs"))
                    {
                        let evt = ScriptEvent {
                            tab_id: (*tab).clone(),
                            kind: "group".into(),
                            group_index: Some(idx),
                            docs: Some(docs.clone()),
                            error: None,
                            execution_ms: None,
                        };
                        let _ = ah.emit("script-event", evt);
                    }
                }
            }
        })
    };

    let stderr_handle = {
        let ah = app_handle.clone();
        let tab = tab_id_arc.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let err = serde_json::from_str::<serde_json::Value>(&line)
                    .ok()
                    .and_then(|v| v.get("__error").and_then(|e| e.as_str()).map(|s| s.to_string()))
                    .unwrap_or(line);
                let evt = ScriptEvent {
                    tab_id: (*tab).clone(),
                    kind: "error".into(),
                    group_index: None,
                    docs: None,
                    error: Some(err),
                    execution_ms: None,
                };
                let _ = ah.emit("script-event", evt);
            }
        })
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let _ = std::fs::remove_file(&script_path);

    let elapsed = start.elapsed().as_millis();
    let done = ScriptEvent {
        tab_id: (*tab_id_arc).clone(),
        kind: "done".into(),
        group_index: None,
        docs: None,
        error: if status.success() { None } else { Some("exited with error".into()) },
        execution_ms: Some(elapsed),
    };
    let _ = app_handle.emit("script-event", done);
    Ok(())
}
```

- [ ] **Step 2: Register `run_script` in `src-tauri/src/main.rs`**

Add `commands::script::run_script` to the `generate_handler!` list:

```rust
.invoke_handler(tauri::generate_handler![
    commands::connection::list_connections,
    commands::connection::create_connection,
    commands::connection::update_connection,
    commands::connection::delete_connection,
    commands::connection::test_connection,
    commands::connection::connect_connection,
    commands::connection::disconnect_connection,
    commands::collection::list_databases,
    commands::collection::list_collections,
    commands::collection::list_indexes,
    commands::collection::browse_collection,
    commands::document::update_document,
    commands::document::delete_document,
    commands::script::run_script,
    runner::executor::check_node_runner,
    runner::executor::install_node_runner,
])
```

- [ ] **Step 3: Create `src/hooks/useScriptEvents.ts`**

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useResultsStore } from '../store/results';
import type { ScriptEvent } from '../types';

export function useScriptEvents() {
  const { appendGroup, setError, finishRun } = useResultsStore();

  useEffect(() => {
    let unsub: (() => void) | null = null;
    listen<ScriptEvent>('script-event', (e) => {
      const p = e.payload;
      if (p.kind === 'group' && p.groupIndex !== undefined && p.docs !== undefined) {
        appendGroup(p.tabId, {
          groupIndex: p.groupIndex,
          docs: Array.isArray(p.docs) ? p.docs : [p.docs],
        });
      } else if (p.kind === 'error' && p.error) {
        setError(p.tabId, p.error);
      } else if (p.kind === 'done') {
        finishRun(p.tabId, p.executionMs ?? 0);
      }
    }).then((fn) => {
      unsub = fn;
    });
    return () => {
      if (unsub) unsub();
    };
  }, [appendGroup, setError, finishRun]);
}
```

- [ ] **Step 4: Hook into `App.tsx`**

Add import + call in `App()`:

```typescript
import { useScriptEvents } from './hooks/useScriptEvents';
```

Call it near the top of `App()`:

```typescript
useScriptEvents();
```

- [ ] **Step 5: Compile + run tests**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Run: `npm test`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/script.rs src-tauri/src/main.rs src/hooks/ src/App.tsx
git commit -m "feat(script): run_script IPC command + streaming events"
```

---

## Task 16: Results panel — JsonView + TableView

**Files:**
- Create: `src/components/results/JsonView.tsx`
- Create: `src/components/results/TableView.tsx`
- Create: `src/components/results/ResultsPanel.tsx`
- Modify: `src/components/editor/EditorArea.tsx`
- Create: `src/__tests__/results-panel.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/results-panel.test.tsx`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResultsPanel } from '../components/results/ResultsPanel';
import { useResultsStore } from '../store/results';

beforeEach(() => {
  useResultsStore.setState({ byTab: {} });
});

describe('ResultsPanel', () => {
  it('shows placeholder when no results for tab', () => {
    render(<ResultsPanel tabId="t1" />);
    expect(screen.getByText(/Run a script/i)).toBeInTheDocument();
  });

  it('renders JSON by default', () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    render(<ResultsPanel tabId="t1" />);
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it('switches to Table view', async () => {
    useResultsStore.setState({
      byTab: {
        t1: {
          groups: [{ groupIndex: 0, docs: [{ name: 'alice' }, { name: 'bob' }] }],
          isRunning: false,
          executionMs: 10,
        },
      },
    });
    const user = userEvent.setup();
    render(<ResultsPanel tabId="t1" />);
    await user.click(screen.getByText('Table'));
    expect(screen.getAllByRole('cell').some((c) => c.textContent === 'alice')).toBe(true);
  });
});
```

- [ ] **Step 2: Create `src/components/results/JsonView.tsx`**

```typescript
interface Props {
  docs: unknown[];
}

export function JsonView({ docs }: Props) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', padding: 10, overflow: 'auto' }}>
      {docs.map((d, i) => (
        <pre
          key={i}
          style={{
            margin: '0 0 10px',
            whiteSpace: 'pre-wrap',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 8,
          }}
        >
          {JSON.stringify(d, null, 2)}
        </pre>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/results/TableView.tsx`**

```typescript
import { useMemo, useState } from 'react';

interface Props {
  docs: unknown[];
  onEditCell?: (rowIdx: number, key: string, newValue: string) => void;
  onDelete?: (rowIdx: number) => void;
}

function columnsOf(docs: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of docs) {
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d as Record<string, unknown>)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  return out;
}

export function TableView({ docs, onEditCell, onDelete }: Props) {
  const columns = useMemo(() => columnsOf(docs), [docs]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    if (!sortKey) return docs;
    const arr = [...docs];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] as unknown;
      const bv = (b as Record<string, unknown>)[sortKey] as unknown;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return String(av) < String(bv) ? -sortDir : sortDir;
    });
    return arr;
  }, [docs, sortKey, sortDir]);

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => {
                  if (sortKey === c) setSortDir((d) => (d === 1 ? -1 : 1));
                  else {
                    setSortKey(c);
                    setSortDir(1);
                  }
                }}
                style={{
                  borderBottom: '1px solid var(--border)',
                  padding: '4px 8px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: 'var(--bg-panel)',
                  position: 'sticky',
                  top: 0,
                }}
              >
                {c} {sortKey === c ? (sortDir === 1 ? '↑' : '↓') : ''}
              </th>
            ))}
            {onDelete && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const obj = d as Record<string, unknown>;
                const raw = obj[c];
                const str = raw === undefined ? '—' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
                return (
                  <td
                    key={c}
                    style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}
                    onDoubleClick={() => {
                      if (!onEditCell) return;
                      const val = prompt(`Edit ${c}`, str);
                      if (val !== null && val !== str) onEditCell(i, c, val);
                    }}
                  >
                    {str}
                  </td>
                );
              })}
              {onDelete && (
                <td style={{ borderBottom: '1px solid var(--border)', padding: '4px 8px' }}>
                  <button onClick={() => onDelete(i)} title="Delete row">🗑</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/results/ResultsPanel.tsx`**

```typescript
import { useMemo, useState } from 'react';
import { useResultsStore } from '../../store/results';
import { JsonView } from './JsonView';
import { TableView } from './TableView';

interface Props {
  tabId: string;
}

export function ResultsPanel({ tabId }: Props) {
  const res = useResultsStore((s) => s.byTab[tabId]);
  const [view, setView] = useState<'json' | 'table'>('json');

  const allDocs = useMemo(() => {
    if (!res) return [];
    return res.groups.flatMap((g) => g.docs);
  }, [res]);

  if (!res || (res.groups.length === 0 && !res.isRunning && !res.lastError)) {
    return (
      <div style={{ padding: 12, color: 'var(--fg-dim)' }}>
        Run a script to see results.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        <button onClick={() => setView('json')} disabled={view === 'json'}>JSON</button>
        <button onClick={() => setView('table')} disabled={view === 'table'}>Table</button>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-dim)', fontSize: 11 }}>
          {res.isRunning ? 'Running…' : `${allDocs.length} docs · ${res.executionMs ?? 0} ms`}
        </span>
      </div>
      {res.lastError && (
        <div style={{ padding: 8, color: 'var(--accent-red)', fontFamily: 'var(--font-mono)' }}>
          {res.lastError}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'json' ? <JsonView docs={allDocs} /> : <TableView docs={allDocs} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Show `ResultsPanel` under the editor**

Modify `src/components/editor/EditorArea.tsx` — replace the `<div style={{ flex: 1, minHeight: 0 }}>` body wrapping the active editor so it splits top/bottom when on a script tab.

Replace:

```typescript
<div style={{ flex: 1, minHeight: 0 }}>
  {!active && (
    <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
  )}
  {active?.type === 'script' && (
    <ScriptEditor
      value={active.content}
      onChange={(v) => updateContent(active.id, v)}
      onRun={handleRun}
    />
  )}
  {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
    <BrowseTab
      connectionId={active.connectionId}
      database={active.database}
      collection={active.collection}
    />
  )}
</div>
```

with:

```typescript
<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
  {!active && (
    <div style={{ padding: 20, color: 'var(--fg-dim)' }}>No editor tab open.</div>
  )}
  {active?.type === 'script' && (
    <>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ScriptEditor
          value={active.content}
          onChange={(v) => updateContent(active.id, v)}
          onRun={handleRun}
        />
      </div>
      <div style={{ height: 260, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <ResultsPanel tabId={active.id} />
      </div>
    </>
  )}
  {active?.type === 'browse' && active.connectionId && active.database && active.collection && (
    <BrowseTab
      connectionId={active.connectionId}
      database={active.database}
      collection={active.collection}
    />
  )}
</div>
```

Add import:

```typescript
import { ResultsPanel } from '../results/ResultsPanel';
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: ResultsPanel tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/results/ src/components/editor/EditorArea.tsx src/__tests__/results-panel.test.tsx
git commit -m "feat(results): JSON + Table views + results panel"
```

---

## Task 17: Inline document editing

**Files:**
- Create: `src/components/results/InlineCell.tsx`
- Modify: `src/components/results/TableView.tsx`
- Modify: `src/components/editor/BrowseTab.tsx`
- Create: `src/__tests__/inline-cell.test.tsx`

- [ ] **Step 1: Write failing test `src/__tests__/inline-cell.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineCell } from '../components/results/InlineCell';

describe('InlineCell', () => {
  it('saves a new value', async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<InlineCell value="a" onSave={save} />);
    await user.dblClick(screen.getByText('a'));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'b');
    await user.click(screen.getByText('Save'));
    expect(save).toHaveBeenCalledWith('b');
  });

  it('cancels without saving', async () => {
    const save = vi.fn();
    const user = userEvent.setup();
    render(<InlineCell value="a" onSave={save} />);
    await user.dblClick(screen.getByText('a'));
    await user.click(screen.getByText('Cancel'));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('a')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create `src/components/results/InlineCell.tsx`**

```typescript
import { useState } from 'react';

interface Props {
  value: string;
  onSave: (newValue: string) => void;
}

export function InlineCell({ value, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span onDoubleClick={() => { setDraft(value); setEditing(true); }} style={{ cursor: 'text' }}>
        {value}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        style={{ width: 140 }}
      />
      <button onClick={() => { onSave(draft); setEditing(false); }}>Save</button>
      <button onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
}
```

- [ ] **Step 3: Wire InlineCell into `BrowseTab`**

Replace body of `src/components/editor/BrowseTab.tsx` rendering to use TableView with editing enabled:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { browseCollection, updateDocument, deleteDocument } from '../../ipc';
import type { BrowsePage } from '../../types';
import { TableView } from '../results/TableView';

interface Props {
  connectionId: string;
  database: string;
  collection: string;
}

const PAGE_SIZE = 20;

export function BrowseTab({ connectionId, database, collection }: Props) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BrowsePage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    browseCollection(connectionId, database, collection, page, PAGE_SIZE)
      .then(setData)
      .catch((e) => setErr((e as Error).message ?? String(e)));
  }, [connectionId, database, collection, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEditCell(rowIdx: number, key: string, newValue: string) {
    if (!data) return;
    const doc = data.docs[rowIdx] as Record<string, unknown>;
    const id = String(doc._id);
    const updated = { ...doc, [key]: tryParse(newValue) };
    try {
      await updateDocument(connectionId, database, collection, id, JSON.stringify(updated));
      load();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  async function handleDelete(rowIdx: number) {
    if (!data) return;
    const doc = data.docs[rowIdx] as Record<string, unknown>;
    const id = String(doc._id);
    if (!confirm(`Delete document ${id}?`)) return;
    try {
      await deleteDocument(connectionId, database, collection, id);
      load();
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <strong>{database}.{collection}</strong>
        <span style={{ color: 'var(--fg-dim)' }}>
          {data ? `${data.total} documents` : 'loading…'}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span style={{ margin: '0 8px' }}>Page {page + 1}</span>
          <button
            disabled={!data || (page + 1) * PAGE_SIZE >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </span>
      </div>
      {err && <div style={{ color: 'var(--accent-red)', padding: 8 }}>{err}</div>}
      {data && (
        <TableView docs={data.docs} onEditCell={handleEditCell} onDelete={handleDelete} />
      )}
    </div>
  );
}

function tryParse(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: InlineCell tests pass; other tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/results/InlineCell.tsx src/components/editor/BrowseTab.tsx src/__tests__/inline-cell.test.tsx
git commit -m "feat(edit): inline document editing + delete in browse tab"
```

---

## Task 18: Export CSV + JSON

**Files:**
- Create: `src/utils/export.ts`
- Modify: `src/components/results/ResultsPanel.tsx`
- Create: `src/__tests__/export.test.ts`

- [ ] **Step 1: Write failing test `src/__tests__/export.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { toCsv, toJsonText } from '../utils/export';

describe('export utils', () => {
  it('builds CSV with header row and escapes commas', () => {
    const csv = toCsv([{ a: 1, b: 'x,y' }, { a: 2, b: 'z' }]);
    expect(csv.split('\n')[0]).toBe('a,b');
    expect(csv.split('\n')[1]).toBe('1,"x,y"');
  });

  it('formats JSON with 2 spaces', () => {
    const s = toJsonText([{ a: 1 }]);
    expect(s).toContain('  "a": 1');
  });
});
```

- [ ] **Step 2: Create `src/utils/export.ts`**

```typescript
export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return '';
  const cols = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r as Record<string, unknown>)) cols.add(k);
    }
  }
  const colList = [...cols];
  const header = colList.map(csvEscape).join(',');
  const body = rows
    .map((r) =>
      colList
        .map((c) => {
          const v = (r as Record<string, unknown>)[c];
          if (v === undefined || v === null) return '';
          const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return csvEscape(str);
        })
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}`;
}

function csvEscape(s: string): string {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toJsonText(rows: unknown[]): string {
  return JSON.stringify(rows, null, 2);
}
```

- [ ] **Step 3: Add export button to `ResultsPanel.tsx`**

Modify `src/components/results/ResultsPanel.tsx`. Add imports:

```typescript
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { toCsv, toJsonText } from '../../utils/export';
```

Note: add dep `@tauri-apps/plugin-fs` in `package.json` dependencies:

```json
"@tauri-apps/plugin-fs": "^2.0.0"
```

And plug it in `src-tauri/Cargo.toml`:

```toml
tauri-plugin-fs = "2"
```

Register plugin in `src-tauri/src/main.rs`:

```rust
.plugin(tauri_plugin_fs::init())
```

And add `"fs:default"` to `src-tauri/capabilities/default.json` permissions.

Inside `ResultsPanel`, add near the top:

```typescript
async function exportAs(kind: 'csv' | 'json') {
  const suggested = kind === 'csv' ? 'results.csv' : 'results.json';
  const path = await saveDialog({ defaultPath: suggested });
  if (!path) return;
  const content = kind === 'csv' ? toCsv(allDocs) : toJsonText(allDocs);
  await writeTextFile(path as string, content);
}
```

Add to the header toolbar:

```typescript
<button onClick={() => exportAs('csv')}>Export CSV</button>
<button onClick={() => exportAs('json')}>Export JSON</button>
```

- [ ] **Step 4: Run tests**

Run: `npm install` (to pick up new dep)
Run: `npm test`
Expected: export tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/export.ts src/components/results/ResultsPanel.tsx src/__tests__/export.test.ts package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "feat(export): CSV + JSON export with native save dialog"
```

---

## Task 19: Saved scripts

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (add module)
- Create: `src-tauri/src/commands/saved_script.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `src/components/saved-scripts/SavedScriptsPanel.tsx`
- Create: `src/components/saved-scripts/SaveScriptDialog.tsx`
- Modify: `src/App.tsx`
- Create: `src/__tests__/saved-scripts.test.tsx`

- [ ] **Step 1: Create `src-tauri/src/commands/saved_script.rs`**

```rust
use crate::db::{self, scripts::SavedScriptRecord};
use crate::state::AppState;
use tauri::State;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn list_scripts(state: State<'_, AppState>) -> Result<Vec<SavedScriptRecord>, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::scripts::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_script(
    state: State<'_, AppState>,
    name: String,
    content: String,
    tags: String,
    connection_id: Option<String>,
) -> Result<SavedScriptRecord, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = SavedScriptRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        content,
        tags,
        connection_id,
        last_run_at: None,
        created_at: now_iso(),
    };
    db::scripts::insert(&conn, &rec).map_err(|e| e.to_string())?;
    Ok(rec)
}

#[tauri::command]
pub fn update_script(
    state: State<'_, AppState>,
    id: String,
    name: String,
    content: String,
    tags: String,
    connection_id: Option<String>,
) -> Result<SavedScriptRecord, String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let existing = db::scripts::get(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "script not found".to_string())?;
    let rec = SavedScriptRecord {
        id,
        name,
        content,
        tags,
        connection_id,
        last_run_at: existing.last_run_at,
        created_at: existing.created_at,
    };
    db::scripts::update(&conn, &rec).map_err(|e| e.to_string())?;
    Ok(rec)
}

#[tauri::command]
pub fn delete_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::scripts::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn touch_script(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::scripts::touch(&conn, &id, &now_iso()).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Update `src-tauri/src/commands/mod.rs`**

```rust
pub mod connection;
pub mod collection;
pub mod document;
pub mod script;
pub mod saved_script;
```

- [ ] **Step 3: Register commands in `src-tauri/src/main.rs`**

Add to the `generate_handler!` list:

```rust
commands::saved_script::list_scripts,
commands::saved_script::create_script,
commands::saved_script::update_script,
commands::saved_script::delete_script,
commands::saved_script::touch_script,
```

- [ ] **Step 4: Create `src/components/saved-scripts/SaveScriptDialog.tsx`**

```typescript
import { useState } from 'react';

interface Props {
  initialName?: string;
  initialTags?: string;
  onSave: (name: string, tags: string) => Promise<void>;
  onCancel: () => void;
}

export function SaveScriptDialog({ initialName = '', initialTags = '', onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [tags, setTags] = useState(initialTags);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(name.trim(), tags);
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Save Script"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6,
          padding: 20, width: 360,
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Save Script</h3>
        <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>Name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>Tags (comma-separated)</div>
        <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ width: '100%' }} />
        {err && <div style={{ color: 'var(--accent-red)', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/saved-scripts/SavedScriptsPanel.tsx`**

```typescript
import { useEffect, useMemo, useState } from 'react';
import { listScripts, deleteScript, createScript } from '../../ipc';
import { useEditorStore } from '../../store/editor';
import type { SavedScript, EditorTab } from '../../types';
import { SaveScriptDialog } from './SaveScriptDialog';

export function SavedScriptsPanel() {
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [query, setQuery] = useState('');
  const { openTab, tabs, activeTabId } = useEditorStore();
  const [saving, setSaving] = useState(false);

  async function reload() {
    setScripts(await listScripts());
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scripts;
    return scripts.filter(
      (s) => s.name.toLowerCase().includes(q) || s.tags.toLowerCase().includes(q),
    );
  }, [scripts, query]);

  function open(s: SavedScript) {
    const tab: EditorTab = {
      id: `script:${s.id}`,
      title: s.name,
      content: s.content,
      isDirty: false,
      type: 'script',
    };
    openTab(tab);
  }

  async function handleDelete(s: SavedScript) {
    if (!confirm(`Delete script "${s.name}"?`)) return;
    await deleteScript(s.id);
    reload();
  }

  async function handleSaveCurrent(name: string, tags: string) {
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active || active.type !== 'script') {
      throw new Error('Open a script tab first');
    }
    await createScript(name, active.content, tags);
    setSaving(false);
    reload();
  }

  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
        <input
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={() => setSaving(true)}>+ Save</button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {filtered.map((s) => (
          <li
            key={s.id}
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => open(s)}>
              {s.name}
              {s.tags && (
                <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--fg-dim)' }}>
                  {s.tags}
                </span>
              )}
            </span>
            <button onClick={() => handleDelete(s)}>Delete</button>
          </li>
        ))}
      </ul>
      {saving && (
        <SaveScriptDialog
          onSave={handleSaveCurrent}
          onCancel={() => setSaving(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire into `App.tsx`**

Add import:

```typescript
import { SavedScriptsPanel } from './components/saved-scripts/SavedScriptsPanel';
```

Replace the `panel !== 'connections'` branch with:

```typescript
{panel === 'connections' && <ConnectionPanel />}
{panel === 'saved' && <SavedScriptsPanel />}
{panel === 'collections' && <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Connect to a server to view collections.</div>}
{panel === 'settings' && <div style={{ padding: 12, color: 'var(--fg-dim)' }}>Settings — coming soon.</div>}
```

- [ ] **Step 7: Write failing test `src/__tests__/saved-scripts.test.tsx`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SavedScriptsPanel } from '../components/saved-scripts/SavedScriptsPanel';
import { useEditorStore } from '../store/editor';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('SavedScriptsPanel', () => {
  it('loads and opens a script into a tab', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 's1', name: 'find users', content: 'db.users.find({})', tags: 'users', createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('find users')).toBeInTheDocument());
    await user.click(screen.getByText('find users'));
    expect(useEditorStore.getState().tabs[0].content).toBe('db.users.find({})');
  });

  it('filters by search query', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'alpha', content: '', tags: '', createdAt: 't' },
      { id: '2', name: 'beta', content: '', tags: '', createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search…'), 'bet');
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: saved-scripts tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/main.rs src/components/saved-scripts/ src/App.tsx src/__tests__/saved-scripts.test.tsx
git commit -m "feat(saved-scripts): CRUD + panel + save dialog"
```

---

## Task 20: Autocomplete wiring — collection names

**Files:**
- Modify: `src/components/editor/ScriptEditor.tsx`
- Create: `src/hooks/useCollectionCompletions.ts`
- Modify: `src/components/editor/EditorArea.tsx`

- [ ] **Step 1: Create `src/hooks/useCollectionCompletions.ts`**

```typescript
import { useEffect, useState } from 'react';
import { listCollections } from '../ipc';
import type { CollectionNode } from '../types';

export function useCollectionCompletions(
  connectionId: string | null,
  database: string | null,
): CollectionNode[] {
  const [list, setList] = useState<CollectionNode[]>([]);

  useEffect(() => {
    if (!connectionId || !database) {
      setList([]);
      return;
    }
    listCollections(connectionId, database)
      .then(setList)
      .catch(() => setList([]));
  }, [connectionId, database]);

  return list;
}
```

- [ ] **Step 2: Update `src/components/editor/ScriptEditor.tsx` to accept completions**

```typescript
import Editor, { OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  collections?: string[];
}

export function ScriptEditor({ value, onChange, onRun, collections = [] }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const providerRef = useRef<{ dispose: () => void } | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun?.();
    });
  };

  useEffect(() => {
    if (!monacoRef.current) return;
    const monaco = monacoRef.current;
    providerRef.current?.dispose();
    const disposable = monaco.languages.registerCompletionItemProvider('javascript', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        if (!/\bdb\.$/.test(line)) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: collections.map((c) => ({
            label: c,
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: c,
            range,
          })),
        };
      },
    });
    providerRef.current = disposable;
    return () => disposable.dispose();
  }, [collections]);

  return (
    <Editor
      height="100%"
      language="javascript"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        minimap: { enabled: false },
        tabSize: 2,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
```

- [ ] **Step 3: Pipe completions through `EditorArea`**

In `src/components/editor/EditorArea.tsx`, add import:

```typescript
import { useCollectionCompletions } from '../../hooks/useCollectionCompletions';
```

Inside `EditorArea`, near the top:

```typescript
const completions = useCollectionCompletions(activeConnectionId, activeDatabase);
```

And pass to `ScriptEditor`:

```typescript
<ScriptEditor
  value={active.content}
  onChange={(v) => updateContent(active.id, v)}
  onRun={handleRun}
  collections={completions.map((c) => c.name)}
/>
```

- [ ] **Step 4: Compile check + tests**

Run: `npm run build`
Expected: TypeScript build succeeds.

Run: `npm test`
Expected: all existing tests still pass (mock Monaco ignores completions prop).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCollectionCompletions.ts src/components/editor/ScriptEditor.tsx src/components/editor/EditorArea.tsx
git commit -m "feat(editor): autocomplete collection names after 'db.'"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Covered By |
|---|---|
| Tauri v2 + React shell | Task 1 |
| SQLite `connections` + `saved_scripts` schema | Task 4, 5 |
| macOS Keychain password storage | Task 6 |
| Connection CRUD + test/connect | Task 7 |
| Icon rail + contextual panels | Task 9 |
| Connection list + dialog + SSH fields | Task 10 |
| Tree view: DB → collections (lazy) | Task 12 |
| Connection string mode override | Task 7 (`mongo::build_uri`), Task 10 (dialog field) |
| Monaco script editor, multi-tab, Cmd+Enter | Task 13 |
| Script execution via Node.js subprocess + harness | Task 14, 15 |
| Streaming results via Tauri events | Task 15 |
| JSON tab (pretty/collapsible) + Table tab (sortable, `—` for missing) | Task 16 |
| Inline cell editing + delete button | Task 17 |
| Browse tab pagination (first 20 docs, Next/Prev) | Task 13, 17 |
| Export CSV + JSON via native save dialog | Task 18 |
| Saved scripts CRUD + search by name/tag | Task 19 |
| Autocomplete collection names | Task 20 |
| Status bar (active connection, db, Node.js status) | Task 9, 10, 15 |
| SSH tunnel fields persisted (runtime tunnelling deferred — fields captured in schema) | Task 5, 7, 10 |

### Placeholder Scan

- No `TBD` / `TODO` / `implement later` remain in executable steps.
- Empty stub files `collection.rs`, `document.rs`, `script.rs` in Task 7 contain a single `//` comment and are filled in the referenced later tasks (11, 11, 15).
- Every task has complete code and a real run command.

### Type Consistency

- `ConnectionRecord` (Rust) uses `serde(rename_all = "camelCase")` → matches TS `Connection` fields (`authDb`, `sshHost`, etc.).
- `ConnectionInput` (Rust + TS) both include `password` and use camelCase serialization.
- `BrowsePage`, `ScriptEvent` shapes match between Rust emit and TS listener.
- `CollectionNode` / `IndexInfo` names match TS `types.ts`.
- Command names: `list_connections`, `create_connection`, `update_connection`, `delete_connection`, `test_connection`, `connect_connection`, `disconnect_connection`, `list_databases`, `list_collections`, `list_indexes`, `browse_collection`, `update_document`, `delete_document`, `run_script`, `list_scripts`, `create_script`, `update_script`, `delete_script`, `touch_script`, `check_node_runner`, `install_node_runner`. Registered in `main.rs` and called from `src/ipc.ts` — consistent.
- Store field names `activeConnectionId`, `activeDatabase`, `connectedIds`, `byTab` are consistent across all components that read them.

Plan complete.
