import assert from 'node:assert/strict';
import { test } from 'node:test';
import { machine, Runtime, sh } from './helpers.ts';

const out = async (cmd: string, stdin?: string) => (await sh(cmd, stdin)).stdout;

test('fields, NF and field splitting', async () => {
  assert.equal(await out(`awk '{print $2, NF}'`, 'a b c\n'), 'b 3\n');
  assert.equal(await out(`awk '{print NF, "[" $1 "]"}'`, '  lead  trail  \n'), '2 [lead]\n');
  assert.equal(await out(`awk -F: '{print NF, "[" $2 "]"}'`, 'a::b\n'), '3 []\n');
  assert.equal(await out(`awk -F '\\t' '{print $2}'`, 'a\tb c\n'), 'b c\n');
  assert.equal(await out(`awk -F'|' '{print $2}'`, 'a|b\n'), 'b\n');
  assert.equal(await out(`awk -F '[:,]' '{print $3, NF}'`, 'a:b,c\n'), 'c 3\n');
  assert.equal(await out(`awk 'BEGIN { FS = "." } { print $2, NF }'`, 'a.b.c\n'), 'b 3\n');
  assert.equal(await out(`awk '{print $(NF-1), $NF}'`, 'a b c d\n'), 'c d\n');
  assert.equal(await out(`awk '{print ($5 == 0), ($5 == "")}'`, 'a\n'), '1 1\n');
});

test('field assignment rebuilds $0 and $0 assignment resplits', async () => {
  assert.equal(await out(`awk '{ $3 = "z"; print; print NF; NF = 1; print }'`, 'x y\n'), 'x y z\n3\nx\n');
  assert.equal(await out(`awk '{ OFS = "-"; $1 = $1; print }'`, 'a b c\n'), 'a-b-c\n');
  assert.equal(await out(`awk -v OFS=: '{ $1 = $1 } 1'`, 'a b c\n'), 'a:b:c\n');
  assert.equal(await out(`awk '{ NF = 5; print $0 "|" }'`, 'a b\n'), 'a b   |\n');
  assert.equal(await out(`awk '{ $0 = "new record here"; print $2, NF }'`, 'x\n'), 'record 3\n');
});

test('BEGIN, END, patterns and ranges', async () => {
  assert.equal(await out(`awk '{ s += $1 * $2 } END { print s, NR }'`, '1 2\n3 4\n'), '14 2\n');
  assert.equal(await out(`awk 'BEGIN { printf "a" } BEGIN { print "b" } END { print "c" } END { print NR }'`, 'x\n'), 'ab\nc\n1\n');
  assert.equal(await out(`awk 'END { print $0, NR }'`, 'x\ny'), 'y 2\n');
  assert.equal(await out(`awk 'NR==2,NR==4'`, '1\n2\n3\n4\n5\n'), '2\n3\n4\n');
  assert.equal(await out(`awk '/b/,/b/ { print "r", $0 }'`, 'a\nb\nc\nb\n'), 'r b\nr b\n');
  assert.equal(await out(`awk '/^[[:alpha:]]+$/'`, 'abc\nab1\n'), 'abc\n');
  assert.equal(await out(`awk '!seen[$0]++'`, 'a\nb\na\nc\nb\n'), 'a\nb\nc\n');
  assert.equal(await out(`awk '1; 1'`, 'dup\n'), 'dup\ndup\n');
  assert.equal(await out(`awk '$1 == 2 { next } { print }'`, '1\n2\n3\n'), '1\n3\n');
  assert.equal(await out(`awk '/a/{print "A"} /b/{print "B"}'`, 'ab\n'), 'A\nB\n');
});

