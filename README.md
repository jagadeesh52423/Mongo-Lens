# 🔍 Mongo Lens

A native macOS desktop client for MongoDB, built with Tauri, React, and Rust.

---

## What It Does

Mongo Lens is a lightweight, keyboard-driven MongoDB GUI for macOS. It gives you a Monaco-powered script editor, a connection manager that stores credentials in the macOS Keychain, and a results viewer with both table and JSON modes. It also ships an AI assistant that can answer questions about your queries and results using any OpenAI-compatible API.

### Features

- **Connection manager** — connect via host/port with auth, connection string, or SSH tunnel. Passwords are stored in the macOS Keychain, encrypted with a per-app master key using AES-256-GCM.
- **Monaco script editor** — full VS Code editing engine with syntax highlighting, multi-tab support, and collection-name autocomplete.
- **Smart execution** — `Cmd+Enter` runs the statement at the cursor; `Shift+Cmd+Enter` runs the entire script. Queries are classified (query, mutation, aggregation, maintenance) to enable context-appropriate behavior.
- **Results viewer** — toggle between a navigable table view and a JSON tree. Arrow-key cell navigation, inline editing, right-click context menu for copy actions.
- **Document editing** — open any result document in a full Monaco JSON editor, make changes, and save back to MongoDB.
- **Export** — export results to CSV or JSON.
- **Saved scripts** — name, tag, and persist scripts across sessions; Save / Save As workflow.
- **AI assistant** — side-panel chat powered by any OpenAI-compatible endpoint. Automatically injects context (current query, results preview, active connection/database) into the system prompt. Supports streaming responses.
- **Customizable keyboard shortcuts** — scope-aware shortcut system (global, editor, results-table) with a settings UI to rebind keys.
- **Theming** — customize colors and fonts via a visual theme editor with live preview.
- **Structured logging** — both the Rust backend and the Node.js runner emit structured JSON logs with sensitive-value redaction.

## Prerequisites

- **macOS 12+** (Apple Silicon or Intel)
- [Node.js](https://nodejs.org) v18+
- [Rust](https://rustup.rs) stable toolchain

```bash
# Install Rust if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Installation

```bash
git clone https://github.com/jagadeesh52423/Mongo-Lens.git
cd Mongo-Lens
npm install
```

## Configuration

Mongo Lens stores its data in `~/.mongomacapp/`:

| Item | Location |
|------|----------|
| SQLite database (connections, saved scripts) | `~/.mongomacapp/data.db` |
| Runner scripts (query execution engine) | `~/.mongomacapp/runner/` |
| Settings (theme, AI config, shortcuts) | `~/.mongomacapp/settings.json` |
| Logs | `~/.mongomacapp/logs/` |

Connection passwords and the AI API token are stored in the **macOS Keychain** under the service `com.mongomacapp.app`.

### AI Assistant Setup

1. Open Settings (`Cmd+,`) → AI tab
2. Enter a base URL for any OpenAI-compatible API (e.g. `https://api.openai.com/v1`)
3. Paste your API token (stored in Keychain, never written to disk)
4. Select a model and click **Test Connection**

## Usage

### Development Mode

```bash
npm run tauri dev
```

> First launch compiles the Rust backend (~2 min). Subsequent starts are fast.

### Build a Distributable `.app`

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/Mongo Lens.app
```

### Workflow

1. Click the connection icon in the rail → **+** to add a connection
2. Fill in host/port or paste a `mongodb://` URI → **Connect**
3. Browse databases and collections in the sidebar tree
4. Open a script tab, write a query, press `Cmd+Enter` to run
5. View results below — switch between Table and JSON, click a cell to edit
6. Press `F4` on a row to open the full document editor

### Key Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Enter` | Run statement at cursor |
| `Shift+Cmd+Enter` | Run entire script |
| `Cmd+T` | New tab |
| `Cmd+W` | Close tab |
| `Cmd+,` | Settings |
| `Cmd+1`..`9` | Jump to tab N |
| Arrow keys | Navigate results table cells |
| `Cmd+C` | Copy cell value |
| `Shift+Cmd+C` | Copy entire document |

### Runner CLI

You can also execute scripts from the terminal without the GUI:

```bash
node runner/cli.js --db myDatabase --file query.js [--uri mongodb://localhost:27017]
```

## Development

```bash
npm test              # Frontend unit tests (Vitest)
npm run test:harness  # Runner harness tests
npm run build         # Type-check + Vite build
```

After editing files in `runner/`, deploy them to the runtime directory:

```bash
cp runner/harness.js runner/query-classifier.js ~/.mongomacapp/runner/
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App shell | Tauri v2 (Rust + WebView) |
| Frontend | React 18, TypeScript, Vite |
| Editor | Monaco Editor |
| State management | Zustand |
| Query execution | Node.js subprocess (`runner/`) |
| MongoDB driver | Rust `mongodb` crate + `mongodb` npm package |
| Local storage | SQLite via `rusqlite` |
| Credential storage | macOS Keychain + AES-256-GCM encryption |
| AI integration | OpenAI-compatible API (configurable) |

## License

MIT

---

Built for developers who want a fast, native MongoDB client without the overhead.
