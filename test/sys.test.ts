import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Runtime } from '../src/runtime.ts';
import { machine, sh } from './helpers.ts';

const out = async (cmd: string, stdin?: string) => (await sh(cmd, stdin)).stdout;

/** An interactive session, where `exit` pops a su/sudo -i login instead of ending the shell. */
async function session(user?: string) {
  const rt = await Runtime.boot({ user });
  rt.shell.interactive = true;
  return (cmd: string) => rt.exec(cmd);
}

test('system information', async () => {
  assert.match(await out('uname -a'), /^Linux ubuntu 6\.8\.0-45-generic #45-Ubuntu SMP .* x86_64 x86_64 x86_64 GNU\/Linux\n$/);
  assert.equal(await out('uname -srm; arch; nproc; hostname; tty; hostname -I'), 'Linux 6.8.0-45-generic x86_64\nx86_64\n4\nubuntu\n/dev/pts/0\n10.0.2.15 \n');
  assert.equal(await out('id'), 'uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu),4(adm),27(sudo)\n');
  assert.equal(await out('id -un; id -g; id -Gn; whoami; groups; groups root'), 'ubuntu\n1000\nubuntu adm sudo\nubuntu\nubuntu adm sudo\nroot : root\n');
  const nouser = await sh('id nosuch');
  assert.deepEqual([nouser.code, nouser.stderr], [1, 'id: ‘nosuch’: no such user\n']);
  const lsb = await sh('lsb_release -a');
  assert.equal(lsb.stdout, 'Distributor ID:\tUbuntu\nDescription:\tUbuntu 24.04.1 LTS\nRelease:\t24.04\nCodename:\tnoble\n');
  assert.equal(await out('lsb_release -cs'), 'noble\n');
  assert.match(await out('hostnamectl'), /Operating System: Ubuntu 24\.04\.1 LTS\n/);
  assert.match(await out('lscpu'), /^Architecture: +x86_64\n[\s\S]*CPU\(s\): +4\n/);
  assert.match(await out('lsblk'), /└─sda1 .* part \/\n$/);
  assert.equal((await sh('dmesg')).stderr, 'dmesg: read kernel buffer failed: Operation not permitted\n');
  assert.match(await out('sudo dmesg'), /^\[ +0\.000000\] Linux version/);
});

test('sessions, memory and uptime', async () => {
  assert.match(await out('uptime'), /^ \d\d:\d\d:\d\d up +(\d+ min|\d+:\d\d),  1 user,  load average: 0\.08, 0\.03, 0\.01\n$/);
  assert.match(await out('uptime -p'), /^up \d+ hour/);
  const free = (await out('free')).split('\n');
  assert.equal(free[0], '               total        used        free      shared  buff/cache   available');
  assert.match(free[1], /^Mem: +4028440 +\d+ +\d+ +1204 +\d+ +\d+$/);
  assert.match(await out('free -h'), /Mem: +3\.8Gi /);
  assert.match(await out('w'), /USER +TTY +FROM +LOGIN@ .*\nubuntu +pts\/0 +10\.0\.2\.2 /);
  assert.match(await out('who'), /^ubuntu +pts\/0 +\d{4}-\d\d-\d\d \d\d:\d\d \(10\.0\.2\.2\)\n$/);
  assert.equal(await out('users'), 'ubuntu\n');
  assert.match(await out('last'), /still logged in\n.*still running\n\nwtmp begins /);
});

test('date and cal', async () => {
  assert.equal(await out('date -d @0 -u +%F'), '1970-01-01\n');
  assert.match(await out('date'), /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d UTC \d{4}\n$/);
  const fmt = '+%Y %m %d %H %M %S %j %u %a %A %b %B %e %p %I %y %C %s %Z %z %D %T %R %F';
  assert.equal(await out(`date -d "2024-02-29 13:05:09" "${fmt}"`), '2024 02 29 13 05 09 060 4 Thu Thursday Feb February 29 PM 01 24 20 1709211909 UTC +0000 02/29/24 13:05:09 13:05 2024-02-29\n');
  assert.equal(await out('date -d "2024-01-15 +1 day" +%F; date -d 2024-03-05 "+%-d/%-m/%_H|%3N"'), '2024-01-16\n5/3/ 0|000\n');
  assert.equal(await out('date -R -d @0; date -I -d @0; date -Iseconds -d @0'), 'Thu, 01 Jan 1970 00:00:00 +0000\n1970-01-01\n1970-01-01T00:00:00+00:00\n');
  const ago = (await out('echo $(( $(date +%s) - $(date -d "3 days ago" +%s) ))')).trim();
  assert.ok(Math.abs(Number(ago) - 259200) <= 1, ago);
  assert.equal(await out('echo $(( $(date -d tomorrow +%s) - $(date -d yesterday +%s) ))'), '172800\n');
  const bad = await sh('date -d foo');
  assert.deepEqual([bad.code, bad.stderr], [1, 'date: invalid date ‘foo’\n']);
  assert.equal(await out('cal 2 2024'), [
    '   February 2024      ', 'Su Mo Tu We Th Fr Sa  ', '             1  2  3  ', ' 4  5  6  7  8  9 10  ',
    '11 12 13 14 15 16 17  ', '18 19 20 21 22 23 24  ', '25 26 27 28 29        ', '                      ', '',
  ].join('\n'));
});

test('sleep, time, timeout, env, nohup, watch', async () => {
  const t0 = Date.now();
  const r = await sh('timeout 0.1 sleep 5');
  assert.equal(r.code, 124);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(await out('timeout 5 echo hi; echo $?'), 'hi\n0\n');
  assert.equal((await sh('timeout 1 nosuch')).code, 127);
  assert.match((await sh('time sleep 0.05')).stderr, /^\nreal\t0m0\.0[4-9]\ds\nuser\t0m\d\.\d{3}s\nsys\t0m\d\.\d{3}s\n$/);
  assert.equal((await sh('sleep 1x')).stderr, "sleep: invalid time interval ‘1x’\nTry 'sleep --help' for more information.\n");
  assert.equal((await sh('sleep 0.01 0.01s')).code, 0);
  assert.equal(await out('env -i FOO=bar env'), 'FOO=bar\n');
  assert.equal(await out('env FOO=1 printenv FOO; env -u HOME printenv HOME; echo $?'), '1\n1\n');
  assert.match(await out('env'), /^HOME=\/home\/ubuntu$/m);
  assert.equal((await sh('env nosuch')).stderr, 'env: ‘nosuch’: No such file or directory\n');
  assert.equal(await out('nohup echo hi'), 'hi\n');
  const w = await sh('timeout 0.3 watch -n 0.1 echo hi');
  assert.equal(w.code, 124);
  assert.match(w.stdout, /Every 0\.1s: echo hi +ubuntu: .*\n\nhi\n/);
});

test('process tools', async () => {
  const ps = (await out('ps')).split('\n');
  assert.equal(ps[0], '    PID TTY          TIME CMD');
  assert.match(ps[1], /^ +\d+ pts\/0    00:00:00 bash$/);
  assert.match(ps[2], /^ +\d+ pts\/0    00:00:00 ps$/);
  const aux = await out('ps aux');
  assert.match(aux, /^USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n/);
  assert.match(aux, /^root           1  0\.0  0\.3 167744 13180 \?        Ss   \d\d:\d\d   0:00 \/sbin\/init$/m);
  assert.match(await out('ps -ef'), /^UID          PID    PPID  C STIME TTY          TIME CMD\nroot           1       0  0 /);
  assert.equal(await out('ps -p 1 -o pid=,comm='), '      1 systemd\n');
  assert.equal((await out('ps -o pid,cmd')).split('\n')[0], '    PID CMD');
  const run = await machine();
  assert.match((await run('sleep 5 & sleep 0.01; pgrep -l sleep')).stdout, /^\d+ sleep\n$/);
  assert.equal((await run('pkill sleep; wait; echo $?')).stdout, '143\n');
  assert.equal((await run('pgrep sleep')).code, 1);
  assert.deepEqual(await run('killall nosuch'), { stdout: '', stderr: 'nosuch: no process found\n', code: 1 });
  assert.equal((await run('pkill sshd')).stderr, 'pkill: killing pid 702 failed: Operation not permitted\n');
  const top = await out('top -b -n 1');
  assert.match(top, /^top - \d\d:\d\d:\d\d up .*\nTasks: +\d+ total/);
  assert.match(top, /\n    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME\+ COMMAND\n +\d+ ubuntu +20 +0 .* R .* top\n/);
  assert.match(await out('pstree'), /^systemd─┬─cron\n[\s\S]*├─sshd───bash───pstree\n/);
});

test('sudo and su', async () => {
  assert.equal(await out('sudo whoami; sudo -u nobody whoami; sudo id -u; whoami'), 'root\nnobody\n0\nubuntu\n');
  assert.match(await out('sudo -l'), /User ubuntu may run the following commands on ubuntu:\n    \(ALL : ALL\) ALL\n/);
  assert.deepEqual(await sh('sudo nosuch'), { stdout: '', stderr: 'sudo: nosuch: command not found\n', code: 1 });
  assert.equal((await sh('sudo cat /etc/shadow >/dev/null; cat /etc/shadow')).code, 1);
  assert.equal(await out("sudo -i <<< 'whoami; pwd'; echo 'id -un' | sudo su -; whoami"), 'root\n/root\nroot\nubuntu\n');
  const run = await session();
  assert.equal((await run('sudo -i')).code, 0);
  assert.equal((await run('whoami; id -u; pwd; echo $HOME $SUDO_USER')).stdout, 'root\n0\n/root\n/root ubuntu\n');
  assert.equal((await run('exit')).stdout, 'logout\n');
  assert.equal((await run('whoami; pwd')).stdout, 'ubuntu\n/home/ubuntu\n');
  await run('sudo su');
  assert.equal((await run('whoami; pwd')).stdout, 'root\n/home/ubuntu\n');
  await run('exit');
  await run('sudo su -');
  assert.equal((await run('whoami; pwd')).stdout, 'root\n/root\n');
  await run('exit');
  assert.equal((await run('whoami')).stdout, 'ubuntu\n');
  assert.deepEqual(await run('su'), { stdout: '', stderr: 'su: Authentication failure\n', code: 1 });
  const redirect = await run('sudo echo x > /root/f');
  assert.equal(redirect.code, 1);
  assert.match(redirect.stderr, /\/root\/f: Permission denied/);
  if ((await run('command -v tee')).code === 0) {
    assert.equal((await run('echo x | sudo tee /root/f')).stdout, 'x\n');
    assert.equal((await run('sudo cat /root/f')).stdout, 'x\n');
  }
});

test('user administration', async () => {
  const denied = await sh('useradd bob');
  assert.deepEqual([denied.code, denied.stderr], [1, 'useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n']);
  const run = await session('root');
  assert.equal((await run('useradd -m -s /bin/bash bob')).code, 0);
  assert.equal((await run('getent passwd bob; id bob')).stdout, 'bob:x:1001:1001::/home/bob:/bin/bash\nuid=1001(bob) gid=1001(bob) groups=1001(bob)\n');
  assert.equal((await run('test -f /home/bob/.bashrc && echo home')).stdout, 'home\n');
  assert.equal((await run('useradd bob')).stderr, "useradd: user 'bob' already exists\n");
  assert.equal((await run('su bob -c whoami')).stdout, 'bob\n');
  await run('su - bob');
  assert.equal((await run('whoami; pwd')).stdout, 'bob\n/home/bob\n');
  assert.deepEqual(await run('sudo ls'), { stdout: '', stderr: 'bob is not in the sudoers file.\n', code: 1 });
  assert.equal((await run('passwd')).stdout, 'passwd: password updated successfully\n');
  assert.equal((await run('passwd root')).stderr, 'passwd: You may not view or modify password information for root.\n');
  await run('exit');
  assert.equal((await run('whoami')).stdout, 'root\n');
  assert.equal((await run('usermod -aG sudo bob; groups bob')).stdout, 'bob : bob sudo\n');
  assert.match((await run('passwd -S bob')).stdout, /^bob P \d{4}-\d\d-\d\d 0 99999 7 -1\n$/);
  const add = await run('adduser carol');
  assert.match(add.stdout, /^info: Adding user `carol' \.\.\.\n[\s\S]*info: Adding user `carol' to group `users' \.\.\.\n$/);
  assert.equal((await run('id carol')).stdout, 'uid=1002(carol) gid=1002(carol) groups=1002(carol),100(users)\n');
  assert.equal((await run('groupadd devs; getent group devs; groupdel devs; getent group devs; echo $?')).stdout, 'devs:x:1003:\n2\n');
  assert.equal((await run('groupdel bob')).stderr, "groupdel: cannot remove the primary group of user 'bob'\n");
  assert.equal((await run('userdel -r carol; test -d /home/carol; echo $?; id carol')).stdout, '1\n');
  assert.equal((await run('chsh -s /bin/sh bob; getent passwd bob')).stdout, 'bob:x:1001:1001::/home/bob:/bin/sh\n');
});

test('checksums, base64, expr, bc, factor', async () => {
  assert.equal(await out('echo hello | md5sum'), 'b1946ac92492d2347c6235b4d2611184  -\n');
  assert.equal(await out('echo hello | sha1sum'), 'f572d396fae9206628714fb2ce00f72e94f2258f  -\n');
  assert.equal(await out('echo hello > /tmp/f; sha256sum /tmp/f'), '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  /tmp/f\n');
  assert.match(await out('echo hello | sha512sum'), /^e7c22b994c59d9cf2b48e549b1e24666636045930d3da7c1acb299d1c3b7f931f94aae41edda2c2b207a36e10f8bcb8d45223e54878f5b316e7ce3b6bc019629  -\n$/);
  const check = await sh('echo a > /tmp/a; md5sum /tmp/a > /tmp/s; md5sum -c /tmp/s; echo b > /tmp/a; md5sum -c /tmp/s');
  assert.deepEqual([check.stdout, check.stderr, check.code], ['/tmp/a: OK\n/tmp/a: FAILED\n', 'md5sum: WARNING: 1 computed checksum did NOT match\n', 1]);
  assert.equal(await out('echo hello | base64; echo aGVsbG8K | base64 -d; printf hi | base64 -w0'), 'aGVsbG8K\nhello\naGk=');
  assert.equal(await out('echo hello | cksum'), '3015617425 6\n');
  assert.equal(await out('expr 1 + 2 \\* 3; expr length hello; expr substr hello 2 3; expr index hello l; expr abc : "a\\(.\\)c"'), '7\n5\nell\n3\nb\n');
  assert.equal(await out('expr 3 \\< 10; expr a \\< b; expr 0; echo $?'), '1\n1\n0\n1\n');
  assert.deepEqual(await sh('expr 1 +'), { stdout: '', stderr: 'expr: syntax error: missing argument after ‘+’\n', code: 2 });
  assert.equal((await sh('expr a + 1')).stderr, 'expr: non-integer argument\n');
  assert.equal(await out('bc', 'scale=2; 10/3\n7/2\n2^100\nx=5; x*x\n-1/2\nobase=2; 10\n'), '3.33\n3.50\n1267650600228229401496703205376\n25\n-.50\n1010\n');
  assert.equal(await out('bc', '7/2\n7%3\nsqrt(16)\n'), '3\n1\n4\n');
  assert.equal(await out('bc -l', '4*a(1)\ns(1)\nl(2)\ne(1)\nsqrt(2)\n'), '3.14159265358979323844\n.84147098480789650665\n.69314718055994530941\n2.71828182845904523536\n1.41421356237309504880\n');
  assert.equal(await out('bc', 'for (i = 1; i <= 3; i++) i\nif (2 > 1) print "yes\\n"\n'), '1\n2\n3\nyes\n');
  assert.deepEqual(await sh('bc', '1/0\n1 +\n'), { stdout: '', stderr: 'Runtime error (func=(main), adr=0): Divide by zero\n(standard_in) 2: syntax error\n', code: 0 });
  assert.equal(await out('factor 12 97 600851475143'), '12: 2 2 3\n97: 97\n600851475143: 71 839 1471 6857\n');
  assert.equal(await out('shuf -i 1-5 | sort -n | tr "\\n" " "; shuf -n 2 -e a b c | wc -l'), '1 2 3 4 5 2\n');
});

test('networking without the network', async () => {
  const ping = await sh('ping -c 2 -i 0.01 localhost');
  assert.equal(ping.code, 0);
  assert.match(ping.stdout, /^PING localhost \(127\.0\.0\.1\) 56\(84\) bytes of data\.\n64 bytes from localhost \(127\.0\.0\.1\): icmp_seq=1 ttl=64 time=0\.\d{3} ms\n64 bytes from localhost \(127\.0\.0\.1\): icmp_seq=2 ttl=64 time=0\.\d{3} ms\n\n--- localhost ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss, time \d+ms\nrtt min\/avg\/max\/mdev = [\d.]+\/[\d.]+\/[\d.]+\/[\d.]+ ms\n$/);
  assert.match(await out('ping6 -c 1 ::1'), /^PING ::1\(::1\) 56 data bytes\n64 bytes from ::1: icmp_seq=1 ttl=64 /);
  const bad = await sh('ping -c 1 x.invalid');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^ping: x\.invalid: (Name or service not known|Temporary failure in name resolution)\n$/);
  assert.equal((await sh('ping -6 -c 1 127.0.0.1')).stderr, 'ping: 127.0.0.1: Address family for hostname not supported\n');
  const rt = await Runtime.boot();
  const running = rt.exec('ping localhost');
  setTimeout(() => rt.interrupt(), 50);
  assert.match((await running).stdout, /icmp_seq=1 [\s\S]*--- localhost ping statistics ---\n1 packets transmitted, 1 received/);
  assert.match(await out('traceroute localhost'), /^traceroute to localhost \(127\.0\.0\.1\), 30 hops max, 60 byte packets\n 1  localhost \(127\.0\.0\.1\)  [\d.]+ ms  [\d.]+ ms  [\d.]+ ms\n$/);
  assert.match(await out('tracepath localhost'), /^ 1\?: \[LOCALHOST\] +pmtu 65535\n 1:  localhost +[\d.]+ms reached\n     Resume: pmtu 65535 hops 1 back 1 \n$/);
  assert.equal(await out('host localhost'), 'localhost has address 127.0.0.1\nlocalhost has IPv6 address ::1\n');
  assert.equal(await out('dig +short localhost; dig +noall +answer localhost'), '127.0.0.1\nlocalhost.\t\t0\tIN\tA\t127.0.0.1\n');
  assert.match(await out('dig localhost'), /status: NOERROR[\s\S]*;; QUESTION SECTION:\n;localhost\.\t\t\tIN\tA\n\n;; ANSWER SECTION:\nlocalhost\.\t\t0\tIN\tA\t127\.0\.0\.1\n/);
  assert.equal(await out('nslookup localhost'), 'Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\nNon-authoritative answer:\nName:\tlocalhost\nAddress: 127.0.0.1\nName:\tlocalhost\nAddress: ::1\n\n');
  const nx = await sh('host x.invalid');
  assert.equal(nx.code, 1);
  assert.match(nx.stdout, /^(Host x\.invalid not found: 3\(NXDOMAIN\)|;; connection timed out; no servers could be reached)\n$/);
  assert.equal(await out('getent passwd ubuntu 0; getent group sudo; getent hosts localhost'), 'ubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash\nroot:x:0:0:root:/root:/bin/bash\nsudo:x:27:ubuntu\n127.0.0.1       localhost\n');
  assert.equal((await sh('getent passwd nosuch')).code, 2);
  assert.match(await out('ip a'), /2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 [\s\S]*inet 10\.0\.2\.15\/24 /);
  assert.equal((await out('ip route')).split('\n')[0], 'default via 10.0.2.2 dev eth0 proto dhcp src 10.0.2.15 metric 100 ');
  assert.equal((await sh('ip foo')).code, 255);
});

test('services and power', async () => {
  assert.match(await out('systemctl status ssh'), /^● ssh\.service - OpenBSD Secure Shell server\n.*\n     Active: active \(running\) since /);
  const denied = await sh('systemctl stop ssh');
  assert.deepEqual([denied.code, denied.stderr.split('\n')[0]], [1, 'Failed to stop ssh.service: Interactive authentication required.']);
  const run = await machine('root');
  assert.deepEqual(await run('systemctl stop ssh; systemctl is-active ssh'), { stdout: 'inactive\n', stderr: '', code: 3 });
  assert.equal((await run('service ssh start; systemctl is-active ssh')).stdout, 'active\n');
  assert.equal((await run('systemctl status nope')).code, 4);
  assert.match(await out('systemctl list-units'), /cron\.service +loaded active +running Regular background program processing daemon\n/);
  assert.equal(await out('service --status-all'), ' [ + ]  cron\n [ + ]  rsyslog\n [ + ]  ssh\n');
  assert.deepEqual(await sh('reboot'), { stdout: '', stderr: 'Call to Reboot failed: Interactive authentication required.\n', code: 1 });
  assert.equal((await run('reboot; echo $?')).stdout, '1\n');
  assert.equal(await out('sync && echo ok'), 'ok\n');
});