test('-v, -f, operand assignments, ARGV and ENVIRON', async () => {
  const run = await machine();
  await run(`printf 'a 1\\nb 2\\n' > /tmp/f1; printf 'c 3\\n' > /tmp/f2; printf 'BEGIN { print "from file" }\\n' > /tmp/p.awk`);
  assert.equal((await run(`awk -v 'x=a\\tb' 'BEGIN { print x }'`)).stdout, 'a\tb\n');
  assert.equal((await run(`awk -v n=10 'BEGIN { print (n > 9), (n < 9) }'`)).stdout, '1 0\n');
  assert.equal((await run('awk -f /tmp/p.awk')).stdout, 'from file\n');
  assert.equal((await run(`awk '{ print x, $1 }' x=1 /tmp/f1 x=2 /tmp/f2`)).stdout, '1 a\n1 b\n2 c\n');
  assert.equal((await run(`awk '{ print FILENAME, NR, FNR }' /tmp/f1 /tmp/f2`)).stdout, '/tmp/f1 1 1\n/tmp/f1 2 2\n/tmp/f2 3 1\n');
  assert.equal((await run(`awk 'FNR == 1 { print FILENAME; nextfile } { print "never" }' /tmp/f1 /tmp/f2`)).stdout, '/tmp/f1\n/tmp/f2\n');
  assert.equal((await run(`awk 'BEGIN { print ENVIRON["HOME"], ARGC, ARGV[0], ARGV[2] }' a b`)).stdout, '/home/ubuntu 3 awk b\n');
  assert.equal((await run(`awk 'BEGIN { ARGV[1] = "/tmp/f2"; ARGC = 2 } { print }'`)).stdout, 'c 3\n');
  assert.equal((await run(`echo hi | awk '{ print NR ": " $0 }' -`)).stdout, '1: hi\n');
  assert.equal((await run(`echo a | mawk '{ print "m" $0 }'; echo b | gawk '{ print "g" $0 }'`)).stdout, 'ma\ngb\n');
});

test('arrays, for-in, delete, multi-dimensional keys and in', async () => {
  assert.equal(await out(`awk 'BEGIN { x["a"] = 1; x["b"] = 2; for (k in x) print k, x[k]; delete x["a"]; print length(x) }'`), 'a 1\nb 2\n1\n');
  assert.equal(await out(`awk '{ sum[$1] += $2 } END { for (k in sum) print k, sum[k] }'`, 'k1 1\nk2 2\nk1 3\n'), 'k1 4\nk2 2\n');
  assert.equal(await out(`awk 'BEGIN { a[1,2] = 3; if ((1,2) in a) print "yes"; for (k in a) { split(k, p, SUBSEP); print p[1], p[2] } }'`), 'yes\n1 2\n');
  assert.equal(await out(`awk 'BEGIN { if (!(3 in a)) print "no"; x[1]; print length(x); delete x; print length(x) }'`), 'no\n1\n0\n');
  assert.equal(await out(`awk 'BEGIN { if (a["k"] == "") print ("k" in a) }'`), '1\n');
});

test('control flow statements', async () => {
  assert.equal(await out(`awk 'BEGIN { for (;;) { if (++i > 3) break }; print i; do { j++ } while (j < 5); print j }'`), '4\n5\n');
  assert.equal(await out(`awk 'BEGIN { for (i = 0; i < 5; i++) { if (i % 2) continue; s = s i }; print s }'`), '024\n');
  assert.equal(await out(`awk 'BEGIN { if (0)\n print "x"\n else\n print "y"\n}'`), 'y\n');
  assert.equal(await out(`awk 'BEGIN { if (1) print "x"; else print "y" }'`), 'x\n');
  assert.equal(await out(`awk '\nBEGIN {\n  n = 3 # comment\n  while (n-- > 0)\n    print n\n}\n'`), '2\n1\n0\n');
  assert.equal(await out(`awk 'BEGIN { x = "a" ; x = x \\\n "b"; print x, 1,\n 2 }'`), 'ab 1 2\n');
  const r = await sh(`awk 'BEGIN { exit 3 } END { print "end" }'`);
  assert.deepEqual([r.stdout, r.code], ['end\n', 3]);
  assert.equal((await sh(`awk 'END { print "a"; exit 4; print "b" }' </dev/null`)).code, 4);
});

