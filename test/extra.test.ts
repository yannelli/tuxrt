import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { machine, sh } from './helpers.ts';

const out = async (cmd: string, stdin?: string) => (await sh(cmd, stdin)).stdout;

test('node: -e, -p, --version, argv', async () => {
  assert.equal(await out(`node -e 'console.log("hi", 1 + 1, { a: [1] })'`), 'hi 2 { a: [ 1 ] }\n');
  assert.equal(await out(`node -p '6 * 7'`), '42\n');
  assert.equal(await out(`node -pe '"str"'`), 'str\n');
  assert.equal(await out('node --version; nodejs -v'), 'v22.11.0\nv22.11.0\n');
  assert.equal(await out(`node -e 'console.log(process.argv.join(" "))' a b`), '/usr/bin/node a b\n');
  assert.equal(await out(`node -p 'process.platform + " " + require("os").type() + " " + require("os").hostname()'`), 'linux Linux ubuntu\n');
});

test('node: scripts from the VFS with fs, relative modules and JSON', async () => {
  const run = await machine();
  await run(`printf 'module.exports = { add: (a, b) => a + b };\\n' > lib.js; printf '{"name": "demo", "n": 3}' > data.json`);
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const { add } = require("./lib");',
    'const data = require("./data.json");',
    'fs.mkdirSync("out/deep", { recursive: true });',
    'fs.writeFileSync("out/deep/r.txt", `${data.name}:${add(data.n, 4)}`);',
    'console.log(fs.readFileSync("out/deep/r.txt", "utf8"), process.argv.slice(2).join(","), __filename);',
    'console.log(fs.readdirSync("out", { recursive: true }).join(" "), fs.statSync("out").isDirectory(), fs.existsSync("nope"));',
    'process.exitCode = 7;',
  ].join('\n');
  await run(`cat > main.js <<'EOF'\n${script}\nEOF`);
  const r = await run('node main.js x y; echo "code=$?"; read l < out/deep/r.txt; echo "$l"');
  assert.equal(r.stdout, 'demo:7 x,y /home/ubuntu/main.js\ndeep deep/r.txt true false\ncode=7\ndemo:7\n');
  const exec = await run(`node -e 'require("fs").chmodSync("main.js", 0o755)' && ./main.js q`);
  assert.equal(exec.stdout.split('\n')[0], 'demo:7 q /home/ubuntu/main.js');
  assert.equal(exec.code, 7);
});

test('node: errors, exit codes and uncaught exceptions', async () => {
  assert.equal(await out(`node -e 'process.exit(3); console.log("no")'; echo $?`), '3\n');
  const thrown = await sh(`node -e 'throw new Error("boom")'`);
  assert.equal(thrown.code, 1);
  assert.match(thrown.stderr, /^\[eval\]:1\nthrow new Error\("boom"\)\n/);
  assert.match(thrown.stderr, /Error: boom\n {4}at \[eval\]:1:7\n\nNode\.js v22\.11\.0\n$/);
  const enoent = await sh(`node -e 'require("fs").readFileSync("/nope")'`);
  assert.match(enoent.stderr, /Error: ENOENT: no such file or directory, open '\/nope'/);
  assert.match(enoent.stderr, /errno: -2,\n {2}code: 'ENOENT',\n {2}syscall: 'open',\n {2}path: '\/nope'/);
  assert.equal(await out(`node -e 'try { require("fs").readFileSync("/x") } catch (e) { console.log(e instanceof Error, e.code) }'`), 'true ENOENT\n');
  const denied = await sh(`node -e 'require("fs").writeFileSync("/etc/passwd", "x")'`);
  assert.match(denied.stderr, /EACCES: permission denied, open '\/etc\/passwd'/);
  const missing = await sh('node nope.js');
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Cannot find module '\/home\/ubuntu\/nope\.js'/);
  const syntax = await sh(`node -e 'x = ;'`);
  assert.match(syntax.stderr, /^\[eval\]:1\nx = ;\n {4}\^\n\nSyntaxError: Unexpected token ';'/);
  assert.equal((await sh('node --bogus')).code, 9);
});

