import assert from 'node:assert/strict';
import { test } from 'node:test';
import { machine, sh } from './helpers.ts';

const out = async (cmd: string, stdin?: string) => (await sh(cmd, stdin)).stdout;

test('streaming producers terminate under head', async () => {
  assert.equal(await out('yes | head -3'), 'y\ny\ny\n');
  assert.equal(await out('yes abc | head -n 2; yes | head -c 5'), 'abc\nabc\ny\ny\ny');
  assert.equal(await out('seq 100000 | head -1'), '1\n');
  assert.equal(await out('seq 1000000000 | head -2'), '1\n2\n');
  assert.equal(await out('yes | cat | head -1'), 'y\n');
  assert.equal(await out('yes | tr y n | head -1'), 'n\n');
  assert.equal(await out('yes | grep -m2 y'), 'y\ny\n');
  assert.equal(await out('yes | sed 2q'), 'y\ny\n');
});

test('cat, tac, rev, tee', async () => {
  const run = await machine();
  assert.equal(await out('printf "a\\n\\n\\nb\\tc\\n" | cat -nAs'), '     1\ta$\n     2\t$\n     3\tb^Ic$\n');
  assert.equal(await out('printf "a\\n\\nb\\n" | cat -b'), '     1\ta\n\n     2\tb\n');
  assert.equal(await out('echo héllo | cat -v'), 'hM-CM-)llo\n');
  const r = await sh('cat nosuch /etc/hostname');
  assert.deepEqual([r.stdout, r.stderr, r.code], ['ubuntu\n', 'cat: nosuch: No such file or directory\n', 1]);
  assert.equal(await out('printf "a\\nb\\nc\\n" | tac'), 'c\nb\na\n');
  assert.equal(await out('printf "abc\\nxy" | rev'), 'cba\nyx');
  assert.equal((await run('echo hi | tee /tmp/t1 /tmp/t2; echo more | tee -a /tmp/t1 >/dev/null; cat /tmp/t1 /tmp/t2')).stdout, 'hi\nhi\nmore\nhi\n');
});

test('head and tail', async () => {
  assert.equal(await out('seq 10 | head -n 3; seq 10 | head -4 | tail -1'), '1\n2\n3\n4\n');
  assert.equal(await out('seq 5 | head -n -2'), '1\n2\n3\n');
  assert.equal(await out('head -c 3 /etc/hostname'), 'ubu');
  assert.equal(await out('head -n1 /etc/hostname /etc/hostname'), '==> /etc/hostname <==\nubuntu\n\n==> /etc/hostname <==\nubuntu\n');
  assert.equal(await out('head -qn1 /etc/hostname /etc/hostname'), 'ubuntu\nubuntu\n');
  assert.equal((await sh('head nosuch')).stderr, "head: cannot open 'nosuch' for reading: No such file or directory\n");
  assert.equal((await sh('head -n x /etc/hostname')).stderr, "head: invalid number of lines: 'x'\n");
  assert.equal(await out('seq 5 | tail -2'), '4\n5\n');
  assert.equal(await out('seq 5 | tail -n +4'), '4\n5\n');
  assert.equal(await out('printf "a\\nb" | tail -1'), 'b');
  assert.equal(await out('tail -c 4 /etc/hostname'), 'ntu\n');
  assert.equal(await out('seq 3 | tail -f'), '1\n2\n3\n');
});

test('wc alignment', async () => {
  assert.equal(await out('echo hi there | wc'), '      1       2       9\n');
  assert.equal(await out('echo hi | wc -l'), '1\n');
  assert.equal(await out('wc -l /etc/hostname'), '1 /etc/hostname\n');
  assert.equal(await out('wc /etc/hostname /etc/hostname'), ' 1  1  7 /etc/hostname\n 1  1  7 /etc/hostname\n 2  2 14 total\n');
  assert.equal(await out('echo héllo | wc -m -c'), '      6       7\n');
  assert.equal(await out('printf "ab\\tc\\n" | wc -L'), '9\n');
  assert.equal((await sh('wc nosuch')).stderr, 'wc: nosuch: No such file or directory\n');
});