test('printf and sprintf formats', async () => {
  assert.equal(await out(`awk 'BEGIN { printf "%5.2f|%-4d|%x|%e|%g|%c|%s\\n", 3.14159, 42, 255, 12345.678, 0.0001234, 65, "hi" }'`), ' 3.14|42  |ff|1.234568e+04|0.0001234|A|hi\n');
  assert.equal(await out(`awk 'BEGIN { printf "%d %i %o %X %u %5s|%-5s|%.2s\\n", -3.9, 7, 8, 255, 3, "ab", "cd", "xyz" }'`), '-3 7 10 FF 3    ab|cd   |xy\n');
  assert.equal(await out(`awk 'BEGIN { printf "%5.1f%%|%05d|%+d|% d|%#o|%#x\\n", 45.678, -42, 5, 5, 8, 255 }'`), ' 45.7%|-0042|+5| 5|010|0xff\n');
  assert.equal(await out(`awk 'BEGIN { printf "%.3e|%g|%g|%g|%G|%.0f|%.0f\\n", 0, 100000, 1000000, 1e-5, 1e-10, 2.5, 3.5 }'`), '0.000e+00|100000|1e+06|1e-05|1E-10|2|4\n');
  assert.equal(await out(`awk 'BEGIN { printf "%*d|%-*d|\\n", 5, 42, 4, 7 }'`), '   42|7   |\n');
  assert.equal(await out(`awk 'BEGIN { printf "[%10.3s][%c%c][%s|%d]\\n", "abcdef", "hello", 66 }'`), '[       abc][hB][|0]\n');
  assert.equal(await out(`awk 'BEGIN { printf("%s %s\\n", "a", "b"); x = sprintf("%03d-%s", 7, "x"); print x }'`), 'a b\n007-x\n');
});

test('number formatting, OFMT and CONVFMT', async () => {
  assert.equal(await out(`awk 'BEGIN { print 1/3, 100000000, 2^53, 0.1 + 0.2, 1e6, 1e300, 123456789.123 }'`), '0.333333 100000000 9007199254740992 0.3 1000000 1e+300 1.23457e+08\n');
  assert.equal(await out(`awk 'BEGIN { OFMT = "%.2f"; print 3.14159, 3; CONVFMT = "%.2g"; x = 3.14159 ""; print x }'`), '3.14 3\n3.1\n');
  assert.equal(await out(`awk 'BEGIN { print "3x" + 1, "x" + 1, ".5" + 0, "1e3" + 0, " 12 " + 0, length(1/4) }'`), '4 1 0.5 1000 12 4\n');
  assert.equal(await out(`awk 'BEGIN { print -3 % 2, 7 % -3, 2 ** 3, 2 ^ 3 ^ 2, -2 ^ 2, 2 ^ -1 }'`), '-1 1 8 512 -4 0.5\n');
  assert.equal(await out(`awk 'BEGIN { print int(-3.7), sqrt(16), exp(0), log(1), atan2(0, -1) }'`), '-3 4 1 0 3.14159\n');
});

test('uninitialized values and numeric string comparisons', async () => {
  assert.equal(await out(`awk 'BEGIN { print (x == 0), (x == ""), length(x), x + 0 }'`), '1 1 0 0\n');
  assert.equal(await out(`awk '{ print ($1 > $2), ("10" > "9") }'`, '10 9\n'), '1 0\n');
  assert.equal(await out(`awk '{ print ($1 == $2), ($1 == "3") }'`, '3.0 3\n'), '1 0\n');
  assert.equal(await out(`awk '{ a = $1; print (a < 9), (a > 9) }'`, '10\n'), '0 1\n');
  assert.equal(await out(`awk 'BEGIN { a = "10"; b = 9; print (a < b) }'`), '1\n');
  assert.equal(await out(`awk '{ if ($1) print "true"; else print "false" }'`, '0.0\n'), 'false\n');
  assert.equal(await out(`awk 'BEGIN { print 1 == 1.0, "a" ~ /a/, "b" !~ "a", !0, !1, !"", !"a" }'`), '1 1 1 1 0 1 0\n');
});

