# Troubleshooting

Common issues and fixes for Local Brain MCP. If your problem isn't listed here,
please [open an issue](https://github.com/cosmiccoder200x-sys/local-brain-mcp/issues).

## Installation

### `better-sqlite3` fails to install or load

`better-sqlite3` is a native module. It ships prebuilt binaries for common
platforms, but if yours is missing it falls back to compiling from source.

- **Windows**: install the VS Build Tools (`npm install --global windows-build-tools`
  is deprecated — use the official
  [Build Tools for Visual Studio](https://visualstudio.microsoft.com/downloads/)
  with the "Desktop development with C++" workload), then run:
  ```bash
  npm rebuild better-sqlite3
  ```
- **macOS**: `xcode-select --install`, then `npm rebuild better-sqlite3`.
- **Linux**: install `python3`, `make`, and `g++`, then `npm rebuild better-sqlite3`.

### `EBADENGINE` / engine warnings on install

Local Brain requires **Node.js >= 22.0.0**. Check yours with `node --version`
and upgrade via [nodejs.org](https://nodejs.org/) or a version manager (`nvm`,
`fnm`, `volta`). CI tests Node 22.x and 24.x.

## Editor integration

### My editor doesn't show `local-brain` as an MCP server

1. Run `local-brain doctor` — it reports which editor configs exist and whether
   `local-brain` is linked in each.
2. Run `local-brain init` again to rewrite the configs.
3. **Restart the editor completely** (not just the window) — most editors only
   read MCP configs at startup.
4. Verify the server path in the config points at a real file, e.g.
   `…/node_modules/local-brain-mcp/dist/mcp-server.js` (global install) or the
   equivalent under your global npm root (`npm root -g`).

### `local-brain init` says "No standard AI editor config paths found"

None of the known editors are installed (or they use custom config locations).
Copy the printed JSON snippet into your editor's MCP settings manually.

## Memory & recall

### `brain_recall` / `local-brain query` returns nothing

1. Run `local-brain status` — if total memories is 0, you haven't ingested yet.
2. Run `local-brain ingest` to index your git history.
3. Low-signal lessons are rejected by design: one-liners like `fix typo` or bare
   shell commands never become memories. Write actionable lessons
   ("Never use X because Y") — see `docs/architecture.md` § Quality.
4. Check `local-brain memories` — memories for heavily rewritten files may have
   been marked `STALE` by the invalidation pass.

### `database is locked` errors

Local Brain uses SQLite WAL mode, which supports concurrent readers and one
writer. This error means two writers collided or a crashed process left stale
`-wal`/`-shm` files next to `brain.db`:

1. Close other processes touching the same database.
2. If the error persists with nothing running, delete the `-wal` and `-shm`
   sidecar files (never the `.db` itself) and retry.
3. As a last resort, back up and remove `brain.db` (default locations:
   `<repo>/.git/brain.db` or `~/.config/local-brain/brain.db`) and re-ingest.

## Git hook

### Post-commit hook doesn't ingest

- The hook needs a Unix shell: on Windows it runs under **Git Bash** (bundled
  with Git for Windows). Plain `cmd.exe` checkouts without Git Bash won't
  execute it.
- On macOS/Linux the hook must be executable: `chmod +x .git/hooks/post-commit`.
- The hook resolves the CLI via `command -v local-brain` with a fallback to the
  repo's `node_modules/.bin`. If you installed elsewhere, edit
  `.git/hooks/post-commit` to point at your install.
- Hook failures are silent by design (it runs in the background) — test manually
  with `local-brain ingest --commits 1`.

## Starting over

To wipe all memory and start fresh, stop all agents/editors, delete the database
file (`<repo>/.git/brain.db` or the path in `LOCAL_BRAIN_DB_PATH`), then run
`local-brain init` and `local-brain ingest` again.

## Debug logging

Set `DEBUG=local-brain:*` to get namespaced debug output (namespaces: `db`,
`ingest`, `recall`, `invalidation`, `mcp`, `cli`, `provenance`):

```bash
DEBUG=local-brain:* local-brain ingest --commits 10 --verbose
```
