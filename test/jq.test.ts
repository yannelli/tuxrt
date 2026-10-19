import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { machine } from './helpers.ts';

let run: Awaited<ReturnType<typeof machine>>;
before(async () => {
  run = await machine('root');
  await run('apt install -y jq >/dev/null 2>&1');
});

const out = async (cmd: string, stdin?: string) => (await run(cmd, stdin)).stdout;
const jqc = (filter: string, stdin?: string) => out(`jq -c '${filter}'`, stdin);
const jqn = (filter: string) => out(`jq -nc '${filter}'`);

test('pretty, compact, raw and sorted output', async () => {
  assert.equal(await out('jq .', '{"a":1,"b":[1,2],"c":{},"d":[]}'), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {},\n  "d": []\n}\n');
  assert.equal(await out('jq', '{"a":1}'), '{\n  "a": 1\n}\n');
  assert.equal(await out('jq -c .', '{"a": [1, {"b": null}]}'), '{"a":[1,{"b":null}]}\n');
  assert.equal(await out("jq -r '.[]'", '["a","b",1]'), 'a\nb\n1\n');
  assert.equal(await out("jq -j '.[]'", '["a","b"]'), 'ab');
  assert.equal(await out('jq -S -c .', '{"b":1,"a":{"d":1,"c":2}}'), '{"a":{"c":2,"d":1},"b":1}\n');
  assert.equal(await out('jq --tab .', '[1]'), '[\n\t1\n]\n');
  assert.equal(await out('jq --indent 1 .', '{"a":[1]}'), '{\n "a": [\n  1\n ]\n}\n');
  assert.equal(await out('jq --indent 0 .', '{"a":[1]}'), '{"a":[1]}\n');
  assert.equal(await out('jq -a .', '"é☃😀"'), '"\\u00e9\\u2603\\ud83d\\ude00"\n');
  assert.equal(await out('jq --seq -c .', '1'), '\x1e1\n');
  assert.equal(await out("jq --raw-output0 '.[]'", '["a","b"]'), 'a\0b\0');
  assert.equal(await out('jq .', '"a\\u0000\\u001f\\u007f\\/"'), '"a\\u0000\\u001f\\u007f/"\n');
  assert.equal(await out('jq -C .', '{"a":null}'), '\x1b[1;39m{\n  \x1b[0m\x1b[34;1m"a"\x1b[0m\x1b[1;39m: \x1b[0m\x1b[1;30mnull\x1b[0m\x1b[1;39m\n\x1b[1;39m}\x1b[0m\n');
});

test('number formatting', async () => {
  assert.equal(await jqn('1e100, 1.5, 0.00001, 3.0, -0, 1e17, 100000000000000000000, 0.1 + 0.2'), '1e+100\n1.5\n1e-05\n3\n-0\n1e+17\n100000000000000000000\n0.30000000000000004\n');
  assert.equal(await out('jq -c ". , . + 1"', '12345678901234567890'), '12345678901234567890\n12345678901234567000\n');
  assert.equal(await jqn('[nan, infinite, -infinite]'), '[null,1.7976931348623157e+308,-1.7976931348623157e+308]\n');
});

test('multiple inputs, slurp, null and raw input', async () => {
  assert.equal(await out('jq -c .', '1 2\n[3]'), '1\n2\n[3]\n');
  assert.equal(await out('jq -sc .', '1 2 3'), '[1,2,3]\n');
  assert.equal(await out('jq -R .', 'a\nb\n'), '"a"\n"b"\n');
  assert.equal(await out('jq -Rs .', 'a\nb\n'), '"a\\nb\\n"\n');
  assert.equal(await out("jq -nc '[inputs]'", '1 2 3'), '[1,2,3]\n');
  assert.equal(await out("jq -c '[., input]'", '1 2 3 4'), '[1,2]\n[3,4]\n');
  assert.equal(await out("jq -n 'input'", '7 8'), '7\n');
  assert.equal(await out('jq -c --stream .', '{"a":[1,2]}'), '[["a",0],1]\n[["a",1],2]\n[["a",1]]\n[["a"]]\n');
  await run(`echo '{"a":1}' > /tmp/1.json; echo 2 > /tmp/2.json`);
  assert.equal(await out('jq -c . /tmp/1.json /tmp/2.json'), '{"a":1}\n2\n');
  assert.equal(await out('jq -sc . /tmp/1.json /tmp/2.json'), '[{"a":1},2]\n');
  assert.equal(await out('jq input_filename /tmp/2.json'), '"/tmp/2.json"\n');
});