test('node: event loop ordering, timers and top-level await', async () => {
  const order = `setTimeout(() => console.log("t2"), 20); setTimeout(() => console.log("t1"), 5);
    setImmediate(() => console.log("immediate")); Promise.resolve().then(() => console.log("micro"));
    process.nextTick(() => console.log("tick")); console.log("sync")`;
  assert.equal(await out(`node -e '${order}'`), 'sync\ntick\nmicro\nimmediate\nt1\nt2\n');
  assert.equal(await out(`node -e 'const v = await new Promise((r) => setTimeout(() => r(5), 5)); console.log(v)'`), '5\n');
  const interval = `let n = 0; const iv = setInterval(() => { console.log(++n); if (n === 3) clearInterval(iv); }, 1)`;
  assert.equal(await out(`node -e '${interval}'`), '1\n2\n3\n');
  assert.equal(await out(`node -e 'setTimeout(() => console.log("never"), 1e6).unref(); console.log("done")'`), 'done\n');
  const timerThrow = await sh(`node -e 'setTimeout(() => { throw new TypeError("late") }, 1)'`);
  assert.equal(timerThrow.code, 1);
  assert.match(timerThrow.stderr, /TypeError: late/);
  assert.equal(await out(`node -e 'process.on("exit", (c) => console.log("exit", c)); process.exitCode = 4'; echo $?`), 'exit 4\n4\n');
});

test('node: stdin, child_process and ESM syntax', async () => {
  assert.equal(await out(`node -e 'process.stdin.on("data", (d) => process.stdout.write("got:" + d))'`, 'hello\n'), 'got:hello\n');
  const rl = `const rl = require("readline").createInterface({ input: process.stdin }); let n = 0;
    rl.on("line", (l) => (n += Number(l))); rl.on("close", () => console.log("sum", n))`;
  assert.equal(await out(`node -e '${rl}'`, '1\n2\n3\n'), 'sum 6\n');
  assert.equal(await out(`node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).a'`, '{"a": 42}'), '42\n');
  assert.equal(await out('node', 'console.log("from stdin", __filename)\n'), 'from stdin [stdin]\n');
  const execCode = `const { exec } = require("child_process"); exec("echo hi; pwd", (err, stdout) => console.log(JSON.stringify(stdout), err))`;
  assert.equal(await out(`node -e '${execCode}'`), '"hi\\n/home/ubuntu\\n" null\n');
  const promisified = `const exec = require("util").promisify(require("child_process").exec);
    try { await exec("exit 3") } catch (e) { console.log("failed", e.code) }`;
  assert.equal(await out(`node -e '${promisified}'`), 'failed 3\n');
  assert.match((await sh(`node -e 'require("child_process").execSync("ls")'`)).stderr, /execSync is not supported in tuxrt/);
  const repl = await out('node -i', '1 + 1\nconst o = { a: 1 }\no.a\nnope\n.exit\n');
  assert.equal(repl, 'Welcome to Node.js v22.11.0.\nType ".help" for more information.\n> 2\n> undefined\n> 1\n> Uncaught ReferenceError: nope is not defined\n> ');
  const run = await machine();
  await run(`printf 'export const v = 5;\\nexport default function hi() { return "hi"; }\\n' > m.mjs`);
  await run(`printf 'import hi, { v } from "./m.mjs";\\nconsole.log(hi(), v);\\n' > use.mjs`);
  assert.equal((await run('node use.mjs')).stdout, 'hi 5\n');
});

const COW = String.raw`        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
`;

test('cowsay and cowthink are preinstalled', async () => {
  assert.equal(await out('cowsay hi'), ` ____\n< hi >\n ----\n${COW}`);
  assert.equal(await out('printf "hello world\\nsecond line\\n" | cowsay'), ` _____________\n/ hello world \\\n\\ second line /\n -------------\n${COW}`);
  assert.equal((await out('cowsay -W 10 the quick brown fox jumps')).split('\n').slice(0, 5).join('\n'), ' ___________\n/ the quick \\\n| brown fox |\n\\ jumps     /\n -----------');
  assert.match(await out('cowsay -e ^^ -T U! hi'), /\(\^\^\)\\_______\n[^]*\n {13}U! \|\|----w \|\n/);
  assert.match(await out('cowsay -f tux hi'), /_\.-\._\n {7}\/ o o \\\n/);
  assert.deepEqual(await sh('cowsay -f nope hi'), { stdout: '', stderr: 'cowsay: Could not find nope cowfile!\n', code: 1 });
  assert.equal((await out('printf "a\\nbb\\n" | cowthink')).split('\n').slice(0, 5).join('\n'), ' ____\n( a  )\n( bb )\n ----\n        o   ^__^');
});

