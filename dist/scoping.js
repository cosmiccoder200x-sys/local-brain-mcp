/**
 * scoping.ts — Monorepo directory-scoped query filtering & path sanitization.
 *
 * When a developer works in `packages/auth/`, we only surface memories
 * from that sub-package — preventing noise from unrelated modules.
 */
import path from 'path';
// ─── Path Sanitization ────────────────────────────────────────────────────────
/**
 * Sanitize a file path to prevent directory traversal and null byte injections.
 * Returns normalized repo-relative path (e.g. 'src/auth/jwt.ts') or null if invalid.
 */
export function sanitizeFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string')
        return null;
    // Strip null bytes and control characters
    const clean = filePath.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!clean)
        return null;
    // Normalize separators to POSIX
    const normalized = clean.replace(/\\/g, '/');
    // Prevent absolute paths escaping or root prefixes
    const withoutDrive = normalized.replace(/^[a-zA-Z]:\//, '');
    const segments = withoutDrive.split('/').filter(Boolean);
    const safeSegments = [];
    for (const seg of segments) {
        if (seg === '.' || seg === '')
            continue;
        if (seg === '..') {
            // Prevent traversing above root
            if (safeSegments.length > 0) {
                safeSegments.pop();
            }
            continue;
        }
        safeSegments.push(seg);
    }
    return safeSegments.length > 0 ? safeSegments.join('/') : null;
}
// ─── Package Scope Detection ──────────────────────────────────────────────────
const MONOREPO_ROOTS = ['packages', 'apps', 'libs', 'services', 'modules'];
/**
 * Derive the monorepo package scope from a file path.
 *
 * Examples:
 *   packages/auth/src/jwt.ts       → 'packages/auth'
 *   apps/dashboard/pages/index.tsx → 'apps/dashboard'
 *   src/utils/helpers.ts           → null  (no monorepo scope)
 */
export function derivePackageScope(filePath) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return null;
    const parts = sanitized.split('/');
    for (const root of MONOREPO_ROOTS) {
        const idx = parts.indexOf(root);
        if (idx !== -1 && parts.length > idx + 1) {
            return `${parts[idx]}/${parts[idx + 1]}`;
        }
    }
    return null;
}
/**
 * Build a parameterized SQLite filter for package scoped queries.
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
 * Normalize a raw file path to a repo-relative path, given the repo root.
 *
 * e.g.
 *   repoRoot: /home/user/projects/myapp
 *   filePath: /home/user/projects/myapp/packages/auth/jwt.ts
 *   → packages/auth/jwt.ts
 */
export function toRelativePath(filePath, repoRoot) {
    if (!filePath)
        return '';
    const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    return sanitizeFilePath(rel) ?? rel;
}
//# sourceMappingURL=scoping.js.map