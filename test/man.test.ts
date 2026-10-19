import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { allPages } from '../src/commands/sys/man/pages/index.ts';
import { render } from '../src/commands/sys/man/render.ts';
import { toRoff } from '../src/commands/sys/man/toroff.ts';
import { StringReader } from '../src/shell/io.ts';
import { machine, Runtime, sh } from './helpers.ts';

const LS_HEADER = 'LS(1)                            User Commands                           LS(1)';
const LS_FOOTER = 'tuxrt 0.1.0                         2026-10                              LS(1)';

async function tty(cmd: string): Promise<string> {
  const rt = await Runtime.boot();
  let data = '';
  const stdout = { isTTY: true, write: (d: string) => void (data += d) };
  await rt.run(cmd, { stdin: new StringReader(''), stdout, stderr: stdout });
  return data;
}

test('man: renders like man-db at 80 columns', async () => {
  const r = await sh('man ls');
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], LS_HEADER);
  assert.equal(lines.at(-2), LS_FOOTER);
  assert.equal(lines.at(-1), '');
  assert.match(r.stdout, /\n\nNAME\n {7}ls - list directory contents\n\nSYNOPSIS\n {7}ls \[OPTION\]\.\.\. \[FILE\]\.\.\.\n/);
  assert.match(r.stdout, /\n {7}-a, --all\n {14}include entries whose names begin with a dot\n/);
  assert.match(r.stdout, /\n {7}-l {5}produce the detailed long format\n/);
  assert.ok(lines.every((l) => l.length <= 78), 'fits in 78 columns');
  assert.ok(!r.stdout.includes('\x1b'), 'no escape codes off a terminal');
});

test('man: width follows MANWIDTH, then COLUMNS', async () => {
  const narrow = (await sh('MANWIDTH=60 man ls')).stdout.split('\n');
  assert.equal(narrow[0].length, 58);
  assert.ok(narrow.every((l) => l.length <= 58));
  const wide = (await sh('COLUMNS=120 man ls')).stdout.split('\n');
  assert.equal(wide[0].length, 117);
  assert.ok(wide.some((l) => l.length > 100));
});

test('man: bold headings and underlined metavariables only on a terminal', async () => {
  const out = await tty('man ls');
  assert.ok(out.includes('\x1b[1mNAME\x1b[0m'));
  assert.ok(out.includes('\x1b[1mls\x1b[0m [\x1b[4mOPTION\x1b[0m]...'));
  assert.ok(out.includes('\x1b[1m-a\x1b[0m, \x1b[1m--all\x1b[0m'));
});

test('man: sections, -a and -w', async () => {
  const run = await machine();
  assert.match((await run('man passwd')).stdout, /^PASSWD\(1\) /);
  const five = await run('man 5 passwd');
  assert.match(five.stdout, /^PASSWD\(5\) .* PASSWD\(5\)\n\nNAME\n {7}passwd - the password file\n/);
  assert.equal((await run("man 'passwd(5)'")).stdout, five.stdout);
  assert.equal((await run('man passwd.5')).stdout, five.stdout);
  const all = (await run('man -a passwd')).stdout;
  assert.ok(all.indexOf('PASSWD(1)') < all.indexOf('PASSWD(5)'));
  assert.equal((await run('man -w ls')).stdout, '/usr/share/man/man1/ls.1.gz\n');
  assert.equal((await run('man -aw passwd')).stdout, '/usr/share/man/man1/passwd.1.gz\n/usr/share/man/man5/passwd.5.gz\n');
  assert.equal((await run('man -w')).stdout, '/usr/local/man:/usr/local/share/man:/usr/share/man\n');
  assert.match((await run('man sudo_root')).stdout, /^SUDO_ROOT\(8\) /);
  assert.match((await run('man ping')).stdout, /^PING\(8\) /);
});

test('man: missing pages exit 16', async () => {
  const run = await machine();
  assert.deepEqual(await run('man nosuchpage'), { stdout: '', stderr: 'No manual entry for nosuchpage\n', code: 16 });
  assert.deepEqual(await run('man 7 ls'), { stdout: '', stderr: 'No manual entry for ls in section 7\n', code: 16 });
  const mixed = await run('man -w ls nosuch');
  assert.equal(mixed.stdout, '/usr/share/man/man1/ls.1.gz\n');
  assert.equal(mixed.code, 16);
  assert.deepEqual(await run('man'), { stdout: '', stderr: "What manual page do you want?\nFor example, try 'man man'.\n", code: 1 });
});