test('sort', async () => {
  const s = (flags: string, input: string) => out(`printf '${input}' | sort ${flags}`);
  assert.equal(await s('', 'b\\na\\nc\\na\\n'), 'a\na\nb\nc\n');
  assert.equal(await s('-ru', 'b\\na\\nc\\na\\n'), 'c\nb\na\n');
  assert.equal(await s('-n', '10\\n9\\n2\\n100\\n'), '2\n9\n10\n100\n');
  assert.equal(await s('-h', '2M\\n1K\\n500\\n'), '500\n1K\n2M\n');
  assert.equal(await s('-k2,2n', 'b 2\\na 10\\nc 1\\n'), 'c 1\nb 2\na 10\n');
  assert.equal(await s('-t, -k2 -r', 'x,3\\ny,1\\nz,2\\n'), 'x,3\nz,2\ny,1\n');
  assert.equal(await s('-V', 'v1.10\\nv1.2\\nv1.1\\n'), 'v1.1\nv1.2\nv1.10\n');
  assert.equal(await s('-f', 'B\\na\\nC\\n'), 'a\nB\nC\n');
  assert.equal(await s('-M', 'Mar\\nJan\\nFeb\\n'), 'Jan\nFeb\nMar\n');
  assert.equal(await s('-k1.2', 'ab\\nba\\naa\\n'), 'aa\nba\nab\n');
  assert.equal(await s('-s -k1,1', 'b 2\\na 9\\nb 1\\n'), 'a 9\nb 2\nb 1\n');
  const c = await sh("printf 'b\\na\\n' | sort -c");
  assert.deepEqual([c.stderr, c.code], ['sort: -:2: disorder: a\n', 1]);
  const missing = await sh('sort nosuch');
  assert.deepEqual([missing.stderr, missing.code], ['sort: cannot read: nosuch: No such file or directory\n', 2]);
  const run = await machine();
  assert.equal((await run("printf 'b\\na\\n' > /tmp/f; sort -o /tmp/f /tmp/f; cat /tmp/f")).stdout, 'a\nb\n');
});

test('uniq, comm, join', async () => {
  assert.equal(await out("printf 'a\\na\\nb\\nc\\nc\\nc\\n' | uniq -c"), '      2 a\n      1 b\n      3 c\n');
  assert.equal(await out("printf 'a\\na\\nb\\n' | uniq -d"), 'a\n');
  assert.equal(await out("printf 'a\\na\\nb\\n' | uniq -u"), 'b\n');
  assert.equal(await out("printf 'A\\na\\n' | uniq -i"), 'A\n');
  assert.equal(await out("printf 'x a\\ny a\\nz b\\n' | uniq -f1"), 'x a\nz b\n');
  assert.equal(await out("printf 'a\\na\\nb\\n' | uniq -D"), 'a\na\n');
  const run = await machine();
  await run("printf 'a\\nb\\nd\\n' > /tmp/c1; printf 'b\\nc\\nd\\n' > /tmp/c2");
  assert.equal((await run('comm /tmp/c1 /tmp/c2')).stdout, 'a\n\t\tb\n\tc\n\t\td\n');
  assert.equal((await run('comm -12 /tmp/c1 /tmp/c2')).stdout, 'b\nd\n');
  assert.equal((await run('comm -3 /tmp/c1 /tmp/c2')).stdout, 'a\n\tc\n');
  await run("printf '1 a\\n2 b\\n' > /tmp/j1; printf '1 x\\n3 y\\n' > /tmp/j2");
  assert.equal((await run('join /tmp/j1 /tmp/j2')).stdout, '1 a x\n');
  assert.equal((await run('join -a1 /tmp/j1 /tmp/j2')).stdout, '1 a x\n2 b\n');
  assert.equal((await run('join -v2 /tmp/j1 /tmp/j2')).stdout, '3 y\n');
  assert.equal((await run('join -o 2.2,1.2 /tmp/j1 /tmp/j2')).stdout, 'x a\n');
});

