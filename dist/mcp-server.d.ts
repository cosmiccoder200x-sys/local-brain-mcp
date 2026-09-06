/**
 * mcp-server.ts — MCP Server exposing persistent AI memory tools via stdio transport.
 *
 * Tools:
 *  - brain_recall   : semantic memory search (multi-factor ranked, token-capped, scoped, multi-agent)
 *  - brain_status   : brain health, diagnostics, agent breakdown, validation stats
 *  - brain_learn    : store durable knowledge, rules, decisions with quality guard & contradiction check
 *  - brain_validate : validate & reinforce existing memory usefulness across agents
 *  - brain_trace    : full chronological memory & fix history for a file with agent provenance
 *  - brain_forget   : remove or deprecate specific memories by ID, path, or query
 *  - brain_prune    : clean up stale or deprecated memories after refactors
 *
 * Compatible with: Claude Code, Cursor, Antigravity, GitHub Copilot, Windsurf, Zed.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const MCP_TOOLS: Tool[];
export declare function createMcpServer(): Server;
//# sourceMappingURL=mcp-server.d.ts.map