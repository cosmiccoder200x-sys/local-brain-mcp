# Contributing to local-brain-mcp

Thank you for your interest in contributing to `local-brain-mcp`! We welcome bug fixes, documentation improvements, and architectural enhancements that adhere to our local-first, privacy-focused principles.

---

## Development Setup

### Prerequisites
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`
- **Git**: `>= 2.30.0`

### Clone & Install
```bash
git clone https://github.com/cosmiccoder200x-sys/local-brain-mcp.git
cd local-brain-mcp
npm install
```

### Build
```bash
npm run build
```

### Type Check
```bash
npm run typecheck
```

### Run Tests
```bash
npm test
```

### Lint
ESLint is configured in `eslint.config.js`. Run it with:
```bash
npx eslint src/
```

---

## Code Style Guidelines

- **TypeScript strict mode** — No `any` types, no `@ts-ignore`. All code must pass `tsc --noEmit` cleanly.
- **ESM only** — All source files use ES module syntax (`import`/`export`). No CommonJS (`require`).
- **2-space indentation** — Consistent across all source files.
- **No external network calls** — All computation must be local and deterministic. Never introduce dependencies that phone home or require cloud API keys.
- **Parameterized SQL** — All database queries must use parameterized statements to prevent injection.
- **Path sanitization** — Use `sanitizeFilePath()` from `scoping.ts` for any user-supplied file paths.
- **Synchronous SQLite** — Database operations use `better-sqlite3` (synchronous, WAL mode).

---

## How to Add a New MCP Tool

1. **Define the tool schema** in `src/mcp-server.ts` inside the `MCP_TOOLS` array:
   - `name`: prefixed with `brain_` (e.g. `brain_search`).
   - `description`: clear, actionable text for AI agents.
   - `annotations`: set `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
   - `inputSchema`: JSON Schema for the tool's parameters.

2. **Add the handler** in the `CallToolRequestSchema` handler block, following the existing `if (name === 'brain_*')` pattern.

3. **Add tests** in `tests/` covering:
   - Successful invocation with valid inputs.
   - Error cases (missing required params, invalid values).
   - Edge cases (empty strings, special characters in paths).

4. **Update documentation** — Add the tool to `README.md` and `docs/architecture.md`.

---

## Pull Request Guidelines

1. Create a feature branch: `git checkout -b feat/my-improvement`.
2. Implement your changes with accompanying tests.
3. Verify that all checks pass:
   ```bash
   npm run typecheck
   npm test
   npm run build
   ```
4. Open a Pull Request describing:
   - **Motivation** — What problem does this solve?
   - **Approach** — How does the solution work?
   - **Test results** — What tests were run and their outcomes.
5. Keep PRs focused — one logical change per PR.

---

## Core Principles

1. **Local-First Always**: Never introduce dependencies that make external network calls, transmit telemetry, or require cloud API keys.
2. **Deterministic & Fast**: Embeddings and ranking algorithms must remain deterministic and operate with sub-millisecond execution.
3. **Test Coverage**: Every new tool, parameter, or bug fix must include tests in `tests/`.
4. **Security Defenses**: Sanitize all file paths, use parameterized SQL queries, and validate all MCP inputs.
