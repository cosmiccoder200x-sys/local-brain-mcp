/**
 * version.ts — Single source of truth for the package version and engines.
 *
 * Read from package.json at module load time. Avoids hardcoding the version
 * in multiple files and prevents version drift between cli.ts, mcp-server.ts,
 * and package.json.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
function readPkg() {
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        return JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    }
    catch {
        return {};
    }
}
const pkg = readPkg();
export const VERSION = pkg.version ?? "0.0.0";
export const ENGINES_NODE = pkg.engines?.node ?? ">=22.0.0";
//# sourceMappingURL=version.js.map