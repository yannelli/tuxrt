import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binaryNames, createRegistry } from '../src/commands/index.ts';
import { bootstrap } from '../src/vfs/bootstrap.ts';
import { FsError } from '../src/vfs/errors.ts';
import { applyChmod, formatMode } from '../src/vfs/mode.ts';
import { basename, dirname, normalize } from '../src/vfs/path.ts';
import { restore, snapshot } from '../src/vfs/persist.ts';
import { sh } from './helpers.ts';

test('path helpers', () => {
  assert.equal(normalize('../a/./b//c/..', '/home/ubuntu'), '/home/a/b');
  assert.equal(normalize('/..'), '/');
  assert.equal(dirname('/a/b/'), '/a');
  assert.equal(basename('/a/b.txt', '.txt'), 'b');
});

test('mode helpers', () => {
  assert.equal(formatMode('dir', 0o1777), 'drwxrwxrwt');
  assert.equal(formatMode('file', 0o4755), '-rwsr-xr-x');
  assert.equal(applyChmod('u+x,go-r', 0o644, false), 0o700);
  assert.equal(applyChmod('a=r', 0o777, false), 0o444);
  assert.equal(applyChmod('750', 0, false), 0o750);
});

test('symlinks resolve and loops are detected', () => {
  const vfs = bootstrap([]);
  vfs.symlink('/etc', '/tmp/etc-link');
  assert.match(vfs.readFile('/tmp/etc-link/hostname'), /ubuntu/);
  assert.equal(vfs.realpath('/bin/../bin'), '/usr/bin');
  vfs.symlink('/tmp/b', '/tmp/a');
  vfs.symlink('/tmp/a', '/tmp/b');
  assert.throws(() => vfs.readFile('/tmp/a'), (e: FsError) => e.code === 'ELOOP');
});

test('permissions are enforced for unprivileged users', async () => {
  const r = await sh('echo x > /etc/nope');
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'bash: /etc/nope: Permission denied\n');
  assert.match((await sh('read l < /etc/shadow')).stderr, /Permission denied/);
  assert.match((await sh('cd /root')).stderr, /Permission denied/);
});

test('snapshot round trip keeps files, links and metadata', () => {
  const names = binaryNames(createRegistry());
  const vfs = bootstrap(names);
  vfs.writeFile('/tmp/data', 'hello');
  vfs.chmod('/tmp/data', 0o600);
  vfs.symlink('/tmp/data', '/tmp/link');
  const copy = restore(snapshot(vfs), names);
  assert.equal(copy.readFile('/tmp/link'), 'hello');
  assert.equal(copy.stat('/tmp/data').mode, 0o600);
  assert.match(copy.readFile('/proc/version'), /^Linux version/);
  assert.ok(copy.exists('/dev/null'));
});
