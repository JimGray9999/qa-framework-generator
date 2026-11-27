import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sandboxMode, sandboxLimits, dockerRunArgs, runPhase, checkSandboxReady, SANDBOX_IMAGE, validateRequirements, findLocalTarget, readBoundedJson, capReport, workspaceUsage } from '../sandbox.js';
import { runWithDeadline, registerCleanup } from '../processScope.js';

const limits = { memory: '2g', cpus: '2', testNetwork: 'bridge', diskBytes: 3 * 1024 ** 3, maxEntries: 300000 };
const base = { name: 'qafg-abc123', workDir: '/tmp/qa-framework-xyz', network: 'bridge', limits, command: ['echo', 'hi'] };
const optValue = (args, flag) => args[args.indexOf(flag) + 1];

test('C3: sandbox mode is off by default and a typo is an error, not "off"', () => {
  assert.equal(sandboxMode({}), 'off');
  assert.equal(sandboxMode({ QAFG_SANDBOX: 'off' }), 'off');
  assert.equal(sandboxMode({ QAFG_SANDBOX: ' Docker ' }), 'docker');
  for (const bad of ['dokcer', 'true', '1', 'none']) assert.throws(() => sandboxMode({ QAFG_SANDBOX: bad }), /must be "docker" or "off"/);
});

test('C3: resource and network settings are validated', () => {
  assert.deepEqual(sandboxLimits({}), { memory: '2g', cpus: '2', testNetwork: 'bridge', diskBytes: 3072 * 1024 * 1024, maxEntries: 300000 });
  assert.equal(sandboxLimits({ QAFG_SANDBOX_DISK_MB: '500' }).diskBytes, 500 * 1024 * 1024);
  assert.equal(sandboxLimits({ QAFG_SANDBOX_TEST_NETWORK: 'none' }).testNetwork, 'none');
  for (const env of [{ QAFG_SANDBOX_MEMORY: '2g --privileged' }, { QAFG_SANDBOX_MEMORY: '0g' }, { QAFG_SANDBOX_CPUS: '2; rm' }, { QAFG_SANDBOX_CPUS: '0' }, { QAFG_SANDBOX_TEST_NETWORK: 'host' }, { QAFG_SANDBOX_DISK_MB: '5' }, { QAFG_SANDBOX_DISK_MB: '1e9' }]) {
    assert.throws(() => sandboxLimits(env), /QAFG_SANDBOX_/);
  }
});

test('C3: the container is locked down', () => {
  const args = dockerRunArgs({ ...base, uid: 1000, gid: 1000 });
  assert.equal(args[0], 'run');
  for (const f of ['--rm', '--init', '--read-only']) assert.ok(args.includes(f), f);
  assert.equal(optValue(args, '--cap-drop'), 'ALL');
  assert.equal(optValue(args, '--security-opt'), 'no-new-privileges');
  assert.equal(optValue(args, '--pids-limit'), '512');
  assert.equal(optValue(args, '--memory'), '2g');
  assert.equal(optValue(args, '--memory-swap'), '2g');
  assert.equal(optValue(args, '--cpus'), '2');
  assert.equal(optValue(args, '--user'), '1000:1000');
  assert.equal(optValue(args, '--network'), 'bridge');
  assert.equal(args[args.length - 3], SANDBOX_IMAGE);
  // Nothing that widens access.
  for (const bad of ['--privileged', '--cap-add', '--pid', '--ipc', '--userns', '--device', '-v', '--volume']) assert.ok(!args.includes(bad), bad);
  assert.ok(!args.some((a) => /^--network=host|docker\.sock/.test(a)));
  // Exactly one mount: the run's work directory.
  assert.equal(args.filter((a) => a === '--mount').length, 1);
  assert.equal(optValue(args, '--mount'), 'type=bind,source=/tmp/qa-framework-xyz,target=/work');
});

