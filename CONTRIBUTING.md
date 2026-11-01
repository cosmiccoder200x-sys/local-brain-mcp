# Contributing to Local Brain MCP

Thank you for helping improve Local Brain MCP! Contributions of all sizes are welcome: bug fixes, tests, documentation, examples, integrations, and performance improvements.

Local Brain is **local-first and privacy-focused**. Contributions should preserve those principles.

## Before you start

- Read the [README](README.md) to understand the project and its commands.
- Check [open issues](https://github.com/cosmiccoder200x-sys/local-brain-mcp/issues) and existing pull requests before starting work.
- For a large change, open an issue first so we can agree on the problem and approach.
- If you want to work on an issue, leave a comment so other contributors know it is being handled.

Good first contributions include improving examples, adding focused tests, clarifying error messages, and fixing documentation gaps.

## Development setup

### Requirements

- Node.js **22 or newer**
- npm **9 or newer**
- Git **2.30 or newer**

### Fork and clone

1. Fork this repository on GitHub.
2. Clone your fork and enter the project:

```bash
git clone https://github.com/<your-github-username>/local-brain-mcp.git
cd local-brain-mcp
npm install
```

3. Add the upstream repository:

```bash
git remote add upstream https://github.com/cosmiccoder200x-sys/local-brain-mcp.git
```

4. Create a focused branch from the latest main:

```bash
git fetch upstream
git switch -c feat/short-description upstream/main
```

Use `fix/`, `docs/`, `test/`, or `chore/` instead of `feat/` when that better describes the change.

## Make and verify your change

Run the checks relevant to your change before opening a pull request:

```bash
npm run typecheck
npm run build
npm test
npm run lint
```

For changes that affect retrieval quality or performance, also consider:

```bash
npm run eval
npm run benchmark
```

Do not claim a check passed unless you ran it and it completed successfully. If a check cannot be run, say why in your pull request.

### Tests

- Add regression tests for bug fixes.
- Add unit or integration tests for new behavior.
- Cover invalid input and failure paths, not only the happy path.
- Keep tests deterministic and independent of external services.

## Project conventions

- **TypeScript and ESM:** follow the existing strict TypeScript and ES module patterns.
- **Privacy:** do not add telemetry, unexpected network requests, cloud dependencies, or source-code uploads.
- **Database safety:** use parameterized SQL and preserve existing data unless a migration explicitly requires otherwise.
- **Input validation:** validate MCP inputs and sanitize user-controlled paths with the existing path utilities.
- **Dependencies:** avoid adding dependencies when the platform or existing packages already solve the problem. Explain any new dependency in the PR.
- **Compatibility:** consider supported Node.js versions and Windows, macOS, and Linux behavior.
- **Scope:** keep each pull request focused on one logical change.

## Pull request checklist

Before submitting:

- [ ] The change solves a clearly described problem.
- [ ] Tests were added or updated where appropriate.
- [ ] Relevant checks were run and their actual results are included.
- [ ] Documentation and examples are updated if behavior changed.
- [ ] No secrets, credentials, personal data, or generated database files are included.
- [ ] The PR is focused and linked to an issue when one exists.

In the PR description, explain:

1. **Problem:** what is currently difficult or broken?
2. **Solution:** what did you change and why?
3. **Verification:** which commands did you run, and what happened?
4. **Compatibility/security:** are there migration, platform, privacy, or security implications?

Open your pull request against `main`. A maintainer will review it and may request changes before it is merged.

## Reporting security vulnerabilities

Please **do not** report exploitable vulnerabilities in public issues. Follow the private reporting instructions in [SECURITY.md](SECURITY.md).

## Community expectations

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Thank you for contributing to Local Brain MCP!
