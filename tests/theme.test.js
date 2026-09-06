import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setColorEnabled,
  isColorSupported,
  brand,
  success,
  warning,
  error,
  muted,
  highlight,
  heading,
  label,
  keyVal,
  statusDot,
  badge,
  compactMark,
  brainAsciiArt,
  card,
  headerBanner,
  stripAnsi,
  centerText,
} from '../dist/theme.js';

describe('Theme & Terminal Styling Tests', () => {
  beforeEach(() => {
    setColorEnabled(false);
  });

  afterEach(() => {
    setColorEnabled(false);
  });

  test('Brain + Terminal ASCII logo art has neural left and terminal right', () => {
    const art = brainAsciiArt();
    assert.ok(Array.isArray(art));
    assert.ok(art.length >= 4);

    // Verify neural connections on left and terminal >_ on right
    const fullArt = art.join('\n');
    assert.ok(fullArt.includes('>_'), 'Artwork must contain terminal >_ element');
    assert.ok(fullArt.includes('●') || fullArt.includes('╷'), 'Artwork must contain neural brain elements');
  });

  test('Strict monochrome output contains zero ANSI escape sequences when color is disabled', () => {
    setColorEnabled(false);
    assert.strictEqual(isColorSupported(), false);

    const outputs = [
      brand('Local Brain MCP'),
      success('✓ Success'),
      warning('▲ Warning'),
      error('✖ Error'),
      muted('Muted text'),
      highlight('Important value'),
      heading('HEADING'),
      label('PROJECT'),
      keyVal('MEMORY STORE', '.local-brain/memory.db'),
      statusDot('active'),
      statusDot('stale'),
      statusDot('deprecated'),
      statusDot('idle'),
      badge('TEST', 'brand'),
      compactMark(),
      headerBanner(),
    ];

    for (const out of outputs) {
      assert.ok(!out.includes('\x1b['), `Expected zero ANSI escape codes in output, got: ${JSON.stringify(out)}`);
    }
  });

  test('Color enabled produces ANSI escape sequences and gradient', () => {
    setColorEnabled(true);
    assert.strictEqual(isColorSupported(), true);

    const branded = brand('Local Brain');
    assert.ok(branded.includes('\x1b['), 'Branded text must contain ANSI escape codes when color enabled');

    const succ = success('✓ Success');
    assert.ok(succ.includes('\x1b[32m'), 'Success must use green ANSI code');

    const err = error('✖ Error');
    assert.ok(err.includes('\x1b[31m'), 'Error must use red ANSI code');

    const mark = compactMark();
    assert.ok(mark.includes('\x1b['), 'Compact mark must be styled');
  });

  test('stripAnsi correctly removes ANSI codes and preserves string content', () => {
    setColorEnabled(true);
    const colored = brand('Local Brain MCP');
    const plain = stripAnsi(colored);
    assert.strictEqual(plain, 'Local Brain MCP');
    assert.ok(!plain.includes('\x1b['));
  });

  test('centerText centers text within given width', () => {
    const centered = centerText('Title', 20);
    assert.strictEqual(centered.length, 20);
    assert.strictEqual(centered.trim(), 'Title');
    assert.ok(centered.startsWith('       '));
  });

  test('card creates properly formatted box with rounded borders', () => {
    setColorEnabled(false);
    const result = card(['Line 1', 'Line 2'], 30);
    const lines = result.split('\n');

    assert.ok(lines[0].startsWith('╭') && lines[0].endsWith('╮'));
    assert.ok(lines[lines.length - 1].startsWith('╰') && lines[lines.length - 1].endsWith('╯'));
    assert.ok(lines.some(l => l.includes('Line 1')));
    assert.ok(lines.some(l => l.includes('Line 2')));
  });

  test('headerBanner generates full hero banner card', () => {
    setColorEnabled(false);
    const banner = headerBanner();
    assert.ok(banner.includes('Local Brain MCP'));
    assert.ok(banner.includes('Shared Memory for AI Coding Agents'));
    assert.ok(banner.includes('>_'));
  });
});