test('cut and paste', async () => {
  assert.equal(await out('echo a:b:c:d | cut -d: -f2,4'), 'b:d\n');
  assert.equal(await out('echo a:b:c:d | cut -d: -f2- --output-delimiter=,'), 'b,c,d\n');
  assert.equal(await out('echo a:b:c:d | cut -d: -f1,2 --complement'), 'c:d\n');
  assert.equal(await out('echo abcdef | cut -c1-3,5; echo abcdef | cut -c-2,4-'), 'abce\nabdef\n');
  assert.equal(await out("printf 'a:b\\nnodelim\\n' | cut -d: -f2"), 'b\nnodelim\n');
  assert.equal(await out("printf 'a:b\\nnodelim\\n' | cut -s -d: -f2"), 'b\n');
  assert.equal((await sh('cut -f0')).stderr, "cut: fields are numbered from 1\nTry 'cut --help' for more information.\n");
  assert.equal((await sh('echo x | cut')).stderr, "cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.\n");
  assert.equal(await out('seq 6 | paste - -'), '1\t2\n3\t4\n5\t6\n');
  assert.equal(await out('seq 3 | paste -sd+'), '1+2+3\n');
  const run = await machine();
  assert.equal((await run("printf '1\\n2\\n' > /tmp/p1; printf 'a\\nb\\nc\\n' > /tmp/p2; paste -d, /tmp/p1 /tmp/p2")).stdout, '1,a\n2,b\n,c\n');
});

test('tr', async () => {
  assert.equal(await out("echo hello | tr a-z A-Z; echo hello | tr '[:lower:]' '[:upper:]'"), 'HELLO\nHELLO\n');
  assert.equal(await out('echo hello | tr -d l; echo aabbcc | tr -s abc'), 'heo\nabc\n');
  assert.equal(await out('echo "a  b" | tr -s " " "_"'), 'a_b\n');
  assert.equal(await out('echo "hello world" | tr -c "a-z\\n" _'), 'hello_world\n');
  assert.equal(await out('echo "Hello 123" | tr -cd "[:digit:]"'), '123');
  assert.equal(await out("printf 'a b\\n' | tr ' ' '\\n'"), 'a\nb\n');
  assert.equal(await out('echo abcd | tr abcd "x[y*]"'), 'xyyy\n');
  const r = await sh('echo abc | tr a');
  assert.deepEqual([r.stderr, r.code], ["tr: missing operand after 'a'\nTwo strings must be given when translating.\nTry 'tr --help' for more information.\n", 1]);
});

test('nl, fold, fmt, expand, unexpand, column', async () => {
  assert.equal(await out("printf 'a\\n\\nb\\n' | nl"), '     1\ta\n       \n     2\tb\n');
  assert.equal(await out("printf 'a\\n\\nb\\n' | nl -ba -w3 -s': '"), '  1: a\n  2: \n  3: b\n');
  assert.equal(await out("printf 'a\\n' | nl -n rz -w3"), '001\ta\n');
  assert.equal(await out('echo abcdefghij | fold -w4; echo "aaa bbb ccc" | fold -sw8'), 'abcd\nefgh\nij\naaa bbb \nccc\n');
  assert.equal(await out('echo "one two three four" | fmt -w 10'), 'one two\nthree four\n');
  assert.equal(await out("printf 'a\\tb\\n' | expand; printf 'a\\tb\\n' | expand -t 4"), 'a       b\na   b\n');
  assert.equal(await out("printf '        x\\n' | unexpand; printf 'abcdefg  x\\n' | unexpand -a"), '\tx\nabcdefg\t x\n');
  assert.equal(await out("printf 'a b c\\nlonger x y\\n' | column -t"), 'a       b  c\nlonger  x  y\n');
  assert.equal(await out("printf 'a,b\\nccc,d\\n' | column -t -s, -o ' | '"), 'a   | b\nccc | d\n');
  assert.equal(await out("printf 'a\\nb\\nc\\n' | column -c 20; printf 'a\\nb\\nc\\n' | column -x -c 20"), 'a\tc\nb\na\tb\nc\n');
});

