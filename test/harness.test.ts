import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nodeHostFs } from '../src/platform/node/hostfs.ts';
import { AgentShell, BASH_TOOL } from '../src/runtime.ts';
import { Runtime } from './helpers.ts';

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tuxrt-ws-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.txt'), 'hello\n');
  return dir;
}

test('exec timeout and output cap', async () => {
  const rt = await Runtime.boot();
  const slow = await rt.exec('sleep 5; echo never', { timeoutMs: 100 });
  assert.deepEqual(slow, { stdout: '', stderr: '', code: 124, timedOut: true });
  assert.equal((await rt.exec('while :; do :; done', { timeoutMs: 100 })).code, 124);
  const flood = await rt.exec('yes', { maxOutput: 10 });
  assert.equal(flood.stdout, 'y\ny\ny\ny\ny\n');
  assert.equal(flood.truncated, true);
  assert.deepEqual(await rt.exec('echo $?; echo ok'), { stdout: '141\nok\n', stderr: '', code: 0 });
});

test('host mounts read and write through to the real directory', async () => {
  const dir = workspace();
  const rt = await Runtime.boot();
  rt.mount('/home/ubuntu/ws', nodeHostFs(dir));
  const run = async (cmd: string) => (await rt.exec(cmd)).stdout;
  assert.equal(await run('cat ~/ws/src/a.txt; stat -c %U ~/ws/src/a.txt'), 'hello\nubuntu\n');
  await run('cd ~/ws && echo new > b.txt && mkdir -p d/e && mv b.txt d/e/ && sed -i s/new/NEW/ d/e/b.txt');
  assert.equal(readFileSync(join(dir, 'd', 'e', 'b.txt'), 'utf8'), 'NEW\n');
  writeFileSync(join(dir, 'from-host.txt'), 'outside edit\n');
  assert.equal(await run('cat ~/ws/from-host.txt'), 'outside edit\n');
  assert.equal(await run('mv ~/ws/d /tmp/d && find /tmp/d -type f && ls ~/ws'), '/tmp/d/e/b.txt\nfrom-host.txt\nsrc\n');
  assert.equal(existsSync(join(dir, 'd')), false);
  assert.equal(await run('echo back > /tmp/x && mv /tmp/x ~/ws/x && rm ~/ws/from-host.txt && ls ~/ws'), 'src\nx\n');
  assert.equal(readFileSync(join(dir, 'x'), 'utf8'), 'back\n');
  assert.equal(await run('printf "\\x1f\\x8b\\x00\\xff" > ~/ws/bin && wc -c < ~/ws/bin'), '4\n');
  assert.deepEqual([...readFileSync(join(dir, 'bin'))], [0x1f, 0x8b, 0x00, 0xff]);
  assert.match((await rt.exec('ln ~/ws/x ~/ws/y')).stderr, /Operation not permitted/);
});

test('host symlinks cannot reach outside the mount', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, async () => {
  const dir = workspace();
  const outside = mkdtempSync(join(tmpdir(), 'tuxrt-out-'));
  writeFileSync(join(outside, 'secret'), 'host secret\n');
  symlinkSync(join(outside, 'secret'), join(dir, 'link'));
  const host = nodeHostFs(dir);
  assert.throws(() => host.readFile('/link'), { code: 'EACCES' });
  const rt = await Runtime.boot();
  rt.mount('/mnt/ws', host);
  const r = await rt.exec('cat /mnt/ws/link');
  assert.notEqual(r.stdout, 'host secret\n');
  assert.equal(r.code, 1);
});

test('snapshots leave mounted directories out', async () => {
  const sh = await AgentShell.create({ mounts: { '/home/ubuntu/ws': nodeHostFs(workspace()) } });
  await sh.run({ command: 'echo kept > ~/note' });
  const resumed = await AgentShell.create({ state: sh.snapshot() });
  assert.equal((await resumed.run({ command: 'cat ~/note; ls ~' })).output, 'kept\nnote');
});

test('AgentShell: persistent session, formatted results, restart', async () => {
  const sh = await AgentShell.create({ mounts: { '/home/ubuntu/ws': nodeHostFs(workspace()) }, maxOutput: 50, timeoutMs: 200 });
  assert.equal(BASH_TOOL.name, 'bash');
  assert.equal((await sh.run({ command: 'pwd' })).output, '/home/ubuntu/ws');
  assert.equal((await sh.run({ command: 'cd src; X=1; ls' })).output, 'a.txt');
  assert.equal((await sh.run({ command: 'echo $X; pwd' })).output, '1\n/home/ubuntu/ws/src');
  assert.equal((await sh.run({ command: 'echo out; echo err >&2; exit 3' })).output, 'out\nerr\n[exit code 3]');
  assert.equal((await sh.run({ command: 'echo "x=$X"; pwd' })).output, 'x=\n/home/ubuntu/ws');
  const seq = Array.from({ length: 100 }, (_, i) => `${i + 1}\n`).join('').slice(0, 50);
  assert.equal((await sh.run({ command: 'seq 100' })).output, `${seq}\n[output truncated after 50 characters]`);
  assert.equal((await sh.run({ command: 'sleep 3' })).output, '[killed: timed out after 0.2s]');
  assert.equal((await sh.run({ command: 'true' })).output, '(no output)');
  assert.equal((await sh.run({ command: '  ' })).code, 2);
  await sh.run({ command: 'cd /; Y=1' });
  assert.equal((await sh.run({ command: 'echo "y=$Y"; pwd', restart: true })).output, 'y=\n/home/ubuntu/ws');
});
