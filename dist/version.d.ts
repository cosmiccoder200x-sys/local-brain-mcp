/**
 * version.ts — Single source of truth for the package version.
 *
 * Read from package.json at module load time. Avoids hardcoding the version
 * in multiple files and prevents version drift between cli.ts, mcp-server.ts,
 * and package.json.
 */
export declare const VERSION: string;
//# sourceMappingURL=version.d.ts.map