test('seq', async () => {
  assert.equal(await out('seq 3; seq 5 -2 1'), '1\n2\n3\n5\n3\n1\n');
  assert.equal(await out('seq -1 1'), '-1\n0\n1\n');
  assert.equal(await out('seq 1 0.5 3'), '1.0\n1.5\n2.0\n2.5\n3.0\n');
  assert.equal(await out('seq 0 0.1 0.3'), '0.0\n0.1\n0.2\n0.3\n');
  assert.equal(await out('seq -w 8 10; seq -s, 5'), '08\n09\n10\n1,2,3,4,5\n');
  assert.equal(await out("seq -f '%.2f' 2"), '1.00\n2.00\n');
  assert.equal(await out('seq 5 1'), '');
  const r = await sh('seq x');
  assert.deepEqual([r.stderr, r.code], ["seq: invalid floating point argument: 'x'\nTry 'seq --help' for more information.\n", 1]);
});

test('diff and cmp', async () => {
  const run = await machine();
  await run("printf 'a\\nb\\nc\\n' > /tmp/a; printf 'a\\nB\\nc\\nd\\n' > /tmp/b; seq 10 > /tmp/s1; seq 10 | sed '2d;9s/.*/X/' > /tmp/s2");
  const d = await run('diff /tmp/a /tmp/b');
  assert.deepEqual([d.stdout, d.code], ['2c2\n< b\n---\n> B\n3a4\n> d\n', 1]);
  assert.equal((await run('diff /tmp/s1 /tmp/s2')).stdout, '2d1\n< 2\n9c8\n< 9\n---\n> X\n');
  const u = (await run('diff -u /tmp/a /tmp/b')).stdout.split('\n');
  assert.match(u[0], /^--- \/tmp\/a\t\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{9} \+0000$/);
  assert.match(u[1], /^\+\+\+ \/tmp\/b\t/);
  assert.deepEqual(u.slice(2), ['@@ -1,3 +1,4 @@', ' a', '-b', '+B', ' c', '+d', '']);
  assert.equal((await run('diff -U1 /tmp/s1 /tmp/s2 | tail -n +3')).stdout, '@@ -1,3 +1,2 @@\n 1\n-2\n 3\n@@ -8,3 +7,3 @@\n 8\n-9\n+X\n 10\n');
  assert.equal((await run('diff /tmp/a /tmp/a; echo $?')).stdout, '0\n');
  assert.equal((await run('diff -q /tmp/a /tmp/b')).stdout, 'Files /tmp/a and /tmp/b differ\n');
  const missing = await run('diff /tmp/a /nosuch');
  assert.deepEqual([missing.stderr, missing.code], ['diff: /nosuch: No such file or directory\n', 2]);
  assert.equal((await run('printf x > /tmp/n1; printf y > /tmp/n2; diff /tmp/n1 /tmp/n2')).stdout, '1c1\n< x\n\\ No newline at end of file\n---\n> y\n\\ No newline at end of file\n');
  assert.equal((await run('mkdir /tmp/da /tmp/db; echo 1 > /tmp/da/f; echo 2 > /tmp/db/f; echo x > /tmp/da/o; diff /tmp/da /tmp/db')).stdout, 'diff /tmp/da/f /tmp/db/f\n1c1\n< 1\n---\n> 2\nOnly in /tmp/da: o\n');
  const c = await run('cmp /tmp/a /tmp/b');
  assert.deepEqual([c.stdout, c.code], ['/tmp/a /tmp/b differ: byte 3, line 2\n', 1]);
  assert.equal((await run("printf 'a\\nb\\n' > /tmp/c; cmp /tmp/a /tmp/c")).stderr, 'cmp: EOF on /tmp/c after byte 4, line 2\n');
  assert.equal((await run('cmp -s /tmp/a /tmp/a; echo $?')).stdout, '0\n');
});