test('man -k, apropos, man -f and whatis', async () => {
  const run = await machine();
  const ls = 'ls (1)               - list directory contents\n';
  assert.ok((await run('man -k "directory contents"')).stdout.includes(ls));
  assert.ok((await run('apropos "directory contents"')).stdout.includes(ls));
  assert.equal((await run('man -f ls')).stdout, ls);
  assert.equal((await run('whatis passwd')).stdout, 'passwd (1)           - change user password\npasswd (5)           - the password file\n');
  assert.equal((await run('whatis -s 5 passwd')).stdout, 'passwd (5)           - the password file\n');
  assert.deepEqual(await run('whatis xyzzy'), { stdout: '', stderr: 'xyzzy: nothing appropriate.\n', code: 16 });
  assert.deepEqual(await run('apropos xyzzy'), { stdout: '', stderr: 'xyzzy: nothing appropriate.\n', code: 16 });
  const sorted = (await run('apropos -s 1 copy')).stdout.split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b)));
  assert.ok(sorted.includes('cp'));
});

test('man: generated pages for commands without a hand-written manual', async () => {
  const run = await machine();
  const rev = await run('man rev');
  assert.equal(rev.code, 0);
  assert.match(rev.stdout, /^REV\(1\) +User Commands +REV\(1\)\n\nNAME\n {7}rev - reverse lines characterwise\n/);
  assert.equal((await run('whatis rev')).stdout, 'rev (1)              - reverse lines characterwise\n');
  const cd = await run('man cd');
  assert.match(cd.stdout, /^CD\(1\) /);
  assert.match(cd.stdout, /bash-builtins\(7\)/);
  assert.match((await run('man builtins')).stdout, /^BASH-BUILTINS\(7\) [\s\S]*\n {7}cd \[-L/);
  assert.match((await run('man bash')).stdout, /^BASH\(1\) [\s\S]*SHELL GRAMMAR/);
});

test('man: pages installed in the VFS take precedence, including gzip and .so', async () => {
  const rt = await Runtime.boot({ user: 'root' });
  const page = '.TH HELLO 1 2024-01-01 "hello 1.0"\n.SH NAME\nhello \\- greet the world\n.SH DESCRIPTION\n.B hello\nprints a greeting.\n.TP\n.BI \\-n " name"\ngreet\n.I name\ninstead.\n';
  rt.kernel.vfs.mkdir('/usr/share/man/man1', true);
  rt.kernel.vfs.writeFile('/usr/share/man/man1/hello.1.gz', gzipSync(page).toString('latin1'));
  rt.kernel.vfs.writeFile('/usr/share/man/man1/hi.1', '.so man1/hello.1\n');
  const out = (await rt.exec('man hello')).stdout;
  assert.equal(out, [
    'HELLO(1)                    General Commands Manual                   HELLO(1)',
    '',
    'NAME',
    '       hello - greet the world',
    '',
    'DESCRIPTION',
    '       hello prints a greeting.',
    '',
    '       -n name',
    '              greet name instead.',
    '',
    'hello 1.0                         2024-01-01                          HELLO(1)',
    '',
  ].join('\n'));
  assert.equal((await rt.exec('man hi')).stdout, out);
  assert.equal((await rt.exec('whatis hello')).stdout, 'hello (1)            - greet the world\n');
  assert.equal((await rt.exec('man -l /usr/share/man/man1/hello.1.gz')).stdout, out);
  assert.match((await rt.exec('mandb')).stdout, /^Purging old database entries in \/usr\/share\/man\.\.\.\n[\s\S]* manual pages were added\.\n/);
});

test('man: every built-in page renders within the line length', () => {
  for (const page of allPages) {
    const out = render(toRoff(page), 80, false);
    const long = out.split('\n').filter((l) => l.length > 78);
    assert.deepEqual(long, [], `${page.name}(${page.section})`);
    assert.ok(!out.includes('\x1b'), `${page.name}: no escape codes`);
    assert.ok(page.summary && !/\u2014|\u2013/.test(JSON.stringify(page)), `${page.name}: summary, no dashes`);
  }
});