test('string builtins', async () => {
  assert.equal(await out(`awk 'BEGIN { print substr("hello", 2, 3), substr("hello", 0), substr("hello", -1, 3), substr("hello", 2), substr("hello", 1.5, 2) }'`), 'ell hello h ello el\n');
  assert.equal(await out(`awk 'BEGIN { print index("hello", "ll"), index("abc", "z"), length("abc"), toupper("x") tolower("Y") }'`), '3 0 3 Xy\n');
  assert.equal(await out(`awk '{ print length, length() }'`, 'hello\n'), '5 5\n');
  assert.equal(await out(`awk 'BEGIN { print match("foobar", /o+/), RSTART, RLENGTH; print match("aaa", /b/), RSTART, RLENGTH }'`), '2 2 2\n0 0 -1\n');
  assert.equal(await out(`awk 'BEGIN { s = "hello world"; print match(s, "o.*o"), RLENGTH }'`), '5 4\n');
});

test('split', async () => {
  assert.equal(await out(`awk 'BEGIN { n = split("a,b,c", arr, ","); print n, arr[1], arr[3] }'`), '3 a c\n');
  assert.equal(await out(`awk 'BEGIN { n = split("a1b22c", a, /[0-9]+/); print n, a[1], a[2], a[3] }'`), '3 a b c\n');
  assert.equal(await out(`awk 'BEGIN { n = split("  a  b  ", w); print n, w[1] w[2]; print split("", e), length(e) }'`), '2 ab\n0 0\n');
  assert.equal(await out(`awk 'BEGIN { n = split("abc", ch, ""); print n, ch[1], ch[3] }'`), '3 a c\n');
  assert.equal(await out(`awk 'BEGIN { split("5 10", p); print (p[2] > p[1]) }'`), '1\n');
});

test('sub and gsub', async () => {
  assert.equal(await out(`awk '{ n = gsub(/foo/, "[&]"); print n, $0 }'`, 'foo bar foo\n'), '2 [foo] bar [foo]\n');
  assert.equal(await out(`awk '{ sub(/b/, "[\\\\&]"); print }'`, 'abc\n'), 'a[&]c\n');
  assert.equal(await out(`awk '{ gsub(/a/, "x", $1); print; print NF }'`, 'a b\n'), 'x b\n2\n');
  assert.equal(await out(`awk 'BEGIN { s = "aaa"; print gsub(/x*/, "-", s), s; t = "abc"; gsub(/b*/, "-", t); print t }'`), '4 -a-a-a-\n-a-c-\n');
  assert.equal(await out(`awk 'BEGIN { s = "a.b.c"; gsub(".", "-", s); t = "a.b"; gsub(/\\./, "-", t); u = "hello"; print sub(/l/, "L", u), u, s, t }'`), '1 heLlo ----- a-b\n');
  assert.equal(await out(`awk '{ print sub(/zzz/, "y"), $0 }'`, 'a  b\n'), '0 a  b\n');
});

test('user-defined functions, locals and array parameters', async () => {
  assert.equal(await out(`awk 'function f(a, b) { return a + b } BEGIN { print f(2, 3) }'`), '5\n');
  assert.equal(await out(`awk 'function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) } BEGIN { print fact(10) }'`), '3628800\n');
  assert.equal(await out(`awk 'function f(n,   tmp) { tmp[1] = n; return tmp[1] * 2 } BEGIN { print f(4), f(5) }'`), '8 10\n');
  assert.equal(await out(`awk 'function fill(a) { a["x"] = 1 } BEGIN { fill(arr); print arr["x"], length(arr) }'`), '1 1\n');
  assert.equal(await out(`awk 'function g(a) { a[1] = "set" } function f(   loc) { g(loc); return loc[1] } BEGIN { print f() }'`), 'set\n');
  assert.equal(await out(`awk 'function inc(x) { x++; return x } BEGIN { y = 1; print inc(y), y }'`), '2 1\n');
  assert.equal(await out(`awk 'function noret() { } BEGIN { x = noret(); print "[" x "]" }'`), '[]\n');
});