test('apt: permissions, install, gated commands and dpkg', async () => {
  const user = await machine();
  const denied = await user('apt install -y figlet');
  assert.equal(denied.code, 100);
  assert.match(denied.stderr, /E: Could not open lock file \/var\/lib\/dpkg\/lock-frontend - open \(13: Permission denied\)\nE: Unable to acquire the dpkg frontend lock \(\/var\/lib\/dpkg\/lock-frontend\), are you root\?\n$/);
  assert.deepEqual(await user('figlet hi'), { stdout: '', stderr: "Command 'figlet' not found, but can be installed with:\n\nsudo apt install figlet\n", code: 127 });
  const list = await user('apt list --installed 2>/dev/null');
  assert.match(list.stdout, /^bash\/noble,now \S+ amd64 \[installed\]$/m);
  assert.match(list.stdout, /^cowsay\/noble,now 3\.03\+dfsg2-8 all \[installed\]$/m);
  assert.match((await user('dpkg -l cowsay')).stdout, /^ii {2}cowsay +3\.03\+dfsg2-8 +all +configurable talking cow$/m);

  const root = await machine('root');
  const install = await root('apt install -y figlet');
  assert.equal(install.code, 0);
  assert.match(install.stdout, /Setting up figlet \(2\.2\.5-3\) \.\.\./);
  assert.equal((await root('figlet hi')).stdout, '#   # ###\n#   #  #\n#####  #\n#   #  #\n#   # ###\n');
  assert.match((await root('apt-get install cowsay')).stdout, /^cowsay is already the newest version \(3\.03\+dfsg2-8\)\.$/m);
  assert.equal((await root('apt install nosuchpkg')).code, 100);
  assert.equal((await root('apt remove -y cowsay')).code, 0);
  assert.equal((await root('cowsay hi')).stderr, 'cowsay: command not found\n');
  assert.equal((await root('apt install -y cowsay && cowsay hi')).stdout.endsWith(COW), true);
});

test('curl and wget error paths (no network)', async () => {
  assert.deepEqual(await sh('curl http://nonexistent.invalid'), { stdout: '', stderr: 'curl: (6) Could not resolve host: nonexistent.invalid\n', code: 6 });
  assert.deepEqual(await sh('curl -s http://nonexistent.invalid'), { stdout: '', stderr: '', code: 6 });
  assert.equal((await sh('curl -sS -w "%{http_code}" nonexistent.invalid')).stdout, '000');
  assert.equal((await sh('curl ftp://example.invalid/f')).stderr, 'curl: (1) Protocol "ftp" not supported\n');
  assert.equal((await sh('curl')).code, 2);
  const wget = await sh('wget http://nonexistent.invalid/');
  assert.equal(wget.code, 4);
  assert.match(wget.stderr, /wget: unable to resolve host address ‘nonexistent\.invalid’\n$/);
  assert.equal((await sh('wget')).stderr, "wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options.\n");
});

// A loopback server owned by the test, so HTTP behavior is checked without internet access.
let server: Server;
let base = '';
before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: string, extra: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body), ...extra });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      if (req.url === '/hello') send(200, 'hello\n');
      else if (req.url === '/echo') send(200, JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString() }));
      else if (req.url === '/redirect') send(302, 'moved\n', { Location: '/hello' });
      else send(404, 'nope\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test('curl and wget against a loopback server', async () => {
  const run = await machine();
  assert.equal((await run(`curl ${base}/hello`)).stdout, 'hello\n');
  assert.deepEqual(await run(`curl -sSo out.txt ${base}/hello && cat out.txt`), { stdout: 'hello\n', stderr: '', code: 0 });
  assert.match((await run(`curl -si ${base}/hello`)).stdout, /^HTTP\/1\.1 200 OK\r\n[^]*\r\n\r\nhello\n$/);
  assert.match((await run(`curl -sI ${base}/hello`)).stdout, /content-length: 6\r\n/);
  assert.equal((await run(`curl -s -o /dev/null -w '%{http_code}' ${base}/missing`)).stdout, '404');
  assert.deepEqual(await run(`curl -f ${base}/missing`), { stdout: '', stderr: 'curl: (22) The requested URL returned error: 404\n', code: 22 });
  assert.equal((await run(`curl -s ${base}/redirect`)).stdout, '');
  assert.equal((await run(`curl -sL ${base}/redirect`)).stdout, 'hello\n');
  assert.deepEqual(JSON.parse((await run(`curl -s -d a=1 -d b=2 ${base}/echo`)).stdout), { method: 'POST', body: 'a=1&b=2' });
  const saved = await run(`cd /tmp && wget ${base}/hello && wget -q ${base}/hello && cat hello hello.1`);
  assert.equal(saved.stdout, 'hello\nhello\n');
  assert.match(saved.stderr, /HTTP request sent, awaiting response\.\.\. 200 OK\nLength: 6 \[text\/plain\]\nSaving to: ‘hello’\n/);
  assert.deepEqual(await run(`wget -qO- ${base}/hello`), { stdout: 'hello\n', stderr: '', code: 0 });
  assert.equal((await run(`wget ${base}/missing`)).code, 8);
});

