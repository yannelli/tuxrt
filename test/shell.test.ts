import assert from 'node:assert/strict';
import { test } from 'node:test';
import { machine, sh } from './helpers.ts';

const out = async (cmd: string, stdin?: string) => (await sh(cmd, stdin)).stdout;

test('expansions', async () => {
  assert.equal(await out('x=5; echo $((x*2)) ${x:-no} ${y:-def}'), '10 5 def\n');
  assert.equal(await out('echo a{b,c}d {1..3} {a..c}'), 'abd acd 1 2 3 a b c\n');
  assert.equal(await out('v=hello.tar.gz; echo ${v%.*} ${v%%.*} ${v#*.} ${#v} ${v/l/L} ${v//l/L} ${v^^}'), 'hello.tar hello tar.gz 12 heLlo.tar.gz heLLo.tar.gz HELLO.TAR.GZ\n');
  assert.equal(await out('echo "$(echo "nested $(echo deep)")"'), 'nested deep\n');
  assert.equal(await out("echo '$HOME' \"$HOME\" ~"), '$HOME /home/ubuntu /home/ubuntu\n');
  assert.equal(await out("echo $'a\\tb'"), 'a\tb\n');
  assert.equal(await out('a="1  2"; for w in $a; do echo "[$w]"; done'), '[1]\n[2]\n');
  assert.equal(await out('set -- "a b" c; for w in "$@"; do echo "[$w]"; done'), '[a b]\n[c]\n');
  assert.equal(await out('echo /etc/host*'), '/etc/hostname /etc/hosts\n');
  assert.equal(await out('echo "/etc/host*"'), '/etc/host*\n');
});

test('control flow', async () => {
  assert.equal(await out('for i in 1 2 3; do [ $i = 2 ] && continue; echo $i; done'), '1\n3\n');
  assert.equal(await out('i=0; while true; do i=$((i+1)); [ $i -ge 5 ] && break; done; echo $i'), '5\n');
  assert.equal(await out('i=0; until [ $i -eq 3 ]; do ((i++)) 2>/dev/null; i=$((i+1)); done; echo $i'), '3\n');
  assert.equal(await out('case hello.txt in *.md) echo md;; *.txt|*.text) echo text;; esac'), 'text\n');
  assert.equal(await out('if false; then echo a; elif true; then echo b; else echo c; fi'), 'b\n');
  assert.equal(await out('f() { local x=in; echo $x; return 4; }; x=out; f; echo $? $x'), 'in\n4 out\n');
  assert.equal(await out('true && echo y || echo n; false && echo y || echo n'), 'y\nn\n');
  assert.equal(await out('! false; echo $?'), '0\n');
  assert.equal(await out('[[ abc == a* && -d /tmp ]] && echo ok; [[ "a*" == "a*" ]] && echo lit'), 'ok\nlit\n');
  assert.equal(await out('[[ foo123 =~ ^[a-z]+([0-9]+)$ ]] && echo $BASH_REMATCH'), 'foo123\n');
});

test('redirection, pipes and heredocs', async () => {
  const run = await machine();
  assert.equal((await run('echo one > /tmp/f; echo two >> /tmp/f; read l < /tmp/f; echo $l')).stdout, 'one\n');
  assert.equal((await run('nosuch 2>/dev/null; echo $?')).stdout, '127\n');
  assert.equal((await run('{ echo out; nosuch; } 2>&1 | while read l; do echo "<$l>"; done')).stdout, '<out>\n<nosuch: command not found>\n');
  assert.equal((await run('cat_like() { while read -r l; do echo "$l"; done; }; cat_like <<EOF\nhi $USER\nEOF')).stdout, 'hi ubuntu\n');
  assert.equal((await run("x=1; read v <<'EOF'\n$x\nEOF\necho $v")).stdout, '$x\n');
  assert.equal((await run('echo "abc" | { read a; echo got $a; }')).stdout, 'got abc\n');
});

test('subshells and command substitution isolate state', async () => {
  assert.equal(await out('x=1; (x=2; cd /tmp); echo $x $PWD'), '1 /home/ubuntu\n');
  assert.equal(await out('x=$(exit 3); echo $?'), '3\n');
  assert.equal(await out('echo $(cd /etc; pwd) $(pwd)'), '/etc /home/ubuntu\n');
});

test('errors and exit codes', async () => {
  const r = await sh('nosuch arg');
  assert.equal(r.code, 127);
  assert.match(r.stderr, /nosuch: command not found/);
  assert.equal((await sh('echo "unterminated')).code, 2);
  assert.equal((await sh('exit 7')).code, 7);
  assert.equal((await sh('set -e; false; echo unreachable')).stdout, '');
  assert.equal((await sh('cd /nonexistent')).stderr, 'bash: cd: /nonexistent: No such file or directory\n');
});

test('aliases, functions and type', async () => {
  const run = await machine();
  await run("alias hi='echo hello'");
  assert.equal((await run('hi there')).stdout, 'hello there\n');
  assert.equal((await run('type hi')).stdout, "hi is aliased to `echo hello'\n");
  assert.equal((await run('greet() { echo "hey $1"; }; greet you')).stdout, 'hey you\n');
});

test('background jobs', async () => {
  const run = await machine();
  assert.equal((await run('{ echo bg; } & wait; echo done')).stdout, 'bg\ndone\n');
});