test('getline forms', async () => {
  const run = await machine();
  await run(`printf 'a 1\\nb 2\\n' > /tmp/f1`);
  assert.equal((await run(`printf 'l1\\nl2\\nl3\\n' | awk 'BEGIN { getline; print "first:", $0, NR } { print }'`)).stdout, 'first: l1 1\nl2\nl3\n');
  assert.equal((await run(`printf 'p\\nq\\n' | awk 'BEGIN { while ((getline line) > 0) n++; print n, line, NR }'`)).stdout, '2 q 2\n');
  assert.equal((await run(`awk 'BEGIN { while ((getline l < "/tmp/f1") > 0) print l, NR }'`)).stdout, 'a 1 0\nb 2 0\n');
  assert.equal((await run(`awk 'BEGIN { getline < "/tmp/f1"; print $2, NF, NR }'`)).stdout, '1 2 0\n');
  assert.equal((await run(`awk 'BEGIN { print (getline x < "/nonexistent"), close("nothing") }'`)).stdout, '-1 -1\n');
  assert.equal((await run(`awk 'BEGIN { "echo a b c" | getline; print $2, NF, NR }'`)).stdout, 'b 3 1\n');
  assert.equal((await run(`awk 'BEGIN { while (("echo x; echo y" | getline line) > 0) print "L", line }'`)).stdout, 'L x\nL y\n');
  assert.equal((await run(`awk 'BEGIN { c = "while true; do echo y; done"; c | getline x; print x, close(c) }'`)).stdout, 'y 141\n');
  assert.equal((await run(`echo x | awk '{ print; getline; print "after", $0 }'`)).stdout, 'x\nafter x\n');
  assert.equal((await run(`printf 'one\\ntwo\\n' | awk 'BEGIN { while ((getline l < "-") > 0) print "in:", l }'`)).stdout, 'in: one\nin: two\n');
});

test('output redirection, pipes and system', async () => {
  const run = await machine();
  const r = await run(`awk 'BEGIN { print 1 > "/tmp/o"; print 2 > "/tmp/o"; close("/tmp/o"); while ((getline l < "/tmp/o") > 0) print "got", l }'`);
  assert.equal(r.stdout, 'got 1\ngot 2\n');
  await run(`awk 'BEGIN { print "a" >> "/tmp/app"; print "b" >> "/tmp/app" }'; awk 'BEGIN { print "c" >> "/tmp/app" }'`);
  assert.equal((await run(`awk '{ print }' /tmp/app`)).stdout, 'a\nb\nc\n');
  await run(`awk 'BEGIN { print "new" > "/tmp/app" }'`);
  assert.equal((await run(`awk '{ print }' /tmp/app`)).stdout, 'new\n');
  assert.equal((await run(`awk 'BEGIN { x = "/tmp/q"; printf "%s\\n", "hi" > x ".txt"; close(x ".txt"); getline y < "/tmp/q.txt"; print y }'`)).stdout, 'hi\n');
  assert.equal((await run(`awk 'BEGIN { print (1, 2) > "/tmp/g"; print 1 > 2 }'; awk '{ print FILENAME ":" $0 }' /tmp/g 2`)).stdout, '/tmp/g:1 2\n2:1\n');
  const err = await run(`awk 'BEGIN { print "e" > "/dev/stderr"; print "o" > "/dev/stdout" }'`);
  assert.deepEqual([err.stdout, err.stderr], ['o\n', 'e\n']);
  const cmd = 'while read l; do echo got $l; done';
  assert.equal((await run(`awk 'BEGIN { print "b\\na" | "${cmd}"; close("${cmd}"); print "after" }'`)).stdout, 'got b\ngot a\nafter\n');
  assert.equal((await run(`awk 'BEGIN { print "x" | "${cmd}" }'`)).stdout, 'got x\n');
  assert.equal((await run(`awk 'BEGIN { system("echo from system"); r = system("exit 3"); print "rc", r }'`)).stdout, 'from system\nrc 3\n');
});

test('record separators', async () => {
  assert.equal(await out(`awk 'BEGIN { RS = "" } { print NR ": " $0 " NF=" NF }'`, 'a b\n\nc d\ne\n'), '1: a b NF=2\n2: c d\ne NF=3\n');
  assert.equal(await out(`awk 'BEGIN { RS = ""; FS = ":" } { print NR, NF, $1 }'`, '\n\na b\nc d\n\n\n\ne f\n'), '1 2 a b\n2 1 e f\n');
  assert.equal(await out(`awk 'BEGIN { RS = ";" } { print NR, $0 }'`, 'a;b;c'), '1 a\n2 b\n3 c\n');
  assert.equal(await out(`awk 'BEGIN { RS = "[,;]" } { print NR, $0 }'`, 'a,b;c'), '1 a\n2 b\n3 c\n');
  assert.equal(await out(`awk 'BEGIN { ORS = "|" } { print }'`, 'a\nb\n'), 'a|b|');
});