test('od, xxd, strings', async () => {
  assert.equal(await out('echo hello | od -c'), '0000000   h   e   l   l   o  \\n\n0000006\n');
  assert.equal(await out('echo hello | od -x'), '0000000 6568 6c6c 0a6f\n0000006\n');
  assert.equal(await out('echo hello | od'), '0000000 062550 066154 005157\n0000006\n');
  assert.equal(await out('echo hello | od -A x -t x1z'), `000000 68 65 6c 6c 6f 0a${' '.repeat(30)}  >hello.<\n000006\n`);
  assert.equal(await out('echo hello | xxd'), `00000000: 6865 6c6c 6f0a${' '.repeat(27)}hello.\n`);
  assert.equal(await out('echo hello | xxd -p'), '68656c6c6f0a\n');
  assert.equal(await out('echo hello | xxd -p | xxd -r -p; echo hi | xxd | xxd -r'), 'hello\nhi\n');
  assert.equal(await out("printf 'hello\\0wor\\0longer string\\n' | strings"), 'hello\nlonger string\n');
});

test('grep basics and regex dialects', async () => {
  const run = await machine();
  await run("printf 'foo\\nbar\\nbaz\\n' > /tmp/f");
  const g = async (cmd: string) => (await run(cmd)).stdout;
  assert.equal(await g('grep ba /tmp/f'), 'bar\nbaz\n');
  assert.equal(await g('grep -n ba /tmp/f; grep -c ba /tmp/f'), '2:bar\n3:baz\n2\n');
  assert.equal(await g('grep -v ba /tmp/f; grep -i FOO /tmp/f'), 'foo\nfoo\n');
  assert.equal(await g('grep "ba\\(r\\|z\\)" /tmp/f'), 'bar\nbaz\n');
  assert.equal(await g('grep -E "ba(r|z)" /tmp/f'), 'bar\nbaz\n');
  assert.equal(await g('grep "a+" /tmp/f; echo $?'), '1\n');
  assert.equal(await g('grep "o\\+" /tmp/f'), 'foo\n');
  assert.equal(await g('grep "[[:alpha:]]\\{3\\}" /tmp/f | wc -l'), '3\n');
  assert.equal(await g('grep -o "ba." /tmp/f'), 'bar\nbaz\n');
  assert.equal(await g('grep -w ba /tmp/f; echo $?'), '1\n');
  assert.equal(await g('grep -x bar /tmp/f'), 'bar\n');
  assert.equal(await g('grep -e foo -e baz /tmp/f'), 'foo\nbaz\n');
  assert.equal(await g('grep -F "a." /tmp/f; echo $?'), '1\n');
  assert.equal(await g('grep -q foo /tmp/f; echo $?'), '0\n');
  assert.equal(await g('grep -m1 ba /tmp/f'), 'bar\n');
  assert.equal(await g('echo "a(b)" | grep "(b)"'), 'a(b)\n');
  assert.equal(await g('echo aa | grep "\\(a\\)\\1"'), 'aa\n');
  assert.equal(await g('echo "foo bar" | grep -o "\\w\\+"'), 'foo\nbar\n');
  assert.equal(await g('echo "word1 word2" | grep -Eo "\\<word[0-9]\\>"'), 'word1\nword2\n');
  assert.equal(await g('egrep "fo+" /tmp/f 2>/dev/null; fgrep "o" /tmp/f'), 'foo\nfoo\n');
  const missing = await run('grep foo /nonexist');
  assert.deepEqual([missing.stderr, missing.code], ['grep: /nonexist: No such file or directory\n', 2]);
  assert.equal((await run('grep -s foo /nonexist')).stderr, '');
  assert.equal((await run('grep -E "(" /tmp/f')).code, 2);
});

