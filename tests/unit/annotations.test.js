import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_TOOLS } from '../../dist/mcp-server.js';

describe('MCP Tool Annotations', () => {
  it('should register all required MCP tools (7 tools in v1.3.1)', () => {
    const toolNames = MCP_TOOLS.map(t => t.name).sort();
    assert.deepEqual(toolNames, [
      'brain_forget',
      'brain_learn',
      'brain_prune',
      'brain_recall',
      'brain_status',
      'brain_trace',
      'brain_validate',
    ]);
  });

  it('brain_recall annotations: readOnly, non-destructive, idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_recall');
    assert.ok(tool, 'brain_recall tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('brain_status annotations: readOnly, non-destructive, idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_status');
    assert.ok(tool, 'brain_status tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('brain_trace annotations: readOnly, non-destructive, idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_trace');
    assert.ok(tool, 'brain_trace tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('brain_learn annotations: mutates, non-destructive, non-idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_learn');
    assert.ok(tool, 'brain_learn tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('brain_validate annotations: mutates, non-destructive, non-idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_validate');
    assert.ok(tool, 'brain_validate tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('brain_prune annotations: mutates/deletes, destructive, non-idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_prune');
    assert.ok(tool, 'brain_prune tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('brain_forget annotations: deletes, destructive, idempotent', () => {
    const tool = MCP_TOOLS.find(t => t.name === 'brain_forget');
    assert.ok(tool, 'brain_forget tool must exist');
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('all tools have valid input schemas and non-empty descriptions', () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(tool.description && tool.description.length > 20, `${tool.name} must have a descriptive summary`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema must be an object`);
    }
  });
});
