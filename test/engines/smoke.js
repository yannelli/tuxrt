// Runs inside a bare JS engine after dist/tuxrt.js; reports through print (jsc) or report (test host).
(async () => {
  const say = globalThis.report ?? globalThis.print;
  const cases = [
    ['echo hi | tr a-z A-Z', 'HI\n'],
    ['uname -sm', 'Linux x86_64\n'],
    ['cd /tmp && printf "b\\na\\n" > f && sort f && wc -l < f', 'a\nb\n2\n'],
    [`echo '{"a":[1,2]}' | jq -c '.a | map(. * 2)'`, '[2,4]\n'],
    [`seq 3 | awk '{ s += $1 } END { print s }'`, '6\n'],
    ['echo hello | sed s/l/L/g | grep -c LL', '1\n'],
    ['cd /tmp && echo hello > h && gzip h && zcat h.gz', 'hello\n'],
    ['cd /tmp && mkdir d && echo x > d/f && tar czf d.tgz d && rm -r d && tar xzf d.tgz && cat d/f', 'x\n'],
    ['cd /tmp && zip -q z.zip d/f && unzip -p z.zip d/f', 'x\n'],
    ['printf abc | sha256sum', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\n'],
    ['printf abc | md5sum', '900150983cd24fb0d6963f7d28e17f72  -\n'],
    ['echo aGk= | base64 -d', 'hi'],
    ['sudo whoami', 'root\n'],
    ['man ls | grep -c "list directory contents"', '1\n'],
    ['cowsay moo | sed -n 2p', '< moo >\n'],
    ['sleep 0.05 && echo slept', 'slept\n'],
    ['ping -c 1 localhost | head -1', 'PING localhost (127.0.0.1) 56(84) bytes of data.\n'],
    ['type node 2>&1; echo $?', 'bash: type: node: not found\n1\n'],
  ];
  const failures = [];
  try {
    const rt = await tuxrt.Runtime.boot();
    for (const [cmd, want] of cases) {
      const r = await rt.exec(cmd);
      if (r.stdout !== want) failures.push({ cmd, want, got: r.stdout, stderr: r.stderr });
    }
  } catch (e) {
    failures.push({ error: String(e && e.stack || e) });
  }
  say(JSON.stringify({ ran: cases.length, failures }));
})();
