import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { VERSION } from '../dist/version.js';

const serverPath = path.resolve('dist/mcp-server.js');
let tempHome;
let child;
let childExit;
let nextId = 1;
const pending = new Map();

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function textOf(result) {
  return result?.content?.find(item => item.type === 'text')?.text ?? '';
}

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'local-brain-mcp-test-'));
  child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  childExit = new Promise(resolve => child.once('exit', resolve));

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    } catch {
      // Ignore non-json log output
    }
  });

  child.on('error', error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  child.on('exit', (code, signal) => {
    const error = new Error(`MCP server exited unexpectedly (code=${code}, signal=${signal})`);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'local-brain-test-client', version: '1.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
});

after(async () => {
  if (child && !child.killed) child.kill();
  await childExit;
  await rm(tempHome, { recursive: true, force: true });
});

test('registers all MCP tools with complete boolean annotations', async () => {
  const result = await request('tools/list');
  const toolNames = result.tools.map(tool => tool.name);
  assert.deepEqual(toolNames, [
    'brain_recall',
    'brain_status',
    'brain_learn',
    'brain_validate',
    'brain_trace',
    'brain_forget',
    'brain_prune',
  ]);

  const expectedAnnotations = {
    brain_recall:   { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    brain_status:   { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    brain_learn:    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    brain_validate: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    brain_trace:    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    brain_forget:   { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    brain_prune:    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  };

  for (const tool of result.tools) {
    assert.deepEqual(tool.annotations, expectedAnnotations[tool.name]);
    assert.equal(Object.values(tool.annotations).every(value => typeof value === 'boolean'), true);
  }
});

test('brain_status returns operational telemetry without leaking secrets', async () => {
  const result = await request('tools/call', {
    name: 'brain_status',
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  const text = textOf(result);
  assert.match(text, /Local Brain.*Status/);
  assert.ok(text.includes(`Server Version: v${VERSION}`));
  assert.match(text, /Total Memories:/);
  assert.match(text, /Embedding Engine:/);
  assert.match(text, /Ranking:/);
});

test('brain_learn stores a lesson and prevents exact duplicate creation', async () => {
  const result1 = await request('tools/call', {
    name: 'brain_learn',
    arguments: {
      lesson: 'Always use parameterized SQL queries with better-sqlite3.',
      category: 'convention',
      file_path: 'src/db.ts',
      importance: 1.5,
    },
  });
  assert.equal(result1.isError, undefined);
  assert.match(textOf(result1), /Memory stored/);
  assert.match(textOf(result1), /convention/);
  assert.match(textOf(result1), /src\/db\.ts/);

  // Attempt duplicate store
  const result2 = await request('tools/call', {
    name: 'brain_learn',
    arguments: {
      lesson: 'Always use parameterized SQL queries with better-sqlite3.',
      category: 'convention',
      file_path: 'src/db.ts',
    },
  });
  assert.equal(result2.isError, undefined);
  assert.match(textOf(result2), /Exact matching memory already exists/);
});

test('brain_learn rejects missing or oversized lesson', async () => {
  const empty = await request('tools/call', {
    name: 'brain_learn',
    arguments: { lesson: '   ' },
  });
  assert.equal(empty.isError, true);
  assert.match(textOf(empty), /lesson is required/);

  const huge = await request('tools/call', {
    name: 'brain_learn',
    arguments: { lesson: 'A'.repeat(10001) },
  });
  assert.equal(huge.isError, true);
  assert.match(textOf(huge), /exceeds maximum length/);
});

test('brain_recall returns ranked query results', async () => {
  const result = await request('tools/call', {
    name: 'brain_recall',
    arguments: {
      query: 'parameterized queries sqlite',
      max_items: 5,
    },
  });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /Brain Recall/);
  assert.match(textOf(result), /parameterized SQL queries/);
});

test('brain_recall input validation (NaN, Infinity, negative, excessive length, invalid category)', async () => {
  // Empty query
  const empty = await request('tools/call', {
    name: 'brain_recall',
    arguments: { query: '  ' },
  });
  assert.equal(empty.isError, true);
  assert.match(textOf(empty), /query is required/);

  // Negative max_items
  const negativeItems = await request('tools/call', {
    name: 'brain_recall',
    arguments: { query: 'test', max_items: -5 },
  });
  assert.equal(negativeItems.isError, true);
  assert.match(textOf(negativeItems), /max_items must be a valid integer/);

  // Invalid category
  const badCategory = await request('tools/call', {
    name: 'brain_recall',
    arguments: { query: 'test', category: 'invalid_cat' },
  });
  assert.equal(badCategory.isError, true);
  assert.match(textOf(badCategory), /Invalid category/);
});

test('brain_trace returns history and sanitized empty trace', async () => {
  const trace = await request('tools/call', {
    name: 'brain_trace',
    arguments: { file_path: 'src/db.ts' },
  });
  assert.equal(trace.isError, undefined);
  assert.match(textOf(trace), /Trace: src\/db\.ts/);

  const missing = await request('tools/call', {
    name: 'brain_trace',
    arguments: { file_path: 'nonexistent/file.ts' },
  });
  assert.equal(missing.isError, undefined);
  assert.match(textOf(missing), /No memories found/);
});

test('brain_forget deletes memory by ID', async () => {
  // Store a temporary memory
  const storeRes = await request('tools/call', {
    name: 'brain_learn',
    arguments: { lesson: 'Temporary ephemeral note to forget' },
  });
  const match = textOf(storeRes).match(/id:\s*(\d+)/);
  assert.ok(match, 'should contain memory id');
  const memoryId = parseInt(match[1], 10);

  // Forget it
  const forgetRes = await request('tools/call', {
    name: 'brain_forget',
    arguments: { memory_id: memoryId },
  });
  assert.equal(forgetRes.isError, undefined);
  assert.match(textOf(forgetRes), /permanently deleted/);

  // Attempting to forget again returns not found
  const forgetAgain = await request('tools/call', {
    name: 'brain_forget',
    arguments: { memory_id: memoryId },
  });
  assert.equal(forgetAgain.isError, true);
  assert.match(textOf(forgetAgain), /was not found/);
});

test('brain_prune cleans up stale memories safely', async () => {
  const prune = await request('tools/call', {
    name: 'brain_prune',
    arguments: { status: 'stale', run_invalidation: false },
  });
  assert.equal(prune.isError, undefined);
  assert.match(textOf(prune), /Brain pruned/);
});