test('grep context, files, recursion and color', async () => {
  const run = await machine();
  await run("printf 'foo\\nbar\\n' > /tmp/f; mkdir -p /tmp/d/sub; echo hello > /tmp/d/a.txt; echo hello > /tmp/d/sub/b.md");
  const g = async (cmd: string) => (await run(cmd)).stdout;
  assert.equal(await g('seq 10 | grep -A1 -B1 5'), '4\n5\n6\n');
  assert.equal(await g('seq 20 | grep -C1 -e 5 -e 15'), '4\n5\n6\n--\n14\n15\n16\n');
  assert.equal(await g('seq 12 | grep -n -A1 1$'), '1:1\n2-2\n--\n11:11\n12-12\n');
  assert.equal(await g('grep -l foo /tmp/f /etc/hostname'), '/tmp/f\n');
  assert.equal(await g('grep -L foo /tmp/f /etc/hostname'), '/etc/hostname\n');
  assert.equal(await g('grep -c o /tmp/f /etc/hostname'), '/tmp/f:1\n/etc/hostname:0\n');
  assert.equal(await g('grep -h foo /tmp/f /tmp/f'), 'foo\nfoo\n');
  assert.equal(await g('grep -r hello /tmp/d'), '/tmp/d/a.txt:hello\n/tmp/d/sub/b.md:hello\n');
  assert.equal(await g('cd /tmp/d && grep -r hello'), 'a.txt:hello\nsub/b.md:hello\n');
  assert.equal(await g('grep -r --include="*.md" hello /tmp/d'), '/tmp/d/sub/b.md:hello\n');
  assert.equal(await g('grep -r --exclude-dir=sub hello /tmp/d'), '/tmp/d/a.txt:hello\n');
  assert.equal((await run('grep hello /tmp/d')).stderr, 'grep: /tmp/d: Is a directory\n');
  assert.equal(await g('grep --color=always ba /tmp/f'), '\x1b[01;31m\x1b[Kba\x1b[m\x1b[Kr\n');
  assert.equal(await g('grep --color=always -nH ba /tmp/f'), '\x1b[35m\x1b[K/tmp/f\x1b[m\x1b[K\x1b[36m\x1b[K:\x1b[m\x1b[K\x1b[32m\x1b[K2\x1b[m\x1b[K\x1b[36m\x1b[K:\x1b[m\x1b[K\x1b[01;31m\x1b[Kba\x1b[m\x1b[Kr\n');
  assert.equal(await g('grep --color=auto ba /tmp/f'), 'bar\n');
  const bin = await run("printf 'x\\0y\\nfoo\\n' > /tmp/bin; grep foo /tmp/bin");
  assert.deepEqual([bin.stdout, bin.stderr], ['', 'grep: /tmp/bin: binary file matches\n']);
});

test('sed addresses and commands', async () => {
  const s = (script: string, input = '1\\n2\\n3\\n4\\n5\\n') => out(`printf '${input}' | sed ${script}`);
  assert.equal(await s('-n -e 2p -e "2,4p"'), '2\n2\n3\n4\n');
  assert.equal(await s('2d'), '1\n3\n4\n5\n');
  assert.equal(await s('"\\$d"'), '1\n2\n3\n4\n');
  assert.equal(await s('-n "1~2p"'), '1\n3\n5\n');
  assert.equal(await s('-n "/2/,/4/p"'), '2\n3\n4\n');
  assert.equal(await s('-n "\\%3%p"'), '3\n');
  assert.equal(await s('-n "2,+1p"'), '2\n3\n');
  assert.equal(await s('"0,/2/d"'), '3\n4\n5\n');
  assert.equal(await s('-n "2!p" | head -2'), '1\n3\n');
  assert.equal(await s('-n "\\$="'), '5\n');
  assert.equal(await s('3q'), '1\n2\n3\n');
  assert.equal(await s('3Q'), '1\n2\n');
  assert.equal(await s('-n "/3/{p;p}"'), '3\n3\n');
  assert.equal(await s('-n "n;p"'), '2\n4\n');
  assert.equal(await s('"N;s/\\n/,/"'), '1,2\n3,4\n5\n');
  assert.equal(await s('":a;N;\\$!ba;s/\\n/ /g"'), '1 2 3 4 5\n');
  assert.equal(await s('"1!G;h;\\$!d"'), '5\n4\n3\n2\n1\n');
  assert.equal(await s('"\\$!N;P;D"', 'a\\na\\nb\\n'), 'a\na\nb\n');
  assert.equal(await s('"2i\\\\\nins" | head -3'), '1\nins\n2\n');
  assert.equal(await s('"1a appended" | head -2'), '1\nappended\n');
  assert.equal(await s('"2,4c changed"'), '1\nchanged\n5\n');
  assert.equal(await s('"y/abc/xyz/"', 'aabbcc\\n'), 'xxyyzz\n');
  assert.equal(await s('-n l', 'a\\tb\\n'), 'a\\tb$\n');
  assert.equal(await s('p', 'a\\nb'), 'a\na\nb\nb');
  const k = await sh('echo hi | sed k');
  assert.deepEqual([k.stderr, k.code], ["sed: -e expression #1, char 1: unknown command: `k'\n", 1]);
  assert.equal((await sh('echo hi | sed "s/a/b"')).stderr, "sed: -e expression #1, char 5: unterminated `s' command\n");
  const missing = await sh('sed p nosuch');
  assert.deepEqual([missing.stderr, missing.code], ["sed: can't read nosuch: No such file or directory\n", 2]);
});

