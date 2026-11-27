// Run with: npm test   (node's built-in runner, no extra dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { debugEnabled } from '../debug.js';
import { securityHeaders, CSP } from '../middleware/securityHeaders.js';
import { loadSettings, saveSettings, isLocalHost } from '../src/settingsStorage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};

test('M6: debug logs are off unless DEBUG enables them', () => {
  assert.equal(debugEnabled({}), false);
  assert.equal(debugEnabled({ DEBUG: 'express:*' }), false);
  assert.equal(debugEnabled({ DEBUG: 'qafg:*' }), true);
  assert.equal(debugEnabled({ DEBUG: 'a, qafg' }), true);
  assert.equal(debugEnabled({ DEBUG: '*' }), true);
});

test('M1: security headers are set and X-Powered-By removed', () => {
  const headers = {};
  const removed = [];
  let nexted = false;
  securityHeaders()({}, { setHeader: (k, v) => (headers[k] = v), removeHeader: (k) => removed.push(k) }, () => (nexted = true));
  assert.ok(nexted);
  assert.equal(headers['Content-Security-Policy'], CSP);
  assert.match(CSP, /default-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.match(CSP, /object-src 'none'/);
  assert.doesNotMatch(CSP, /script-src[^;]*unsafe/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.ok(removed.includes('X-Powered-By'));
});

test('H3: the API key goes to sessionStorage only, never localStorage', () => {
  const local = memStore(); const session = memStore();
  saveSettings({ provider: 'openai', apiKey: 'sk-secret', useSkills: true }, local, session);
  assert.ok(!local.getItem('qafg.settings').includes('sk-secret'));
  assert.ok(session.getItem('qafg.settings').includes('sk-secret'));
  assert.deepEqual(loadSettings(local, session), { provider: 'openai', apiKey: 'sk-secret', useSkills: true });
  // An empty key clears the session copy.
  saveSettings({ provider: 'claude-local', apiKey: '' }, local, session);
  assert.equal(session.getItem('qafg.settings'), null);
});

test('H3: a key left in localStorage by an older version is migrated out', () => {
  const local = memStore({ 'qafg.settings': JSON.stringify({ provider: 'openai', apiKey: 'sk-old' }) });
  const session = memStore();
  const s = loadSettings(local, session);
  assert.equal(s.apiKey, 'sk-old');
  assert.ok(!local.getItem('qafg.settings').includes('sk-old'));
  assert.ok(session.getItem('qafg.settings').includes('sk-old'));
});

test('H3: broken or blocked storage falls back to defaults', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadSettings(broken, broken), { provider: 'claude-local', apiKey: '' });
  assert.doesNotThrow(() => saveSettings({ provider: 'openai', apiKey: 'k' }, broken, broken));
});

test('H3: localhost detection', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]']) assert.equal(isLocalHost(h), true);
  for (const h of ['example.com', 'localhost.evil.com', '192.168.1.5']) assert.equal(isLocalHost(h), false);
});

test('L6: the frontend never renders content as HTML or evaluates it', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|tsx?)$/.test(f) && files.push(p); } };
  walk(join(ROOT, 'src'));
  assert.ok(files.length > 0);
  const banned = [/dangerouslySetInnerHTML/, /\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of banned) assert.doesNotMatch(src, re, `${f} matches ${re}`);
  }
});

test('L4: provider detection spawns the CLI once within 30 s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-l4-'));
  const counter = join(dir, 'count');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\necho x >> "${counter}"\necho 1.0.0\n`);
  chmodSync(bin, 0o755);
  const prev = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = bin;
  try {
    const { detectProviders, clearProviderCache } = await import('../providers.js');
    clearProviderCache();
    const [a, b] = await Promise.all([detectProviders(), detectProviders()]); // concurrent calls share one probe
    await detectProviders();
    assert.equal(a['claude-local'].available, true);
    assert.equal(b['claude-local'].available, true);
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
    clearProviderCache();
    await detectProviders();
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 2);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5: no route answers with a raw error message', () => {
  const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
  assert.doesNotMatch(src, /json\(\{\s*error:\s*(error|err|e)\.message\s*\}\)/);
});
