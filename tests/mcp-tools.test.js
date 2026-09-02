import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

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
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  child.on('error', error => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  child.on('exit', (code, signal) => {
    const error = new Error(`MCP server exited before responding (code=${code}, signal=${signal})`);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'local-brain-tests', version: '1.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
});

after(async () => {
  if (child && !child.killed) child.kill();
  await childExit;
  await rm(tempHome, { recursive: true, force: true });
});

test('registers exactly four tools with complete boolean annotations', async () => {
  const result = await request('tools/list');
  assert.deepEqual(result.tools.map(tool => tool.name), [
    'brain_recall',
    'brain_learn',
    'brain_trace',
    'brain_prune',
  ]);

  const expected = {
    brain_recall: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    brain_learn: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    brain_trace: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    brain_prune: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  };
  for (const tool of result.tools) {
    assert.deepEqual(tool.annotations, expected[tool.name]);
    assert.equal(Object.values(tool.annotations).every(value => typeof value === 'boolean'), true);
  }
});

test('brain_learn stores a lesson with category and file path', async () => {
  const result = await request('tools/call', {
    name: 'brain_learn',
    arguments: {
      lesson: 'Use parameterized SQL for every query.',
      category: 'convention',
      file_path: 'src/db.ts',
    },
  });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /Memory stored/);
  assert.match(textOf(result), /convention/);
  assert.match(textOf(result), /src\/db\.ts/);
});

test('brain_learn rejects a missing lesson', async () => {
  const result = await request('tools/call', {
    name: 'brain_learn',
    arguments: {},
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /lesson is required/);
});

test('brain_recall returns a valid query result', async () => {
  const result = await request('tools/call', {
    name: 'brain_recall',
    arguments: { query: 'parameterized SQL' },
  });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /Brain Recall|parameterized SQL/);
});

test('brain_recall rejects a missing or empty query', async () => {
  for (const query of [undefined, '  ']) {
    const result = await request('tools/call', {
      name: 'brain_recall',
      arguments: query === undefined ? {} : { query },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /query is required/);
  }
});

test('brain_trace returns file history and an empty result for unknown files', async () => {
  const result = await request('tools/call', {
    name: 'brain_trace',
    arguments: { file_path: 'src/db.ts' },
  });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /Trace: src\/db\.ts/);

  const empty = await request('tools/call', {
    name: 'brain_trace',
    arguments: { file_path: 'does-not-exist.ts' },
  });
  assert.equal(empty.isError, undefined);
  assert.match(textOf(empty), /No memories found/);
});

test('brain_trace rejects a missing file path', async () => {
  const result = await request('tools/call', {
    name: 'brain_trace',
    arguments: {},
  });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /file_path is required/);
});

test('brain_prune handles stale, deprecated, and all statuses', async () => {
  for (const [lesson, category] of [
    ['Stale lesson', 'fix'],
    ['Deprecated lesson', 'bug'],
  ]) {
    await request('tools/call', {
      name: 'brain_learn',
      arguments: { lesson, category },
    });
  }

  const { default: Database } = await import('better-sqlite3');
  const dbPath = path.join(tempHome, '.config', 'local-brain', 'brain.db');
  const database = new Database(dbPath);
  database.prepare("UPDATE memories SET status = 'stale' WHERE content = ?").run('Stale lesson');
  database.prepare("UPDATE memories SET status = 'deprecated' WHERE content = ?").run('Deprecated lesson');
  database.close();

  const stale = await request('tools/call', {
    name: 'brain_prune',
    arguments: { status: 'stale' },
  });
  assert.match(textOf(stale), /Removed 1 stale memories/);

  const deprecated = await request('tools/call', {
    name: 'brain_prune',
    arguments: { status: 'deprecated' },
  });
  assert.match(textOf(deprecated), /Removed 1 deprecated memories/);

  const all = await request('tools/call', {
    name: 'brain_prune',
    arguments: { status: 'all' },
  });
  assert.match(textOf(all), /Removed 0 non-active memories/);
});