test('sed substitution, -E, -i, w and branches', async () => {
  const s = (script: string, input: string) => out(`echo '${input}' | sed ${script}`);
  assert.equal(await s('"s/o/0/g"', 'hello world'), 'hell0 w0rld\n');
  assert.equal(await s('"s/o/0/2"', 'hello world'), 'hello w0rld\n');
  assert.equal(await s('"s/a/b/2g"', 'aaa'), 'abb\n');
  assert.equal(await s('"s/\\(h\\)\\(e\\)/\\2\\1/"', 'hello'), 'ehllo\n');
  assert.equal(await s('-E "s/(l+)/[\\1]/"', 'hello'), 'he[ll]o\n');
  assert.equal(await s('-r "s/(a|b)+/X/"', 'abc'), 'Xc\n');
  assert.equal(await s('"s/.*/\\U&/"', 'hello'), 'HELLO\n');
  assert.equal(await s('"s/\\w\\+/\\u&/g"', 'foo bar'), 'Foo Bar\n');
  assert.equal(await s('"s|/|_|g"', 'a/b/c'), 'a_b_c\n');
  assert.equal(await s('"s/b*/X/g"', 'abc'), 'XaXcX\n');
  assert.equal(await s('"s/x/a\\nb/"', 'x'), 'a\nb\n');
  assert.equal(await s('"s/HELLO/bye/I"', 'Hello'), 'bye\n');
  assert.equal(await s('"s/a+b/X/"', 'a+b'), 'X\n');
  assert.equal(await s('-n "s/x/y/p"', 'x'), 'y\n');
  assert.equal(await s('-e "s/foo/x/" -e "s/bar/y/"', 'foo bar'), 'x y\n');
  assert.equal(await s('"s/a/b/;tx;s/b/c/;:x;s/b/d/"', 'a'), 'd\n');
  assert.equal(await s('"s/z/y/;Tx;s/a/c/;:x;s/a/d/"', 'a'), 'd\n');
  assert.equal(await s('"s/[[:digit:]]\\{2\\}/N/"', 'a123'), 'aN3\n');
  assert.equal(await out('printf "test\\n\\tx\\n" | sed "s/^[ \\t]*//"'), 'test\nx\n');
  const run = await machine();
  assert.equal((await run("printf 'x\\n' > /tmp/s; sed -i 's/x/y/' /tmp/s; cat /tmp/s")).stdout, 'y\n');
  assert.equal((await run("sed -i.bak 's/y/z/' /tmp/s; cat /tmp/s /tmp/s.bak")).stdout, 'z\ny\n');
  assert.equal((await run("seq 3 > /tmp/m; sed -n -i '2p' /tmp/m; cat /tmp/m")).stdout, '2\n');
  assert.equal((await run("echo foo | sed 's/o/0/w /tmp/wout'; cat /tmp/wout")).stdout, 'f0o\nf0o\n');
  assert.equal((await run("printf 'a\\n' > /tmp/x1; printf 'b\\n' > /tmp/x2; sed -s -n '$p' /tmp/x1 /tmp/x2; sed -n '$p' /tmp/x1 /tmp/x2")).stdout, 'a\nb\nb\n');
  assert.equal((await run("echo ins > /tmp/r; seq 2 | sed '1r /tmp/r'")).stdout, '1\nins\n2\n');
});