test('variables and arguments', async () => {
  assert.equal(await out("jq -n --arg x hi --argjson y '{\"a\":1}' -c '[$x, $y.a]'"), '["hi",1]\n');
  assert.equal(await out("jq -nc --args '$ARGS' a b"), '{"positional":["a","b"],"named":{}}\n');
  assert.equal(await out("jq -nc --jsonargs '$ARGS.positional' 1 '{\"a\":2}'"), '[1,{"a":2}]\n');
  assert.equal(await out("jq -nc --arg a 1 '$ARGS.named'"), '{"a":"1"}\n');
  await run(`echo '1 2' > /tmp/s.json; printf 'hi\\n' > /tmp/r.txt; echo '.a + 1' > /tmp/p.jq`);
  assert.equal(await out("jq -nc --slurpfile s /tmp/s.json --rawfile r /tmp/r.txt '[$s, $r]'"), '[[1,2],"hi\\n"]\n');
  assert.equal(await out('jq -f /tmp/p.jq', '{"a":1}'), '2\n');
  assert.equal(await out("jq -n '$ENV.HOME, env.HOME'"), '"/root"\n"/root"\n');
  assert.equal(await jqn('$__loc__'), '{"file":"<top-level>","line":1}\n');
});

test('paths, iteration, slices and optional access', async () => {
  assert.equal(await jqc('.a.b, .a["b"], ."a".b, .x.y', '{"a":{"b":1}}'), '1\n1\n1\nnull\n');
  assert.equal(await jqc('.[0], .[-1], .[5], .[1:], .[:-1], .[-2:]', '[1,2,3]'), '1\n3\nnull\n[2,3]\n[1,2]\n[2,3]\n');
  assert.equal(await jqc('.[2:4], .[1:2.5]', '"abcdef"'), '"cd"\n"bc"\n');
  assert.equal(await jqc('[.[]], [.[]?], [..]', '{"a":[1]}'), '[[1]]\n[[1]]\n[{"a":[1]},[1],1]\n');
  assert.equal(await jqc('[.[]?], [.a?], (try .a catch "c")', '1'), '[]\n[]\n"c"\n');
  assert.equal(await jqc('.a.[0], .["a"][1]', '{"a":[5,6]}'), '5\n6\n');
});

test('operators and precedence', async () => {
  assert.equal(await jqn('1 + 2 * 3, (1 + 2) * 3, 10 / 4, 7 % 3, -7 % 3, -(1 + 2)'), '7\n9\n2.5\n1\n-1\n-3\n');
  assert.equal(await jqn('[1,2,2] - [2], {a:1} + {b:2}, {a:{x:1}} * {a:{y:2}}, "ab" * 2, "a,b" / ",", null + 1'), '[1]\n{"a":1,"b":2}\n{"a":{"x":1,"y":2}}\n"abab"\n["a","b"]\n1\n');
  assert.equal(await jqn('[(1,2) + (10,20)]'), '[11,12,21,22]\n');
  assert.equal(await jqn('1 < 2, "a" < "b", [] < {}, null < false, {a:1} == {a:1}, 1 != 1'), 'true\ntrue\ntrue\ntrue\ntrue\nfalse\n');
  assert.equal(await jqn('true and false, true or error, (null // 1), ((1, null, 2) // 3), (empty // 4), [false // false]'), 'false\ntrue\n1\n1\n2\n4\n[false]\n');
  assert.equal(await jqn('[null, true, false, 0, -1, "a", "B", [], {}] | sort'), '[null,false,true,-1,0,"B","a",[],{}]\n');
});

test('literals, strings, objects and conditionals', async () => {
  assert.equal(await jqn('"x\\(1 + 1)y", "\\(1,2)-\\(3,4)"'), '"x2y"\n"1-3"\n"2-3"\n"1-4"\n"2-4"\n');
  assert.equal(await jqc('{a, b: .c, "d": 1, (.k): 2, $__loc__, "e f": 3}', '{"a":0,"c":4,"k":"key"}'), '{"a":0,"b":4,"d":1,"key":2,"__loc__":{"file":"<top-level>","line":1},"e f":3}\n');
  assert.equal(await jqn('1 as $x | {$x, if: 2, "a\\(1)": 3}'), '{"x":1,"if":2,"a1":3}\n');
  assert.equal(await jqn('{a: (1,2), b: (3,4)} | [.a, .b]'), '[1,3]\n[1,4]\n[2,3]\n[2,4]\n');
  assert.equal(await jqn('if 1 > 2 then "a" elif 2 > 1 then "b" else "c" end, (if false then 1 end), [.[]?]'), '"b"\nnull\n[]\n');
  assert.equal(await jqn('[null, [3]] | .[] as [$a] | $a'), 'null\n3\n');
});

