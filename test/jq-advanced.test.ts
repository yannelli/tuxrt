import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Runtime } from '../src/runtime.ts';
import { machine } from './helpers.ts';

const run = await machine();
const out = async (cmd: string, stdin?: string) => (await run(cmd, stdin)).stdout;

test('?// destructuring alternatives', async () => {
  assert.equal(await out(`jq -nc '[[1,2], {"a":3}] | .[] as [$x, $y] ?// {a: $x} | [$x, $y]'`), '[1,2]\n[3,null]\n');
  assert.equal(await out(`jq -nc '[[3]] | .[] as {a:$a} ?// [$a] | if $a == null then error("x") else $a end'`), '3\n');
  assert.match((await run(`jq -n '{} as [$a] ?// [$b] | $a'`)).stderr, /Cannot index object with number/);
});

test('input_line_number, pow10, modulemeta errors', async () => {
  assert.equal(await out(`jq -c '[., input_line_number]'`, '1\n2\n3\n'), '[1,1]\n[2,2]\n[3,3]\n');
  assert.equal(await out(`jq -n '2 | pow10'`), '100\n');
  assert.match((await run(`jq -n '1 | modulemeta'`)).stderr, /modulemeta input module not a string/);
});

test('number literals keep their form until modified', async () => {
  assert.equal(await out(`jq -c '., map(. + 0), (.[0] == 1)'`, '[1.000, 0.10, 1e2, 100000000000000000001]'), '[1.000,0.10,1E+2,100000000000000000001]\n[1,0.1,100,1e+20]\ntrue\n');
});

test('modules: import, include, data, search paths, ~/.jq', async () => {
  await run(`mkdir -p ~/.jq lib/util && printf 'module {name: "math"};\\ndef double: . * 2;\\ndef quad: double | double;\\n' > ~/.jq/mymath.jq`);
  await run(`printf 'import "helpers" as h;\\ndef tenfold: h::five * 2;\\n' > lib/util/util.jq && printf 'def five: . * 5;\\n' > lib/helpers.jq && printf '[1,2]\\n' > lib/table.json`);
  assert.equal(await out(`jq -c 'import "mymath" as m; [m::double, m::quad]'`, '3'), '[6,12]\n');
  assert.equal(await out(`jq 'include "mymath"; quad'`, '5'), '20\n');
  assert.equal(await out(`jq -L lib 'import "util" as u; u::tenfold'`, '3'), '30\n');
  assert.equal(await out(`jq -nc -L lib 'import "table" as $t; [$t, $t::t]'`), '[[[1,2]],[[1,2]]]\n');
  assert.equal(await out(`jq -nc '"mymath" | modulemeta'`), '{"name":"math","deps":[],"defs":["double/0","quad/0"]}\n');
  const missing = await run(`jq -n 'import "nope" as x; 1'`);
  assert.deepEqual([missing.code, missing.stderr], [3, 'jq: error: module not found: nope\njq: 1 compile error\n']);
  await run(`rm -r ~/.jq && printf 'def hello: "hi \\\\(.)";\\n' > ~/.jq`);
  assert.equal(await out(`jq hello`, '"you"'), '"hi you"\n');
});

test('input streams: endless producers, chunked values, line-buffered parsing', async () => {
  assert.equal(await out(`yes '{"a":1}' | jq -c .a | head -2`), '1\n1\n');
  assert.equal(await out(`yes 1 | jq -n 'first(inputs)'`), '1\n');
  assert.equal(await out(`seq 1000000000 | jq -R tonumber | head -3`), '1\n2\n3\n');
  const chunked = `{ printf '{"a":'; sleep 0.01; printf '"x\\\\ny"}\\n12'; sleep 0.01; printf '3 tr'; sleep 0.01; printf 'ue\\n'; }`;
  assert.equal(await out(`${chunked} | jq -c '[., input_line_number]'`), '[{"a":"x\\ny"},1]\n[123,2]\n[true,2]\n');
  assert.equal((await run(`printf '[1,2' | jq .`)).code, 2);
});

test('deep and tail recursion', async () => {
  assert.equal(await out(`jq -n 'def f: if . < 1000000 then .+1 | f else . end; 0 | f'`), '1000000\n');
  assert.equal(await out(`jq -n 'def f($n): if $n == 0 then 0 else 1 + f($n - 1) end; f(50000)'`), '50000\n');
});

test('Ctrl-C and kill stop silent infinite loops', async () => {
  const rt = await Runtime.boot();
  for (const filter of ['last(repeat(1))', '[range(1e12)] | length', 'def f: f; f']) {
    const started = Date.now();
    setTimeout(() => rt.interrupt(), 100);
    const r = await rt.exec(`jq -n '${filter}'`);
    assert.equal(r.code, 130, filter);
    assert.ok(Date.now() - started < 2000, `${filter} took ${Date.now() - started}ms`);
  }
  assert.equal((await rt.exec(`jq -n 'last(repeat(1))' & sleep 0.1; kill %1; wait; echo $?`)).stdout, '143\n');
});
