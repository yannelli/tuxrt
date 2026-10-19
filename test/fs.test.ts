import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StringReader } from '../src/shell/io.ts';
import { machine, Runtime } from './helpers.ts';

type Run = Awaited<ReturnType<typeof machine>>;

async function eq(run: Run, cmd: string, stdout: string): Promise<void> {
  const r = await run(cmd);
  assert.equal(r.stdout, stdout, `${cmd}\n${r.stderr}`);
}

async function fails(run: Run, cmd: string, stderr: string, code = 1): Promise<void> {
  const r = await run(cmd);
  assert.equal(r.stderr, stderr, cmd);
  assert.equal(r.code, code, cmd);
}

/** Runs on a fresh machine whose stdout claims to be a terminal. */
async function tty(cmd: string): Promise<string> {
  const rt = await Runtime.boot();
  let data = '';
  const stdout = { isTTY: true, write: (d: string) => void (data += d) };
  await rt.run(`COLUMNS=80; ${cmd}`, { stdin: new StringReader(''), stdout, stderr: stdout });
  return data;
}

test('ls: listing, long format, sorting and errors', async () => {
  const run = await machine();
  await eq(run, 'ls -A', '.bash_logout\n.bashrc\n.profile\n');
  await eq(run, 'ls -a | { read a; read b; echo $a $b; }', '. ..\n');
  await run('mkdir -p d/sub; echo hi > d/f; touch -d 2020-01-01 d/old; truncate -s 9000 d/big; ln -s f d/l; chmod +x d/f');
  assert.match((await run('ls -l /etc/hosts')).stdout, /^-rw-r--r-- 1 root root \d+ \w{3} [ \d]\d \d\d:\d\d \/etc\/hosts\n$/);
  assert.match((await run('ls -ld /bin')).stdout, /^lrwxrwxrwx 1 root root 7 .* \/bin -> usr\/bin\n$/);
  assert.match((await run('ls -l d')).stdout, /^total 20\n-rw-r--r-- 1 ubuntu ubuntu 9000 .* big\n-rwxr-xr-x 1 ubuntu ubuntu    3 .* f\n/);
  assert.match((await run('ls -l d/old')).stdout, / Jan  1  2020 d\/old\n$/);
  assert.match((await run('ls -ldh /tmp')).stdout, /^drwxrwxrwt 2 root root 4\.0K /);
  assert.match((await run('ls -ln d/f')).stdout, / 1000 1000 /);
  assert.match((await run('ls -l /dev/null')).stdout, /^crw-rw-rw- 1 root root 1, 3 /);
  await eq(run, 'ls d', 'big\nf\nl\nold\nsub\n');
  await eq(run, 'ls -r d', 'sub\nold\nl\nf\nbig\n');
  await eq(run, 'ls -S d', 'big\nsub\nf\nl\nold\n');
  await eq(run, 'mkdir td; touch -d 2021-01-01 td/a; touch -d 2023-01-01 td/b; touch -d 2022-01-01 td/c; ls -t td; ls -tr td', 'b\nc\na\na\nc\nb\n');
  await eq(run, 'ls -F d', 'big\nf*\nl@\nold\nsub/\n');
  await eq(run, 'ls -d d /etc/hostname', '/etc/hostname\nd\n');
  await eq(run, 'ls d/sub /etc/hostname d/f', '/etc/hostname\nd/f\n\nd/sub:\n');
  await eq(run, 'ls -R d/sub', 'd/sub:\n');
  assert.match((await run('ls -i d/f')).stdout, /^\d+ d\/f\n$/);
  await fails(run, 'ls nosuch', "ls: cannot access 'nosuch': No such file or directory\n", 2);
  await fails(run, 'ls /root', "ls: cannot open directory '/root': Permission denied\n", 2);
  await fails(run, 'ls --color=bad', "ls: invalid argument 'bad' for '--color'\nValid arguments are:\n  - 'always', 'yes', 'force'\n  - 'never', 'no', 'none'\n  - 'auto', 'tty', 'if-tty'\nTry 'ls --help' for more information.\n", 2);
});

