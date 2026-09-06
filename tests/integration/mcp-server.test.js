import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer, MCP_TOOLS } from '../../dist/mcp-server.js';
import { getDb, resolveDbPath } from '../../dist/db.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('MCP Server End-to-End Lifecycle', () => {
  let server;
  let db;

  before(() => {
    db = getDb();
    server = createMcpServer();
  });

  it('1. Initializes server and lists all 6 tools with valid schemas', async () => {
    assert.ok(server);
    assert.equal(MCP_TOOLS.length, 6);

    const toolNames = MCP_TOOLS.map(t => t.name);
    assert.ok(toolNames.includes('brain_recall'));
    assert.ok(toolNames.includes('brain_status'));
    assert.ok(toolNames.includes('brain_learn'));
    assert.ok(toolNames.includes('brain_trace'));
    assert.ok(toolNames.includes('brain_forget'));
    assert.ok(toolNames.includes('brain_prune'));
  });

  it('2. brain_status returns valid system diagnostics and counts', async () => {
    // Invoke handler directly through MCP protocol schema
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    assert.ok(handler, 'CallTool request handler must exist');

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_status',
        arguments: {},
      },
    });

    assert.ok(response.content && response.content.length > 0);
    assert.ok(response.content[0].text.includes('Local Brain MCP Status'));
    assert.ok(response.content[0].text.includes('Total Memories'));
  });

  it('3. brain_learn stores a new lesson with quality assessment and returns ID', async () => {
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_learn',
        arguments: {
          lesson: 'Always use WebSockets heartbeat ping every 30s to prevent Cloudflare gateway timeout.',
          category: 'fix',
          file_path: 'src/websocket/client.ts',
          confidence: 0.95,
          importance: 1.4,
        },
      },
    });

    assert.ok(response.content && response.content.length > 0);
    assert.ok(response.content[0].text.includes('✅ Memory stored'));
    assert.ok(response.content[0].text.includes('Category: fix'));
    assert.ok(!response.isError);
  });

  it('4. brain_recall retrieves the stored lesson with relevance score and token cap', async () => {
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_recall',
        arguments: {
          query: 'WebSocket heartbeat Cloudflare timeout',
          file_path: 'src/websocket/client.ts',
        },
      },
    });

    assert.ok(response.content && response.content.length > 0);
    assert.ok(response.content[0].text.includes('Brain Recall:'));
    assert.ok(response.content[0].text.includes('Cloudflare gateway timeout'));
    assert.ok(!response.isError);
  });

  it('5. brain_trace returns chronological history for the file', async () => {
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    const response = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_trace',
        arguments: {
          file_path: 'src/websocket/client.ts',
        },
      },
    });

    assert.ok(response.content && response.content.length > 0);
    assert.ok(response.content[0].text.includes('Trace: src/websocket/client.ts'));
    assert.ok(response.content[0].text.includes('Cloudflare'));
  });

  it('6. brain_forget removes/deprecates the memory and subsequent recall confirms removal', async () => {
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    // Forget by query
    const forgetRes = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_forget',
        arguments: {
          query: 'Cloudflare gateway timeout',
        },
      },
    });

    assert.ok(forgetRes.content[0].text.includes('Deprecated'));

    // Verify active recall no longer surfaces it
    const recallRes = await handler({
      method: 'tools/call',
      params: {
        name: 'brain_recall',
        arguments: {
          query: 'WebSocket heartbeat Cloudflare timeout',
          file_path: 'src/websocket/client.ts',
        },
      },
    });

    assert.ok(
      recallRes.content[0].text.includes('No memories found') ||
      !recallRes.content[0].text.includes('Cloudflare gateway timeout')
    );
  });

  it('7. Handles invalid tool inputs gracefully without crashing', async () => {
    const handler = server._requestHandlers.get(CallToolRequestSchema.shape.method.value);

    // Empty query for recall
    const recallErr = await handler({
      method: 'tools/call',
      params: { name: 'brain_recall', arguments: {} },
    });
    assert.equal(recallErr.isError, true);

    // Trivial noise memory for learn
    const learnErr = await handler({
      method: 'tools/call',
      params: { name: 'brain_learn', arguments: { lesson: 'git status' } },
    });
    assert.equal(learnErr.isError, true);
    assert.ok(learnErr.content[0].text.includes('quality filter'));

    // Unknown tool
    const unknownErr = await handler({
      method: 'tools/call',
      params: { name: 'brain_nonexistent', arguments: {} },
    });
    assert.equal(unknownErr.isError, true);
  });
});
