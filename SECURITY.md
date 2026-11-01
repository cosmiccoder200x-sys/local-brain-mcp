# Security Policy

## Supported versions

Security fixes are made against the latest version on the `main` branch. Users should upgrade to the latest published release when a fix is available.

## Security design notes

Local Brain is designed as a local-first MCP server. Security-sensitive changes should preserve the project's privacy model and should be reviewed for filesystem boundaries, process execution, SQLite access, and handling of repository history.

Do not treat this document as a guarantee that every deployment or integration is risk-free. Review the implementation and your own environment before using the software with sensitive repositories.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected security vulnerability.

Use GitHub's private vulnerability reporting feature:

https://github.com/cosmiccoder200x-sys/local-brain-mcp/security/advisories/new

If private reporting is unavailable, contact the maintainer through the contact options on the GitHub profile:

https://github.com/cosmiccoder200x-sys

Include, where possible:

- A clear description of the vulnerability and its potential impact.
- The affected version, commit, or component.
- Reproduction steps or a proof of concept, if safe to share.
- Any suggested mitigation.

Do not include real credentials, private user data, or production secrets in a report. Please allow reasonable time for investigation and a fix before publicly disclosing the issue.

## Scope

Reports involving data exposure, path traversal, command execution, unsafe database handling, dependency vulnerabilities, or unexpected network access are especially relevant to this project.

The maintainer will coordinate investigation, remediation, and disclosure with the reporter.
