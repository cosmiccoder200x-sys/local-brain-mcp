/**
 * version.ts — Single source of truth for the package version.
 *
 * Read from package.json at module load time. Avoids hardcoding the version
 * in multiple files and prevents version drift between cli.ts, mcp-server.ts,
 * and package.json.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function readVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION: string = readVersion();
