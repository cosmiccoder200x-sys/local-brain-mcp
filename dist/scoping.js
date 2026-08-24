/**
 * scoping.ts — Monorepo directory-scoped query filtering.
 *
 * When a developer works in `packages/auth/`, we only surface memories
 * from that sub-package — preventing noise from unrelated modules.
 */
import path from 'path';
// ─── Package Scope Detection ──────────────────────────────────────────────────
const MONOREPO_ROOTS = ['packages', 'apps', 'libs', 'services', 'modules'];
/**
 * Derive the monorepo package scope from a file path.
 *
 * Examples:
 *   packages/auth/src/jwt.ts     → 'packages/auth'
 *   apps/dashboard/pages/index.tsx → 'apps/dashboard'
 *   src/utils/helpers.ts         → null  (no monorepo scope)
 */
export function derivePackageScope(filePath) {
    if (!filePath)
        return null;
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    for (const root of MONOREPO_ROOTS) {
        const idx = parts.indexOf(root);
        if (idx !== -1 && parts.length > idx + 1) {
            return `${parts[idx]}/${parts[idx + 1]}`;
        }
    }
    return null;
}
/**
 * Build a SQLite LIKE pattern for scoped queries.
 *
 * Examples:
 *   scope: 'packages/auth'    → LIKE 'packages/auth/%' OR 'packages/auth'
 *   scope: null               → no filter (query all)
 */
export function buildScopeFilter(scope) {
    if (!scope)
        return { sql: '', params: [] };
    return {
        sql: `AND (package_scope = ? OR package_scope LIKE ? OR package_scope IS NULL)`,
        params: [scope, `${scope}/%`],
    };
}
/**
 * Detect the likely working package scope from the current working directory.
 * Used by the CLI and MCP server when no explicit file_path is provided.
 */
export function detectWorkingScope(cwd) {
    const workDir = cwd ?? process.cwd();
    return derivePackageScope(workDir);
}
/**
 * Normalise a raw file path to a repo-relative path, given the repo root.
 *
 * e.g.
 *   repoRoot: /home/user/projects/myapp
 *   filePath: /home/user/projects/myapp/packages/auth/jwt.ts
 *   → packages/auth/jwt.ts
 */
export function toRelativePath(filePath, repoRoot) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
//# sourceMappingURL=scoping.js.map