test('functions, reduce, foreach, label and recursion', async () => {
  assert.equal(await jqn('def f: . * 2; def g(x): x + 1; def h($a; $b): $a - $b; [3 | f, g(10), h(5; 2)]'), '[6,11,3]\n');
  assert.equal(await jqn('def fac: if . <= 1 then 1 else . * (. - 1 | fac) end; [range(1; 6) | fac]'), '[1,2,6,24,120]\n');
  assert.equal(await jqn('def f(g): [g, g]; f(1, 2)'), '[1,2,1,2]\n');
  assert.equal(await jqn('def f: def g: 3; g * 2; f'), '6\n');
  assert.equal(await jqn('reduce range(5) as $x (0; . + $x), [foreach (1,2,3) as $x (0; . + $x; [$x, .])]'), '10\n[[1,1],[2,3],[3,6]]\n');
  assert.equal(await jqn('reduce ([1,2],[3,4]) as [$a, $b] (0; . + $a * $b)'), '14\n');
  assert.equal(await jqn('{"a":{"b":[5]}} as {a: {b: [$x]}} | $x, ({k: 1} as {$k} | $k)'), '5\n1\n');
  assert.equal(await jqn('[label $out | 1, 2, break $out, 3]'), '[1,2]\n');
  assert.equal(await jqn('def r: if . < 1000 then . + 1 | r else . end; 0 | r'), '1000\n');
});

test('assignment operators', async () => {
  assert.equal(await jqc('.a = 1, .b.c = 2, .a |= . + 1, .a += 10, .a -= 1, .a *= 3, .a /= 2, .a %= 2, .z //= 9', '{"a":1}'),
    '{"a":1}\n{"a":1,"b":{"c":2}}\n{"a":2}\n{"a":11}\n{"a":0}\n{"a":3}\n{"a":0.5}\n{"a":1}\n{"a":1,"z":9}\n');
  assert.equal(await jqc('.[] |= . * 2, (.[1:] = ["x"]), (.[0] |= empty), map_values(. + 1)', '[1,2,3]'), '[2,4,6]\n[1,"x"]\n[2,3]\n[2,3,4]\n');
  assert.equal(await jqc('(.a[] | select(. > 1)) |= 0, .c[2] = 1', '{"a":[1,2,3]}'), '{"a":[1,0,0]}\n{"a":[1,2,3],"c":[null,null,1]}\n');
  assert.equal(await jqn('{} | .a = (1, 2)'), '{"a":1}\n{"a":2}\n');
});

test('path builtins', async () => {
  const doc = '{"a":[1,{"b":2}],"c":null}';
  assert.equal(await jqc('[paths], [leaf_paths], [paths(type == "number")]', doc),
    '[["a"],["a",0],["a",1],["a",1,"b"],["c"]]\n[["a",0],["a",1,"b"]]\n[["a",0],["a",1,"b"]]\n');
  assert.equal(await jqc('path(.a[1].b), ([path(..)] | length)', doc), '["a",1,"b"]\n6\n');
  assert.equal(await jqc('del(.a[0], .c), del(.. | nulls), delpaths([["a"]])', doc), '{"a":[{"b":2}]}\n{"a":[1,{"b":2}]}\n{"c":null}\n');
  assert.equal(await jqc('getpath(["a",1,"b"]), getpath(["x","y"]), setpath(["a",0]; 9), pick(.a[1].b)', doc),
    '2\nnull\n{"a":[9,{"b":2}],"c":null}\n{"a":[null,{"b":2}]}\n');
  assert.equal(await jqc('[tostream], fromstream(tostream)', '{"a":[1,2]}'), '[[["a",0],1],[["a",1],2],[["a",1]],[["a"]]]\n{"a":[1,2]}\n');
  assert.equal(await jqc('to_entries, with_entries(.value += 1), (to_entries | from_entries)', '{"a":1,"b":2}'),
    '[{"key":"a","value":1},{"key":"b","value":2}]\n{"a":2,"b":3}\n{"a":1,"b":2}\n');
  assert.equal(await jqn('[{name:"a",value:1},{k:"b",v:2}] | from_entries'), '{"a":1,"b":2}\n');
});

