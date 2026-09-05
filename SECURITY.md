# Security Policy

## Threat Model & Local-Only Guarantees

`local-brain-mcp` is architected as an entirely local-first, zero-egress system designed to operate securely within a developer's workstation without sending codebase context to third-party servers.

### 1. Local-Only Storage
* All memory records, vector embeddings, and commit metadata are stored locally in an embedded SQLite database (`.git/brain.db` or `~/.config/local-brain/brain.db`).
* No data is transmitted to external servers, cloud providers, or analytics platforms.
* No API keys or remote telemetry are required or used.

### 2. Network Isolation
* The MCP server communicates strictly through the standard Model Context Protocol `stdio` transport.
* The server makes zero outbound HTTP/HTTPS requests during memory indexing, embedding generation, or retrieval.

### 3. Path Traversal & Filesystem Boundaries
* All file paths supplied through MCP tools (`brain_recall`, `brain_learn`, `brain_trace`) and CLI arguments are sanitized via `sanitizeFilePath()` to prevent directory traversal attacks (e.g. `../../` or absolute path escapes).
* Filesystem reads are strictly confined to the active repository root.

### 4. SQL Injection Protections
* All SQLite database queries strictly utilize parameterized prepared statements via `better-sqlite3`. No dynamic SQL string concatenation is permitted.

### 5. Git Command Safety
* Git operations use argument arrays with `simple-git` rather than shell string interpolation to prevent command injection.

---

## Sensitive Data Considerations

* Local Brain indexes commit messages and file diffs from high-signal commits (fixes, refactors, architecture changes).
* Do not commit secrets, API keys, passwords, or credentials to your Git history.
* If sensitive information was previously stored in the local brain, it can be purged using `brain_forget` (by ID), `brain_prune` (by status), or by deleting the local `.git/brain.db` file.

---

## Reporting Vulnerabilities

If you discover a security vulnerability in `local-brain-mcp`, please report it responsibly:

* **Email:** Open an advisory on GitHub or email security@cosmiccoder.dev.
* Please provide a reproducible proof-of-concept.
* We aim to acknowledge receipt within 48 hours and provide a patch promptly.