test('regular expressions', async () => {
  assert.equal(await out(`awk 'BEGIN { print ("a.b" ~ /a\\.b/), ("a/b" ~ /\\//), ("axb" ~ "a\\\\.b"), ("aa" ~ /^a{2}$/), ("a{" ~ /a{/) }'`), '1 1 0 1 1\n');
  assert.equal(await out(`awk 'BEGIN { print ("A1" ~ /^[[:upper:]][[:digit:]]$/), ("]" ~ /[]]/), ("-" ~ /[a-]/), ("x\\ny" ~ /x.y/), ("ab" ~ /^(a|b)+$/) }'`), '1 1 1 1 1\n');
  assert.equal(await out(`awk '$2 ~ /^[0-9]+$/ { print $1 }'`, 'a 12\nb x\nc 3\n'), 'a\nc\n');
  assert.equal(await out(`awk 'BEGIN { re = "^b"; print ("bc" ~ re), ("cb" ~ re) }'`), '1 0\n');
});

test('expression grammar', async () => {
  assert.equal(await out(`awk 'BEGIN { print 1 " " 2 + 3; print 1 -1; a = b = 3; print a, b; print (1)(2) }'`), '1 5\n0\n3 3\n12\n');
  assert.equal(await out(`awk 'BEGIN { x = 1; x += 2; x *= 3; x -= 1; x /= 2; x %= 3; x ^= 2; print x; print x++ + ++x, x }'`), '1\n4 3\n');
  assert.equal(await out(`awk 'BEGIN { x = 5; y = x > 3 ? "big" : "small"; print y; print (1 > 2) ? "yes" : "no" }'`), 'big\nno\n');
  assert.equal(await out(`awk 'BEGIN { print toupper(substr("word", 1, 1)) substr("word", 2) }'`), 'Word\n');
  assert.equal(await out(`awk '{ i = 1; print $i++, i, $i }'`, 'a b\n'), '0 1 1\n');
});

test('rand and srand are reproducible', async () => {
  assert.equal(await out(`awk 'BEGIN { srand(1); a = rand(); srand(1); b = rand(); print (a == b), (a >= 0 && a < 1), srand(5) }'`), '1 1 1\n');
});

test('errors', async () => {
  let r = await sh(`awk 'BEGIN { print }}'`);
  assert.deepEqual([r.stderr, r.code], ['awk: line 1: syntax error at or near }\n', 2]);
  r = await sh(`awk 'BEGIN { print 1'`);
  assert.deepEqual([r.stderr, r.code], ['awk: line 1: syntax error at or near end of file\n', 2]);
  r = await sh(`awk 'BEGIN { f() }'`);
  assert.deepEqual([r.stderr, r.code], ['awk: line 1: function f never defined\n', 2]);
  r = await sh(`awk 'BEGIN { print 1/0 }'`);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^awk: run time error: division by zero\n/);
  r = await sh(`awk '{ print }' /nonexistent`);
  assert.deepEqual([r.stderr, r.code], ['awk: cannot open /nonexistent (No such file or directory)\n', 2]);
  r = await sh('awk');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^usage: awk/);
  r = await sh(`awk 'BEGIN { x[1] = 1; x = 2 }'`);
  assert.equal(r.code, 2);
});

test('Ctrl-C interrupts an infinite loop', async () => {
  const rt = await Runtime.boot();
  const pending = rt.exec(`awk 'BEGIN { while (1); }'`);
  setTimeout(() => rt.interrupt(), 50);
  assert.equal((await pending).code, 130);
});

test('large input streams through the record loop', async () => {
  const r = await sh(`awk 'BEGIN { for (i = 0; i < 20000; i++) print i, i * 2 }' | awk '{ s += $2 } END { print s, NR }'`);
  assert.equal(r.stdout, '399980000 20000\n');
});