test('C3: only the listed environment reaches the container (no server secrets)', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
  try {
    const args = dockerRunArgs({ ...base, env: { HOME: '/work/.home', BROWSER: 'chromium' } });
    const envs = args.filter((a, i) => args[i - 1] === '--env');
    assert.deepEqual(envs, ['HOME=/work/.home', 'BROWSER=chromium']);
    assert.ok(!args.join(' ').includes('sk-ant-secret'));
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test('C3: the test network can be switched off', () => {
  assert.equal(optValue(dockerRunArgs({ ...base, network: 'none' }), '--network'), 'none');
});

test('C3: argument injection is refused', () => {
  assert.throws(() => dockerRunArgs({ ...base, workDir: '/tmp/a,readonly=false,source=/' }), /work directory/);
  assert.throws(() => dockerRunArgs({ ...base, workDir: '/tmp/a\nb' }), /work directory/);
  assert.throws(() => dockerRunArgs({ ...base, name: 'x --privileged' }), /container name/);
  assert.throws(() => dockerRunArgs({ ...base, network: 'host' }), /network/);
  assert.throws(() => dockerRunArgs({ ...base, env: { 'A=B': '1' } }), /environment variable name/);
});

// A fake `docker` on PATH records its calls, so runPhase can be exercised without a daemon.
function fakeDocker({ runExit = 0, inspectExit = 0, runScript = ':' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-fakedocker-'));
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  run) ${runScript}; echo "phase output"; exit ${runExit} ;;
  rm) exit 0 ;;
  image) exit ${inspectExit} ;;
esac
`);
  chmodSync(join(dir, 'docker'), 0o755);
  return { dir, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
}
async function withPath(dir, fn, { system = true } = {}) {
  const prev = process.env.PATH;
  // The fake `docker` comes first; system dirs stay so `sh`, `sleep` and `echo` work in it.
  process.env.PATH = system ? `${dir}:/usr/bin:/bin` : dir;
  try { return await fn(); } finally { process.env.PATH = prev; }
}

test('C3: runPhase streams output, returns the exit code and always removes the container', async () => {
  for (const exit of [0, 3]) {
    const fd = fakeDocker({ runExit: exit });
    try {
      const out = [];
      const code = await withPath(fd.dir, () => runPhase({ workDir: '/tmp/x', limits, network: 'bridge', command: ['true'], onOutput: (t) => out.push(t) }));
      assert.equal(code, exit);
      assert.match(out.join(''), /phase output/);
      const calls = fd.calls();
      assert.match(calls[0], /^run --rm --init --name (qafg-[0-9a-f]{12}) /);
      const name = calls[0].match(/--name (\S+)/)[1];
      assert.ok(calls.includes(`rm -f ${name}`), 'container removed');
    } finally { rmSync(fd.dir, { recursive: true, force: true }); }
  }
});

test('C3: a phase that never finishes is stopped and its container removed', async () => {
  const fd = fakeDocker({ runScript: 'sleep 5' });
  try {
    await assert.rejects(
      withPath(fd.dir, () => runPhase({ workDir: '/tmp/x', limits, network: 'none', command: ['true'], timeoutMs: 300 })),
      (e) => e.code === 'SANDBOX' && /did not finish/.test(e.message),
    );
    assert.ok(fd.calls().some((c) => c.startsWith('rm -f qafg-')));
  } finally { rmSync(fd.dir, { recursive: true, force: true }); }
});

test('C3: readiness check explains a missing image and a missing Docker', async () => {
  const missingImage = fakeDocker({ inspectExit: 1 });
  try {
    await assert.rejects(withPath(missingImage.dir, checkSandboxReady), /sandbox:build/);
  } finally { rmSync(missingImage.dir, { recursive: true, force: true }); }
  const ok = fakeDocker();
  try {
    await withPath(ok.dir, checkSandboxReady);
    assert.deepEqual(ok.calls(), [`image inspect ${SANDBOX_IMAGE}`]);
  } finally { rmSync(ok.dir, { recursive: true, force: true }); }
  const empty = mkdtempSync(join(tmpdir(), 'qafg-nodocker-'));
  try {
    await assert.rejects(withPath(empty, checkSandboxReady, { system: false }), /Docker, which was not found/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});


test('C3: setup runs from "/" and only "/" or "/work" is accepted as a working directory', () => {
  assert.equal(optValue(dockerRunArgs({ ...base, containerCwd: '/' }), '--workdir'), '/');
  assert.equal(optValue(dockerRunArgs(base), '--workdir'), '/work');
  assert.throws(() => dockerRunArgs({ ...base, containerCwd: '/work/evil' }), /container directory/);
});

test('C3: requirements.txt allows plain requirement lines only', () => {
  assert.doesNotThrow(() => validateRequirements('# deps\npytest\npytest-playwright>=0.4\nplaywright==1.48.0\nrequests[socks]>=2,<3\npywin32; sys_platform == "win32"\n\n'));
  const bad = [
    '--index-url https://evil.example/simple', '-r other.txt', '-e .', '--find-links=/tmp', '-c constraints.txt',
    'git+https://github.com/x/y.git', 'pkg @ https://evil.example/p.whl', 'https://evil.example/p.whl', './local', '../x', '/abs/path',
    'pytest --hash=sha256:abc', 'pytest\\evil',
  ];
  for (const line of bad) assert.throws(() => validateRequirements(`pytest\n${line}\n`), /does not allow/, line);
  assert.throws(() => validateRequirements(''), /non-empty/);
  assert.throws(() => validateRequirements(undefined), /non-empty/);
  assert.throws(() => validateRequirements('pytest\n'.repeat(300)), /too many lines/);
});

test('C3: a target on the host machine is detected up front', () => {
  const f = (name, content) => ({ name, path: '', content });
  assert.equal(findLocalTarget([f('conftest.py', 'BASE = "http://localhost:3000"')]), 'http://localhost:3000');
  assert.equal(findLocalTarget([f('a.py', 'u = "https://127.0.0.1:8080/x"')]), 'https://127.0.0.1:8080');
  assert.equal(findLocalTarget([f('a.py', 'u = "http://[::1]:5000"')]), 'http://[::1]:5000');
  assert.equal(findLocalTarget([f('a.py', 'u = "http://0.0.0.0:9"')]), 'http://0.0.0.0:9');
  assert.equal(findLocalTarget([f('a.py', 'u = "https://www.saucedemo.com"')]), null);
  assert.equal(findLocalTarget([f('a.py', 'u = "https://localhost.evil.com"')]), 'https://localhost'); // prefix match is fine: it is refused, not run
  assert.equal(findLocalTarget([f('README.md', 'run on http://localhost:3000')]), null); // prose is ignored
});

test('C3: a hostile report file is not read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-report-'));
  try {
    const ok = join(dir, 'ok.json'); writeFileSync(ok, '{"summary":{"total":1}}');
    assert.deepEqual(await readBoundedJson(ok), { summary: { total: 1 } });

    const secret = join(dir, 'secret.json'); writeFileSync(secret, '{"leak":true}');
    const link = join(dir, 'link.json'); symlinkSync(secret, link);
    await assert.rejects(readBoundedJson(link), /not safe to read/);

    const big = join(dir, 'big.json'); writeFileSync(big, '[' + '0,'.repeat(3000) + '0]');
    await assert.rejects(readBoundedJson(big, { maxBytes: 1000 }), /not safe to read/);

    const fifo = join(dir, 'fifo.json'); execFileSync('mkfifo', [fifo]);
    await assert.rejects(readBoundedJson(fifo), /not safe to read/); // must reject, not hang

    const sub = join(dir, 'sub'); mkdirSync(sub);
    await assert.rejects(readBoundedJson(sub), /not safe to read/);

    const junk = join(dir, 'junk.json'); writeFileSync(junk, '{not json');
    await assert.rejects(readBoundedJson(junk), /not safe to read/);
    await assert.rejects(readBoundedJson(join(dir, 'missing.json')), /not safe to read/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C3: a forwarded report is bounded and well-typed', () => {
  const tests = Array.from({ length: 5000 }, (_, i) => ({ nodeid: 'n' + i, outcome: 'passed', duration: 1, stdout: 'x'.repeat(100000) }));
  const r = capReport({ summary: { total: '1e9', passed: { a: 1 }, failed: 2 }, tests, environment: { big: 'y'.repeat(20000) }, created: 'soon' });
  assert.equal(r.tests.length, 2000);
  assert.equal(r.tests[0].stdout.length, 20000);
  assert.equal(r.summary.total, 0);
  assert.equal(r.summary.passed, 0);
  assert.equal(r.summary.failed, 2);
  assert.deepEqual(r.environment, {});
  assert.equal(r.created, undefined);
  // Garbage in, empty report out.
  for (const junk of [null, 5, 'x', [], { tests: 'nope', summary: 7 }]) {
    const c = capReport(junk);
    assert.deepEqual(c.tests, []);
    assert.equal(c.summary.total, 0);
  }
  // Object-valued fields do not pass through.
  assert.equal(typeof capReport({ tests: [{ nodeid: { x: 1 }, error: { y: 2 }, stdout: 7 }] }).tests[0].error, 'string');
  assert.equal(capReport({ tests: [{ nodeid: { x: 1 } }] }).tests[0].nodeid, '');
});

test('C3: workspace usage counts files and does not follow links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-usage-'));
  const outside = mkdtempSync(join(tmpdir(), 'qafg-outside-'));
  try {
    writeFileSync(join(dir, 'a'), Buffer.alloc(100000, 1));
    mkdirSync(join(dir, 'd')); writeFileSync(join(dir, 'd', 'b'), Buffer.alloc(100000, 1));
    writeFileSync(join(outside, 'huge'), Buffer.alloc(5_000_000, 1));
    symlinkSync(outside, join(dir, 'escape'));
    const u = await workspaceUsage(dir);
    assert.ok(u.bytes >= 200000 && u.bytes < 1_000_000, `bytes ${u.bytes}`); // the linked 5 MB is not counted
    assert.equal(u.entries, 4);
    assert.equal(u.truncated, false);
    assert.equal((await workspaceUsage(dir, { maxEntries: 2 })).truncated, true);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('C3: a phase that fills the workspace is stopped and its container removed', async () => {
  const work = mkdtempSync(join(tmpdir(), 'qafg-quota-'));
  const fd = fakeDocker({ runScript: 'for a in "$@"; do case "$a" in type=bind,source=*) src=${a#type=bind,source=}; src=${src%,target=*};; esac; done; dd if=/dev/zero of="$src/big" bs=1024 count=3072 2>/dev/null; sleep 5' });
  try {
    await assert.rejects(
      withPath(fd.dir, () => runPhase({ workDir: work, limits: { ...limits, diskBytes: 1024 * 1024 }, network: 'none', command: ['true'], diskCheckMs: 100 })),
      (e) => e.code === 'SANDBOX' && /wrote more than/.test(e.message),
    );
    assert.ok(fd.calls().some((c) => c.startsWith('rm -f qafg-')));
  } finally { rmSync(fd.dir, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});

test('C3: removal that cannot be confirmed fails the phase instead of passing silently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-fakedocker-'));
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\ncase "$1" in run) echo ok; exit 0;; rm) echo "daemon unreachable" >&2; exit 1;; esac\n');
  chmodSync(join(dir, 'docker'), 0o755);
  try {
    await assert.rejects(withPath(dir, () => runPhase({ workDir: '/tmp/x', limits, network: 'none', command: ['true'] })), /Could not confirm that the sandbox container was removed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C3: "no such container" counts as removed (--rm got there first)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qafg-fakedocker-'));
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\ncase "$1" in run) echo ok; exit 0;; rm) echo "Error: No such container: x" >&2; exit 1;; esac\n');
  chmodSync(join(dir, 'docker'), 0o755);
  try {
    assert.equal(await withPath(dir, () => runPhase({ workDir: '/tmp/x', limits, network: 'none', command: ['true'] })), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C3: when Docker is missing the error says so, not "could not confirm removal"', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'qafg-nodocker-'));
  try {
    await assert.rejects(withPath(empty, () => runPhase({ workDir: '/tmp/x', limits, network: 'none', command: ['true'] }), { system: false }), /Docker was not found/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('C3: a run that hits its deadline waits for registered container teardown', async () => {
  let tornDown = false;
  const started = Date.now();
  await assert.rejects(runWithDeadline(async () => {
    registerCleanup(async () => { await new Promise((r) => setTimeout(r, 300)); tornDown = true; });
    await new Promise(() => {}); // never finishes
  }, 100), /exceeded/);
  assert.equal(tornDown, true, 'teardown finished before the run settled');
  assert.ok(Date.now() - started >= 350);
  // A cleanup that fails does not stop the others or the run from settling.
  let second = false;
  await assert.rejects(runWithDeadline(async () => {
    registerCleanup(async () => { throw new Error('boom'); });
    registerCleanup(async () => { second = true; });
    await new Promise(() => {});
  }, 50), /exceeded/);
  assert.equal(second, true);
  // Unregistering removes it.
  let ran = false;
  await runWithDeadline(async () => { registerCleanup(async () => { ran = true; })(); }, 1000);
  assert.equal(ran, false);
});
