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
/**
 * Log a debug message gated behind the DEBUG environment variable.
 * Messages are prefixed with `[local-brain:<namespace>]`.
 */
export declare function debugLog(namespace: string, message: string, ...args: unknown[]): void;
//# sourceMappingURL=debug.d.ts.map