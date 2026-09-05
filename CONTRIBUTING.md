# Contributing to local-brain-mcp

Thank you for your interest in contributing to `local-brain-mcp`! We welcome bug fixes, documentation improvements, and architectural enhancements that adhere to our local-first, privacy-focused principles.

---

## Development Workflow

### 1. Prerequisites
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`
- **Git**: `>= 2.30.0`

### 2. Setup
```bash
git clone https://github.com/cosmiccoder200x-sys/local-brain-mcp.git
cd local-brain-mcp
npm install
```

### 3. Build & Type Check
```bash
npm run build
npm run typecheck
```

### 4. Running Tests
```bash
npm test
```

### 5. Running Benchmarks & Evaluation
```bash
npm run benchmark
npm run eval
```

---

## Core Guidelines

1. **Local-First Always**: Never introduce dependencies that make external network calls, transmit telemetry, or require cloud API keys.
2. **Deterministic & Fast**: Embeddings and ranking algorithms must remain deterministic and operate with sub-millisecond execution.
3. **Strict TypeScript**: Keep strict TypeScript typing enabled without `any` or `@ts-ignore`.
4. **Test Coverage**: Every new tool, parameter, or bug fix must include tests in `tests/`.
5. **Security Defenses**: Sanitize all file paths, use parameterized SQL queries, and validate all MCP inputs.

---

## Pull Request Process

1. Create a feature branch (`git checkout -b feat/my-improvement`).
2. Implement your changes with accompanying tests.
3. Verify that `npm run typecheck`, `npm test`, `npm run benchmark`, and `npm run eval` all pass.
4. Open a Pull Request describing the motivation and test results.
