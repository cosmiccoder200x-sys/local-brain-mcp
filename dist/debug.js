/**
 * debug.ts — DEBUG-gated logging utility for Local Brain MCP.
 *
 * Usage:
 *   import { debugLog } from './debug.js';
 *   debugLog('db', 'Migration failed for column %s', columnName);
 *
 * Enabled by setting environment variable:
 *   DEBUG=local-brain:*
 *   DEBUG=local-brain:db
 *   DEBUG=local-brain:ingest
 */
const DEBUG_ENV = process.env.DEBUG ?? "";
const enabledNamespaces = new Set(DEBUG_ENV.split(",")
    .map((s) => s.trim())
    .filter(Boolean));
function isEnabled(namespace) {
    if (enabledNamespaces.has("*"))
        return true;
    if (enabledNamespaces.has(`local-brain:${namespace}`))
        return true;
    // Support wildcard suffix: local-brain:*
    for (const pattern of enabledNamespaces) {
        if (pattern.endsWith(":*") && namespace.startsWith(pattern.slice(0, -1))) {
            return true;
        }
    }
    return false;
}
/**
 * Log a debug message gated behind the DEBUG environment variable.
 * Messages are prefixed with `[local-brain:<namespace>]`.
 */
export function debugLog(namespace, message, ...args) {
    if (!isEnabled(namespace))
        return;
    const prefix = `[local-brain:${namespace}]`;
    if (args.length > 0) {
        console.error(prefix, message, ...args);
    }
    else {
        console.error(prefix, message);
    }
}
//# sourceMappingURL=debug.js.map