test('collection builtins', async () => {
  assert.equal(await jqc('length, keys, keys_unsorted, has("b"), [.[]], add, any, all, map(. > 1)', '{"b":2,"a":1}'),
    '2\n["a","b"]\n["b","a"]\ntrue\n[2,1]\n3\ntrue\ntrue\n[true,false]\n');
  assert.equal(await jqc('sort, sort_by(-.), min, max, unique, reverse, add, length, flatten', '[3,1,2,1]'),
    '[1,1,2,3]\n[3,2,1,1]\n1\n3\n[1,2,3]\n[1,2,1,3]\n7\n4\n[3,1,2,1]\n');
  const rows = '[{"a":2,"b":"x"},{"a":1,"b":"y"},{"a":2,"b":"z"}]';
  assert.equal(await jqc('group_by(.a), unique_by(.a), min_by(.a), max_by(.a), (map(.a) | add)', rows),
    '[[{"a":1,"b":"y"}],[{"a":2,"b":"x"},{"a":2,"b":"z"}]]\n[{"a":1,"b":"y"},{"a":2,"b":"x"}]\n{"a":1,"b":"y"}\n{"a":2,"b":"z"}\n5\n');
  assert.equal(await jqn('[1,[2,[3,[4]]]] | flatten(1), flatten'), '[1,2,[3,[4]]]\n[1,2,3,4]\n');
  assert.equal(await jqn('[1,2,1] | indices(1), index(1), rindex(1), indices([2,1])'), '[0,2]\n0\n2\n[1]\n');
  assert.equal(await jqn('[1,[2]] | contains([[2]]), inside([1,[2],3]), ("a" | in({"a":1})), ("foobar" | contains("bar"))'), 'true\ntrue\ntrue\ntrue\n');
  assert.equal(await jqn('[range(3)], [range(1;3)], [range(0;10;4)], [range(3;0;-1)], [limit(2; range(9))], first(range(5;9))'),
    '[0,1,2]\n[1,2]\n[0,4,8]\n[3,2,1]\n[0,1]\n5\n');
  assert.equal(await jqn('[1,2,3] | first, last, nth(1), ([.[] | select(. % 2 == 1)]), IN(2), (.[] | IN(2,3))'), '1\n3\n2\n[1,3]\nfalse\nfalse\ntrue\ntrue\n');
  assert.equal(await jqn('[1 | until(. > 50; . * 3)], [1 | while(. < 50; . * 3)], [limit(3; 1 | repeat(. * 2))], [2 | recurse(if . < 20 then . * . else empty end)]'),
    '[81]\n[1,3,9,27]\n[1,2,4]\n[2,4,16,256]\n');
  assert.equal(await jqn('[[1,2],[3,4]] | transpose, [combinations], ([{id:1}] | INDEX(.id)), isempty(empty)'), '[[1,3],[2,4]]\n[[1,3],[1,4],[2,3],[2,4]]\n{"1":{"id":1}}\ntrue\n');
  assert.equal(await jqn('{a:{b:1}} | walk(if type == "number" then . + 1 else . end), [.. | numbers]'), '{"a":{"b":2}}\n[1]\n');
  assert.equal(await out("jq -c '[.[] | numbers], [.[] | strings], [.[] | iterables], [.[] | scalars], [.[] | values]'", '[1,"a",null,[],{}]'),
    '[1]\n["a"]\n[[],{}]\n[1,"a",null]\n[1,"a",[],{}]\n');
});

