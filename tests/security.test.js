// Run with: npm test   (node's built-in runner, no extra dependencies)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { debugEnabled } from '../debug.js';
import { securityHeaders, CSP } from '../middleware/securityHeaders.js';
import { loadSettings, saveSettings, isLocalHost, safeStorage } from '../src/settingsStorage.js';

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

test('H3: reading a denied storage object (a throwing getter) does not crash', () => {
  const denied = { get localStorage() { throw new DOMException('denied', 'SecurityError'); }, get sessionStorage() { throw new Error('denied'); } };
  assert.equal(safeStorage(denied, 'localStorage'), null);
  assert.equal(safeStorage(denied, 'sessionStorage'), null);
  assert.equal(safeStorage({}, 'localStorage'), null);
  const ok = { localStorage: memStore() };
  assert.equal(safeStorage(ok, 'localStorage'), ok.localStorage);
  // With both stores denied, settings still load (defaults) and saving does not throw.
  const l = safeStorage(denied, 'localStorage'); const se = safeStorage(denied, 'sessionStorage');
  assert.deepEqual(loadSettings(l, se), { provider: 'claude-local', apiKey: '' });
  assert.doesNotThrow(() => saveSettings({ provider: 'openai', apiKey: 'k' }, l, se));
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

test('L4: the provider probe is cached for 30 s and shared while pending', async () => {
  const { detectProviders, clearProviderCache } = await import('../providers.js');
  let calls = 0;
  const probe = async () => { calls++; return true; };
  clearProviderCache();
  const [a, b] = await Promise.all([detectProviders({ probe }), detectProviders({ probe })]); // concurrent: one probe
  await detectProviders({ probe });
  assert.equal(a['claude-local'].available, true);
  assert.equal(b['claude-local'].available, true);
  assert.equal(calls, 1);
  clearProviderCache();
  await detectProviders({ probe });
  assert.equal(calls, 2);
});

test('L4: a slow probe is never replaced while pending, and the 30 s starts when it finishes', async () => {
  const { detectProviders, clearProviderCache } = await import('../providers.js');
  let now = 1_000_000;
  const clock = mock.method(Date, 'now', () => now);
  try {
    clearProviderCache();
    let calls = 0;
    let finish;
    const probe = () => { calls++; return new Promise((r) => { finish = r; }); };
    const first = detectProviders({ probe });
    now += 45_000; // longer than the TTL, still pending
    const second = detectProviders({ probe });
    assert.equal(calls, 1, 'no second probe while the first is pending');
    finish(true);
    assert.equal((await first)['claude-local'].available, true);
    assert.equal((await second)['claude-local'].available, true);
    now += 29_000; // 29 s after it FINISHED, so still cached (it started 74 s ago)
    await detectProviders({ probe });
    assert.equal(calls, 1);
    now += 2_000; // past 30 s since it finished
    const third = detectProviders({ probe });
    assert.equal(calls, 2);
    finish(false);
    assert.equal((await third)['claude-local'].available, false);
  } finally { clock.mock.restore(); clearProviderCache(); }
});

test('L4: a failing probe reports unavailable and does not poison later calls', async () => {
  const { detectProviders, clearProviderCache } = await import('../providers.js');
  clearProviderCache();
  assert.equal((await detectProviders({ probe: async () => { throw new Error('boom'); } }))['claude-local'].available, false);
  clearProviderCache();
  assert.equal((await detectProviders({ probe: async () => true }))['claude-local'].available, true);
});

// The real probe against a CLI that hangs: bounded, and nothing is left running. POSIX shell fixture.
test('L4: a hung CLI is killed and reported unavailable', { skip: process.platform === 'win32' && 'POSIX shell fixture' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-l4-'));
  const pidFile = join(dir, 'pid');
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh\necho $$ > "${pidFile}"\nsleep 30\n`);
  chmodSync(bin, 0o755);
  const prev = { bin: process.env.CLAUDE_BIN, t: process.env.QAFG_PROBE_TIMEOUT_MS };
  process.env.CLAUDE_BIN = bin;
  process.env.QAFG_PROBE_TIMEOUT_MS = '300';
  try {
    const { detectProviders, clearProviderCache } = await import('../providers.js');
    clearProviderCache();
    const started = Date.now();
    const result = await detectProviders();
    assert.equal(result['claude-local'].available, false);
    assert.ok(Date.now() - started < 5000);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), 'the hung CLI is gone');
    clearProviderCache();
  } finally {
    for (const [k, v] of [['CLAUDE_BIN', prev.bin], ['QAFG_PROBE_TIMEOUT_MS', prev.t]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5: no route answers with a raw error message', () => {
  const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
  assert.doesNotMatch(src, /json\(\{\s*error:\s*(error|err|e)\.message\s*\}\)/);
});