const TREE =
  'mkdir -p dir/sub && printf "hello\\n" > dir/a.txt && printf "#!/bin/sh\\necho hi\\n" > dir/sub/run.sh && ' +
  'chmod 600 dir/a.txt && chmod 755 dir/sub/run.sh && ln -s a.txt dir/link && touch -d "2024-10-19 12:00" dir/a.txt';

test('gzip, gunzip and zcat', async () => {
  const run = await machine();
  await run('printf "hello hello hello\\ncafé\\n" > f && chmod 640 f');
  assert.equal((await run('gzip -k f && ls f f.gz && zcat f.gz')).stdout, 'f\nf.gz\nhello hello hello\ncafé\n');
  assert.equal((await run('rm f && gunzip f.gz && cat f && stat -c %a f')).stdout, 'hello hello hello\ncafé\n640\n');
  assert.equal((await run('gzip -c f | gunzip')).stdout, 'hello hello hello\ncafé\n');
  assert.deepEqual(await run('gzip nope'), { stdout: '', stderr: 'gzip: nope: No such file or directory\n', code: 1 });
  assert.deepEqual(await run('cp f f.gz && gunzip f.gz'), { stdout: '', stderr: 'gzip: f.gz: not in gzip format\n', code: 1 });
});

test('tar: ustar round trip, listing and pipes', async () => {
  const run = await machine();
  await run(TREE);
  assert.equal((await run('tar czf a.tgz dir && mkdir /tmp/x && tar xzf a.tgz -C /tmp/x')).code, 0);
  assert.equal((await run('cat /tmp/x/dir/a.txt && /tmp/x/dir/sub/run.sh && readlink /tmp/x/dir/link')).stdout, 'hello\nhi\na.txt\n');
  assert.equal((await run('stat -c "%a %n" /tmp/x/dir/a.txt /tmp/x/dir/sub/run.sh')).stdout, '600 /tmp/x/dir/a.txt\n755 /tmp/x/dir/sub/run.sh\n');
  assert.equal((await run('tar -tzf a.tgz')).stdout, 'dir/\ndir/a.txt\ndir/link\ndir/sub/\ndir/sub/run.sh\n');
  assert.equal((await run('tar tvzf a.tgz')).stdout.split('\n')[1], '-rw------- ubuntu/ubuntu     6 2024-10-19 12:00 dir/a.txt');
  assert.equal((await run('tar cf f.tar dir/a.txt && wc -c < f.tar')).stdout.trim(), '10240');
  assert.match((await run('printf "café\\n" > c.txt && tar cf c.tar c.txt && tar tvf c.tar')).stdout, / {5}6 .* c\.txt\n$/);
  assert.equal((await run('mkdir /tmp/y && tar cf - dir | tar xvf - -C /tmp/y')).stdout, 'dir/\ndir/a.txt\ndir/link\ndir/sub/\ndir/sub/run.sh\n');
  assert.deepEqual(await run('tar cf b.tar dir nope'), {
    stdout: '',
    stderr: 'tar: nope: Cannot stat: No such file or directory\ntar: Exiting with failure status due to previous errors\n',
    code: 2,
  });
  assert.equal((await run('echo garbage > g.tar && tar tf g.tar')).stderr, 'tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n');
});

test('zip and unzip round trip a directory tree', async () => {
  const run = await machine();
  await run(TREE);
  const zip = await run('zip -r out dir');
  assert.match(zip.stdout, /^ {2}adding: dir\/ \(stored 0%\)\n/);
  const unzip = await run('unzip out.zip -d /tmp/u');
  assert.match(unzip.stdout, /^Archive: {2}out\.zip\n {3}creating: \/tmp\/u\/dir\/\n/);
  assert.equal((await run('cat /tmp/u/dir/a.txt /tmp/u/dir/sub/run.sh')).stdout, 'hello\n#!/bin/sh\necho hi\n');
  assert.equal((await run('stat -c %a /tmp/u/dir/a.txt /tmp/u/dir/sub/run.sh')).stdout, '600\n755\n');
  assert.match((await run('unzip -l out.zip')).stdout, /^ {8}6 {2}2024-10-19 12:00 {3}dir\/a\.txt$/m);
  assert.equal((await run('echo local > dir/a.txt && unzip -q out.zip && cat dir/a.txt && unzip -qo out.zip && cat dir/a.txt')).stdout, 'local\nhello\n');
  assert.deepEqual(await run('unzip nope'), { stdout: '', stderr: 'unzip:  cannot find or open nope, nope.zip or nope.ZIP.\n', code: 9 });
});