test('string builtins and formats', async () => {
  assert.equal(await jqn('"a,b" | split(","), ("abc" | explode), ([97,98] | implode), (["a",1,null,true] | join("-"))'), '["a","b"]\n[97,98,99]\n"ab"\n"a-1--true"\n');
  assert.equal(await jqn('"abc" | ltrimstr("a"), rtrimstr("c"), startswith("ab"), endswith("x"), ascii_upcase, ("  x " | trim)'), '"bc"\n"ab"\ntrue\nfalse\n"ABC"\n"x"\n');
  assert.equal(await jqn('"é😀" | length, utf8bytelength, .[1:]'), '2\n6\n"😀"\n');
  assert.equal(await jqn('[1,"1",[1]] | map(tostring), map(tojson), ("[1,2]" | fromjson), ("12" | tonumber), (1 | type)'), '["1","1","[1]"]\n["1","\\"1\\"","[1]"]\n[1,2]\n12\n"number"\n');
  assert.equal(await out("jq -r '@csv, @tsv, @sh, @json, @text, @html'", '[1,"a,\\"b\\"",null,true,"it\'s <x>\\t"]'),
    '1,"a,""b""",,true,"it\'s <x>\t"\n1\ta,"b"\t\ttrue\tit\'s <x>\\t\n1 \'a,"b"\' null true \'it\'\\\'\'s <x>\t\'\n[1,"a,\\"b\\"",null,true,"it\'s <x>\\t"]\n[1,"a,\\"b\\"",null,true,"it\'s <x>\\t"]\n[1,&quot;a,\\&quot;b\\&quot;&quot;,null,true,&quot;it&#39;s &lt;x&gt;\\t&quot;]\n');
  assert.equal(await out("jq -r '@base64, (@base64 | @base64d), @base32, (@base32 | @base32d), @uri'", '"a b/é"'), 'YSBiL8Op\na b/é\nMEQGEL6DVE======\na b/é\na%20b%2F%C3%A9\n');
  assert.equal(await jqn('@base64 "x\\("hi")y", @json "v=\\([1])"'), '"xaGk=y"\n"v=[1]"\n');
});

test('regular expressions', async () => {
  assert.equal(await jqn('"test 123 abc" | test("\\\\d+"), test("ABC"; "i"), [match("[a-z]+"; "g") | .string], (match("(\\\\d)(x)?") | [.offset, .length, .captures[1].offset])'),
    'true\ntrue\n["test","abc"]\n[5,1,-1]\n');
  assert.equal(await jqn('"foo bar" | capture("(?<x>\\\\w+) (?<y>\\\\w+)"), [scan("o")], [splits(" ")], split("o+"; null)'), '{"x":"foo","y":"bar"}\n["o","o"]\n["foo","bar"]\n["f"," bar"]\n');
  assert.equal(await jqn('"aXbXc" | sub("X"; "-"), gsub("X"; "-"), gsub("(?<l>[a-z])"; "<\\(.l)>"), sub("x"; "y"; "gi")'), '"a-bXc"\n"a-b-c"\n"<a>X<b>X<c>"\n"aybyc"\n');
  assert.equal(await jqn('"a1" | test("a 1"; "x"), [match("";"g") | .offset]'), 'true\n[0,1,2]\n');
});

test('math and dates', async () => {
  assert.equal(await jqn('3.7 | floor, ceil, round, fabs, sqrt, (2 | pow(.; 10)), (100 | log10), (-2.5 | round), (nan | isnan), (1 | isinfinite)'),
    '3\n4\n4\n3.7\n1.9235384061671346\n1024\n2\n-3\ntrue\nfalse\n');
  assert.equal(await jqn('0 | todate, ("2015-03-05T23:51:47Z" | fromdate), (1425599507 | gmtime), (1425599507 | strftime("%A, %B %d, %Y"))'),
    '"1970-01-01T00:00:00Z"\n1425599507\n[2015,2,5,23,51,47,4,63]\n"Thursday, March 05, 2015"\n');
  assert.equal(await jqn('"10:15 2020-01-02" | strptime("%H:%M %Y-%m-%d") | mktime, (now | type)'), '1577960100\n"number"\n');
});

