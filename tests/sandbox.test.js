import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sandboxMode, sandboxLimits, dockerRunArgs, runPhase, checkSandboxReady, SANDBOX_IMAGE } from '../sandbox.js';

const limits = { memory: '2g', cpus: '2', testNetwork: 'bridge' };
const base = { name: 'qafg-abc123', workDir: '/tmp/qa-framework-xyz', network: 'bridge', limits, command: ['echo', 'hi'] };
const optValue = (args, flag) => args[args.indexOf(flag) + 1];

test('C3: sandbox mode is off by default and a typo is an error, not "off"', () => {
  assert.equal(sandboxMode({}), 'off');
  assert.equal(sandboxMode({ QAFG_SANDBOX: 'off' }), 'off');
  assert.equal(sandboxMode({ QAFG_SANDBOX: ' Docker ' }), 'docker');
  for (const bad of ['dokcer', 'true', '1', 'none']) assert.throws(() => sandboxMode({ QAFG_SANDBOX: bad }), /must be "docker" or "off"/);
});

test('C3: resource and network settings are validated', () => {
  assert.deepEqual(sandboxLimits({}), { memory: '2g', cpus: '2', testNetwork: 'bridge' });
  assert.equal(sandboxLimits({ QAFG_SANDBOX_TEST_NETWORK: 'none' }).testNetwork, 'none');
  for (const env of [{ QAFG_SANDBOX_MEMORY: '2g --privileged' }, { QAFG_SANDBOX_MEMORY: '0g' }, { QAFG_SANDBOX_CPUS: '2; rm' }, { QAFG_SANDBOX_CPUS: '0' }, { QAFG_SANDBOX_TEST_NETWORK: 'host' }]) {
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
