/**
 * version.ts — Single source of truth for the package version and engines.
 *
 * Read from package.json at module load time. Avoids hardcoding the version
 * in multiple files and prevents version drift between cli.ts, mcp-server.ts,
 * and package.json.
 */
export declare const VERSION: string;
export declare const ENGINES_NODE: string;
//# sourceMappingURL=version.d.ts.map