test('errors, try/catch and exit codes', async () => {
  const err = async (cmd: string, stdin?: string) => {
    const r = await run(cmd, stdin);
    return [r.stdout, r.stderr, r.code];
  };
  assert.deepEqual(await err("jq '.a.b'", '{"a":1}\n'), ['', 'jq: error (at <stdin>:1): Cannot index number with "b"\n', 5]);
  assert.deepEqual(await err("jq '.a.b'", '{"a":1}'), ['', 'jq: error (at <stdin>:0): Cannot index number with "b"\n', 5]);
  assert.deepEqual(await err("jq '.[]'", '1\n2'), ['', 'jq: error (at <stdin>:1): Cannot iterate over number (1)\njq: error (at <stdin>:1): Cannot iterate over number (2)\n', 5]);
  assert.deepEqual(await err("jq -n '{} | .[0], 1'"), ['', 'jq: error (at <unknown>): Cannot index object with number\n', 5]);
  assert.deepEqual(await err('jq -n \'"x" + 1\''), ['', 'jq: error (at <unknown>): string ("x") and number (1) cannot be added\n', 5]);
  assert.deepEqual(await err("jq -n '{a:1} | error'"), ['', 'jq: error (at <unknown>) (not a string): {"a":1}\n', 5]);
  assert.deepEqual(await err("jq -n '1, error(\"boom\"), 2'"), ['1\n', 'jq: error (at <unknown>): boom\n', 5]);
  assert.equal(await jqn('try error("x") catch ., try error({a:1}) catch .a, [.[]?], (try (1, error("e"), 3) catch .)'), '"x"\n1\n[]\n1\n"e"\n');
  assert.equal(await jqn('[(1,2) | try if . > 1 then error("big") else . end catch "caught"]'), '[1,"caught"]\n');
  assert.deepEqual(await err('jq .', '{"a":1\n'), ['', 'jq: parse error: Unfinished JSON term at EOF at line 2, column 0\n', 2]);
  assert.deepEqual(await err('jq -c .', '{"a":1} {a:1}'), ['{"a":1}\n', 'jq: parse error: Invalid numeric literal at line 1, column 11\n', 2]);
  assert.deepEqual(await err('jq .', 'foo\n'), ['', 'jq: parse error: Invalid literal at line 2, column 0\n', 2]);
  assert.deepEqual(await err('jq .a /tmp/missing.json'), ['', 'jq: error: Could not open /tmp/missing.json: No such file or directory\n', 2]);
  assert.deepEqual(await err('jq -e .', 'null'), ['null\n', '', 1]);
  assert.deepEqual(await err('jq -e .', '1'), ['1\n', '', 0]);
  assert.deepEqual(await err('jq -e empty', '1'), ['', '', 4]);
  assert.deepEqual(await err("jq -n '\"bye\\n\" | halt_error'"), ['', 'bye\n', 5]);
  assert.deepEqual(await err("jq -n '{a:1} | halt_error(1)'"), ['', '{"a":1}\n', 1]);
  assert.deepEqual(await err("jq -n '1, halt, 2'"), ['1\n', '', 0]);
  assert.deepEqual(await err("jq -n '1 | debug | . + 1'"), ['2\n', '["DEBUG:",1]\n', 0]);
});

test('compile and usage errors', async () => {
  const err = async (cmd: string) => {
    const r = await run(cmd);
    return [r.stderr, r.code];
  };
  assert.deepEqual(await err("jq -n '.a |'"), ['jq: error: syntax error, unexpected end of file (Unix shell quoting issues?) at <top-level>, line 1:\n.a |    \njq: 1 compile error\n', 3]);
  assert.deepEqual(await err("jq -n 'foo'"), ['jq: error: foo/0 is not defined at <top-level>, line 1:\nfoo\njq: 1 compile error\n', 3]);
  assert.deepEqual(await err("jq -n '$x | bar(1)'"), ['jq: error: $x is not defined at <top-level>, line 1:\n$x | bar(1)\njq: error: bar/1 is not defined at <top-level>, line 1:\n$x | bar(1)     \njq: 2 compile errors\n', 3]);
  assert.match((await err("jq -n '1 == 2 == 3'"))[0] as string, /unexpected ==/);
  assert.match((await err("jq -n '@nope'"))[0] as string, /nope is not a valid format/);
  const hint = 'Use jq --help for help with command-line options,\nor see the jq manpage, or online docs  at https://jqlang.github.io/jq\n';
  assert.deepEqual(await err('jq -x .'), [`jq: Unknown option: -x\n${hint}`, 2]);
  assert.deepEqual(await err('jq -n --arg x'), [`jq: --arg takes two parameters (e.g. --arg varname value)\n${hint}`, 2]);
  assert.deepEqual(await err("jq -n --argjson x '{' ."), [`jq: Invalid JSON text passed to --argjson\n${hint}`, 2]);
  assert.equal(await out('jq --version'), 'jq-1.7.1\n');
  assert.match(await out('jq --help'), /^Usage:\tjq \[OPTIONS\] FILTER \[FILES\.\.\.\]/);
});

test('large and streaming workloads stay responsive', async () => {
  assert.equal(await out("jq -n '[range(100000)] | map(. * 2) | add'"), '9999900000\n');
  assert.equal(await out("jq -n '[range(20000) | {(tostring): .}] | add | length'"), '20000\n');
  assert.equal(await out("jq -n 'repeat(1)' | head -2"), 'null\n1\n');
  assert.equal(await out("jq -n 'range(infinite)' | head -1"), '0\n');
});