test('ls: columns, quoting and colors follow the terminal', async () => {
  assert.equal(
    await tty('ls /'),
    'bin   dev  home  lib64       media  opt   root  sbin  srv  tmp  var\nboot  etc  lib   lost+found  mnt    proc  run   snap  sys  usr\n',
  );
  assert.equal(await tty('cd /tmp; touch "a b" c; ls'), "'a b'   c\n");
  const setup = 'mkdir -p /tmp/c/dir; touch /tmp/c/f /tmp/c/x.tar; chmod +x /tmp/c/f; ln -s f /tmp/c/l; ';
  assert.equal(
    await tty(`${setup}ls --color=auto /tmp/c`),
    '\x1b[0m\x1b[01;34mdir\x1b[0m  \x1b[01;32mf\x1b[0m  \x1b[01;36ml\x1b[0m  \x1b[01;31mx.tar\x1b[0m\n',
  );
  const run = await machine();
  await run(setup);
  await eq(run, 'ls --color=auto /tmp/c', 'dir\nf\nl\nx.tar\n');
  await eq(run, 'ls --color /tmp/c/dir -d', '\x1b[0m\x1b[01;34m/tmp/c/dir\x1b[0m\n');
});

test('mkdir and rmdir', async () => {
  const run = await machine();
  await eq(run, 'mkdir -pv a/b/c', "mkdir: created directory 'a'\nmkdir: created directory 'a/b'\nmkdir: created directory 'a/b/c'\n");
  await fails(run, 'mkdir a', "mkdir: cannot create directory 'a': File exists\n");
  await fails(run, 'mkdir x/y', "mkdir: cannot create directory 'x/y': No such file or directory\n");
  await fails(run, 'mkdir /root/x', "mkdir: cannot create directory '/root/x': Permission denied\n");
  await fails(run, 'mkdir', "mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
  await eq(run, 'mkdir -m 700 m; mkdir -p a/b; stat -c %a m', '700\n');
  await fails(run, 'rmdir a', "rmdir: failed to remove 'a': Directory not empty\n");
  await eq(run, 'rmdir -pv a/b/c; [ -e a ] || echo gone', "rmdir: removing directory, 'a/b/c'\nrmdir: removing directory, 'a/b'\nrmdir: removing directory, 'a'\ngone\n");
});

test('rm', async () => {
  const run = await machine();
  await run('mkdir -p t/s e; touch t/s/f t/g; ln -s /etc/hosts lnk');
  await fails(run, 'rm', "rm: missing operand\nTry 'rm --help' for more information.\n");
  await fails(run, 'rm t', "rm: cannot remove 't': Is a directory\n");
  await fails(run, 'rm nosuch', "rm: cannot remove 'nosuch': No such file or directory\n");
  await fails(run, 'rm /etc/hosts', "rm: cannot remove '/etc/hosts': Permission denied\n");
  await fails(run, 'rm -rf /', "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
  await fails(run, 'rm -r .', "rm: refusing to remove '.' or '..' directory: skipping '.'\n");
  await eq(run, 'rm -f nosuch; echo $?; rm -d e && rm lnk && [ -f /etc/hosts ] && echo kept', '0\nkept\n');
  await eq(run, 'rm -rv t', "removed 't/g'\nremoved 't/s/f'\nremoved directory 't/s'\nremoved directory 't'\n");
});

test('touch and truncate', async () => {
  const run = await machine();
  await eq(run, 'touch a; touch -c b; ls', 'a\n');
  await eq(run, 'touch -d "2020-01-01 00:00" a; stat -c %Y a', '1577836800\n');
  await eq(run, 'touch -t 202001010000.30 b; stat -c %Y b; touch -r a c; stat -c %Y c', '1577836830\n1577836800\n');
  await eq(run, 'touch -d @86400 a; stat -c %Y a', '86400\n');
  await fails(run, 'touch -d bogus a', "touch: invalid date format 'bogus'\n");
  await fails(run, 'touch /root/x', "touch: cannot touch '/root/x': Permission denied\n");
  await eq(run, 'truncate -s 10 a; stat -c %s a; truncate -s +5 a; truncate -s -3 a; stat -c %s a', '10\n12\n');
  await eq(run, 'echo hello > h; truncate -s 2 h; read x < h; echo $x; truncate -s 1M h; stat -c %s h', 'he\n1048576\n');
  await fails(run, 'truncate a', "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.\n");
});

test('cp', async () => {
  const run = await machine();
  await run('echo data > f; mkdir d; chmod 640 f; touch -d 2020-01-01 f');
  await eq(run, 'cp f g; read x < g; echo $x; stat -c %a g', 'data\n640\n');
  await eq(run, 'cp -v f g d', "'f' -> 'd/f'\n'g' -> 'd/g'\n");
  await eq(run, 'cp -p f p; stat -c "%a %Y" p', '640 1577836800\n');
  await fails(run, 'cp f g h', "cp: target 'h' is not a directory\n");
  await fails(run, 'cp d e', "cp: -r not specified; omitting directory 'd'\n");
  await fails(run, 'cp -r d d/x', "cp: cannot copy a directory, 'd', into itself, 'd/x'\n");
  await fails(run, 'cp f f', "cp: 'f' and 'f' are the same file\n");
  await fails(run, 'cp f', "cp: missing destination file operand after 'f'\nTry 'cp --help' for more information.\n");
  await fails(run, 'cp nosuch x', "cp: cannot stat 'nosuch': No such file or directory\n");
  await fails(run, 'cp /etc/shadow x', "cp: cannot open '/etc/shadow' for reading: Permission denied\n");
  await eq(run, 'echo new > n; cp -n n f; read x < f; echo $x', 'data\n');
  await eq(run, 'ln -s f d/l; cp -r d e; readlink e/l; cp -a d/l al; readlink al; ls e', 'f\nf\nf\ng\nl\n');
});

test('mv', async () => {
  const run = await machine();
  await run('echo a > a; mkdir d e; touch d/x');
  await eq(run, 'mv -v a b; ls', "renamed 'a' -> 'b'\nb\nd\ne\n");
  await eq(run, 'mv b d; ls d', 'b\nx\n');
  await fails(run, 'mv nosuch z', "mv: cannot stat 'nosuch': No such file or directory\n");
  await fails(run, 'mv d d/sub', "mv: cannot move 'd' to a subdirectory of itself, 'd/sub'\n");
  await fails(run, 'mkdir e/dir; mv -T d/b e/dir', "mv: cannot overwrite directory 'e/dir' with non-directory\n");
  await fails(run, 'mv /etc/hosts h', "mv: cannot move '/etc/hosts' to 'h': Permission denied\n");
  await eq(run, 'touch k; mv -n k d/b; ls k', 'k\n');
});

test('ln, readlink and realpath', async () => {
  const run = await machine();
  await run('mkdir -p d/s; echo x > d/f');
  await eq(run, 'ln -sv f d/l; readlink d/l', "'d/l' -> 'f'\nf\n");
  await fails(run, 'ln -s g d/l', "ln: failed to create symbolic link 'd/l': File exists\n");
  await eq(run, 'ln -sf g d/l; readlink d/l; ln d/f d/h; stat -c %h d/f; ln -s /etc/hosts d/s; readlink d/s/hosts', 'g\n2\n/etc/hosts\n');
  await fails(run, 'ln d d2', "ln: 'd': hard link not allowed for directory\n");
  await fails(run, 'ln nosuch x', "ln: failed to access 'nosuch': No such file or directory\n");
  await eq(run, 'ln -s ../f d/s/up; readlink -f d/s/up; readlink -m /a/../b/c', '/home/ubuntu/d/f\n/b/c\n');
  await eq(run, 'readlink d/f; echo $?; readlink -e d/l; echo $?', '1\n1\n');
  await eq(run, 'cd d/s; realpath up ../f new /bin', '/home/ubuntu/d/f\n/home/ubuntu/d/f\n/home/ubuntu/d/s/new\n/usr/bin\n');
  await eq(run, 'realpath -s /bin/../etc /bin', '/etc\n/bin\n');
  await fails(run, 'realpath a/b', 'realpath: a/b: No such file or directory\n');
  await fails(run, 'realpath -e nope', 'realpath: nope: No such file or directory\n');
});

test('chmod, chown and chgrp', async () => {
  const run = await machine();
  await run('mkdir -p d/s; touch d/f d/s/g');
  await eq(run, 'chmod 640 d/f; chmod u+x,g-r d/f; stat -c %A d/f', '-rwx------\n');
  await eq(run, 'chmod -x d/f; chmod a=r,u+w d/f; stat -c %a d/f', '644\n');
  await eq(run, 'chmod -v 600 d/f', "mode of 'd/f' changed from 0644 (rw-r--r--) to 0600 (rw-------)\n");
  await eq(run, 'chmod -c 600 d/f; chmod -v 600 d/f', "mode of 'd/f' retained as 0600 (rw-------)\n");
  await eq(run, 'chmod -R go-rwx d; stat -c %a d d/s d/s/g', '700\n700\n600\n');
  await fails(run, 'chmod xyz d/f', "chmod: invalid mode: 'xyz'\nTry 'chmod --help' for more information.\n");
  await fails(run, 'chmod 777 /etc/hosts', "chmod: changing permissions of '/etc/hosts': Operation not permitted\n");
  await fails(run, 'chmod 777 nope', "chmod: cannot access 'nope': No such file or directory\n");
  await fails(run, 'chown root d/f', "chown: changing ownership of 'd/f': Operation not permitted\n");
  const root = await machine('root');
  await root('mkdir -p /srv/x/y; touch /srv/x/y/f');
  await eq(root, 'chown -R ubuntu:sudo /srv/x; stat -c %U:%G /srv/x /srv/x/y/f', 'ubuntu:sudo\nubuntu:sudo\n');
  await eq(root, 'chown root: /srv/x; stat -c %U:%G /srv/x; chgrp 1000 /srv/x; stat -c %G /srv/x', 'root:root\nubuntu\n');
  await eq(root, 'chown -v :www-data /srv/x', "changed ownership of '/srv/x' from root:ubuntu to root:www-data\n");
  await eq(root, 'chgrp -v root /srv/x', "changed group of '/srv/x' from www-data to root\n");
  await fails(root, 'chown bob /srv/x', "chown: invalid user: 'bob'\n");
  await fails(root, 'chgrp nogrp /srv/x', "chgrp: invalid group: 'nogrp'\n");
});

test('stat', async () => {
  const run = await machine();
  await run('printf hello > f; ln -s f l; touch -d "2024-03-05 06:07:08" f');
  const lines = (await run('stat f')).stdout.split('\n');
  assert.equal(lines[0], '  File: f');
  assert.match(lines[1], /^ {2}Size: 5 {9}\tBlocks: 8 {10}IO Block: 4096 {3}regular file$/);
  assert.match(lines[2], /^Device: 8,1\tInode: \d+ +Links: 1$/);
  assert.equal(lines[3], 'Access: (0644/-rw-r--r--)  Uid: ( 1000/  ubuntu)   Gid: ( 1000/  ubuntu)');
  assert.equal(lines[5], 'Modify: 2024-03-05 06:07:08.000000000 +0000');
  assert.equal(lines[7], ' Birth: -');
  await eq(run, 'stat -c "%n %s %a %A %U %G %F %h %y" f', 'f 5 644 -rw-r--r-- ubuntu ubuntu regular file 1 2024-03-05 06:07:08.000000000 +0000\n');
  await eq(run, 'stat -c "%N|%F|%s" l; stat -L -c %F l', 'l -> f|symbolic link|1\nregular file\n');
  await eq(run, 'stat -c "%s %F|%m|%04a|%-5U|" /proc/cpuinfo', '0 regular empty file|/proc|0444|root |\n');
  await eq(run, 'stat --printf "%n\\t%i\\n" /' + " | { read n i; echo $n; }", '/\n');
  assert.match((await run('stat -t f')).stdout, /^f 5 8 81a4 1000 1000 801 \d+ 1 0 0 \d+ \d+ \d+ 0 4096\n$/);
  await fails(run, 'stat nope', "stat: cannot statx 'nope': No such file or directory\n");
});

test('basename, dirname and mktemp', async () => {
  const run = await machine();
  await eq(run, 'basename /usr/lib/x.so .so; basename -s .c a.c dir/b.c; basename -a x/y/ /; basename .so .so', 'x\na\nb\ny\n/\n.so\n');
  await fails(run, 'basename', "basename: missing operand\nTry 'basename --help' for more information.\n");
  await fails(run, 'basename a b c', "basename: extra operand 'c'\nTry 'basename --help' for more information.\n");
  await eq(run, 'dirname /usr/lib a a//b / /x/ ./y', '/usr\n.\na\n/\n/\n.\n');
  const tmp = (await run('mktemp')).stdout.trim();
  assert.match(tmp, /^\/tmp\/tmp\.[A-Za-z0-9]{10}$/);
  await eq(run, `stat -c "%a %F" ${tmp}`, '600 regular empty file\n');
  await eq(run, 'stat -c "%a %F" $(mktemp -d)', '700 directory\n');
  assert.match((await run('mktemp -p /var/tmp job.XXXX; mktemp here.XXX')).stdout, /^\/var\/tmp\/job\.\w{4}\nhere\.\w{3}\n$/);
  await fails(run, 'mktemp x.XX', "mktemp: too few X's in template 'x.XX'\n");
  await fails(run, 'mktemp -p /nope', "mktemp: failed to create file via template '/nope/tmp.XXXXXXXXXX': No such file or directory\n");
});

test('du and df', async () => {
  const run = await machine();
  await run('mkdir -p d/s; printf x > d/a; truncate -s 5000 d/b; ln d/a d/s/hard; ln -s a d/l');
  await eq(run, 'du d', '4\td/s\n20\td\n');
  await eq(run, 'du -s d; du -sh d; du -c d/a d/b', '20\td\n20K\td\n4\td/a\n8\td/b\n12\ttotal\n');
  await eq(run, 'du -a d', '4\td/a\n8\td/b\n0\td/l\n4\td/s\n20\td\n');
  await eq(run, 'du -h --max-depth=0 d /proc', '20K\td\n4.0K\t/proc\n');
  await fails(run, 'du nope', "du: cannot access 'nope': No such file or directory\n");
  const df = (await run('df')).stdout.split('\n');
  assert.equal(df[0], 'Filesystem     1K-blocks    Used Available Use% Mounted on');
  assert.match(df[2], /^\/dev\/sda1 +30298176 +\d+ +\d+ +\d+% \/$/);
  assert.match((await run('df -h /')).stdout, /^Filesystem +Size +Used Avail Use% Mounted on\n\/dev\/sda1 +29G +[\d.]+G +\d+G +\d+% \/\n$/);
  assert.match((await run('df -T /tmp /dev/shm')).stdout, /\n\/dev\/sda1 +ext4 .* \/\ntmpfs +tmpfs .* \/dev\/shm\n$/);
  const used = async () => Number((await run('df /')).stdout.split('\n')[1].split(/ +/)[2]);
  const before = await used();
  await run('truncate -s 8M big');
  assert.equal(await used(), before + 8192);
});

test('tree', async () => {
  const run = await machine();
  await run('mkdir -p p/a/b p/.h; touch p/a/b/f p/z; ln -s z p/l');
  await eq(run, 'tree p', 'p\n├── a\n│\u00a0\u00a0 └── b\n│\u00a0\u00a0     └── f\n├── l -> z\n└── z\n\n2 directories, 3 files\n');
  await eq(run, 'tree -L 1 -a p', 'p\n├── .h\n├── a\n├── l -> z\n└── z\n\n2 directories, 2 files\n');
  await eq(run, 'tree -d p', 'p\n└── a\n    └── b\n\n2 directories\n');
  await eq(run, 'tree p/a/b', 'p/a/b\n└── f\n\n0 directories, 1 file\n');
  await fails(run, 'tree nope >/dev/null', '', 2);
});

test('file', async () => {
  const run = await machine();
  await run('printf "#!/bin/bash\\necho\\n" > s; echo \'{"a": [1]}\' > j; echo plain > t; touch e; ln -s t l; ln -s gone b; printf "a\\r\\nb" > c; printf "\\x01\\x02" > bin; echo "héllo" > u');
  await eq(
    run,
    'file s j t e l b c bin u / /dev/null nope',
    [
      's:         Bourne-Again shell script, ASCII text executable', 'j:         JSON text data', 't:         ASCII text',
      'e:         empty', 'l:         symbolic link to t', 'b:         broken symbolic link to gone',
      'c:         ASCII text, with CRLF line terminators', 'bin:       data', 'u:         Unicode text, UTF-8 text',
      '/:         directory', '/dev/null: character special (1/3)', "nope:      cannot open `nope' (No such file or directory)", '',
    ].join('\n'),
  );
  await eq(run, 'file -b -L l /proc/cpuinfo', 'ASCII text\nempty\n');
  assert.match((await run('file /usr/bin/ls')).stdout, /^\/usr\/bin\/ls: ELF 64-bit LSB pie executable, x86-64, .*BuildID\[sha1\]=[0-9a-f]{40}, for GNU\/Linux 3\.2\.0, stripped\n$/);
});

test('find', async () => {
  const run = await machine();
  await run('mkdir -p r/a/b r/e; echo hi > r/a/x.txt; touch r/A.TXT r/a/b/y.sh; truncate -s 3000 r/big; ln -s a r/l; chmod 755 r/a/b/y.sh; touch -d 2020-01-01 r/big');
  await eq(run, 'find r', 'r\nr/A.TXT\nr/a\nr/a/b\nr/a/b/y.sh\nr/a/x.txt\nr/big\nr/e\nr/l\n');
  await eq(run, '(cd r; find . -name "*.txt"; find -iname "*.txt" -type f)', './a/x.txt\n./A.TXT\n./a/x.txt\n');
  await eq(run, 'find r -type d -mindepth 1 -maxdepth 1 2>/dev/null; find r -type l', 'r/a\nr/e\nr/l\n');
  await eq(run, 'find r -type f -size +2k; find r -type f -size -1k; find r -empty', 'r/big\nr/A.TXT\nr/a/b/y.sh\nr/A.TXT\nr/a/b/y.sh\nr/e\n');
  await eq(run, 'find r -perm 755 -type f; find r -perm -u+x -name "y*"; find r -mtime +365; find r -newer r/big -name x.txt', 'r/a/b/y.sh\nr/a/b/y.sh\nr/big\nr/a/x.txt\n');
  await eq(run, 'find r -path "*/b/*" -o -name big; find r ! -type d -not -user ubuntu; find r -user ubuntu -name e', 'r/a/b/y.sh\nr/big\nr/e\n');
  await eq(run, 'find r \\( -name a -o -name e \\) -type d; find r -name a -prune -o -type f -print', 'r/a\nr/e\nr/A.TXT\nr/big\n');
  await eq(run, 'find r/a -type f -print0 | { read -d "" a; echo "$a"; }; find r -name "*.sh" -quit -o -print | { read x; echo $x; }', 'r/a/b/y.sh\nr\n');
  await eq(run, 'find r/a -type f -exec echo "<{}>" \\;; find r/a -type f -exec echo all {} +', '<r/a/b/y.sh>\n<r/a/x.txt>\nall r/a/b/y.sh r/a/x.txt\n');
  await eq(run, 'find r/a -name "*.txt" -exec false \\; -o -print', 'r/a\nr/a/b\nr/a/b/y.sh\nr/a/x.txt\n');
  await eq(run, 'find r/a -delete; ls r', 'A.TXT\nbig\ne\nl\n');
  await fails(run, 'find nope', "find: 'nope': No such file or directory\n");
  await fails(run, 'find r -bogus', "find: unknown predicate '-bogus'\n");
  await fails(run, 'find r -name', "find: missing argument to '-name'\n");
  await fails(run, 'find r -type q', 'find: Unknown argument to -type: q\n');
  await fails(run, 'find r \\( -name a', "find: invalid expression; I was expecting to find a ')' somewhere but did not see one.\n");
  await fails(run, 'find r -name a x', "find: paths must precede expression: 'x'\n");
  await fails(run, 'find /root', "find: '/root': Permission denied\n");
  assert.match((await run('find r -name e -maxdepth 1')).stderr, /^find: warning: you have specified the global option '-maxdepth' after the argument '-name'/);
});
