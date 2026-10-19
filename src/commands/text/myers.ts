export type Op = { kind: '=' | '-' | '+'; a: number; b: number };

/** Edit distance beyond which we give up on a minimal script and emit a full replacement. */
const MAX_D = 2000;

/** Myers O(ND) diff over pre-hashed lines. Ops carry the current index into each side. */
export function diffOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ kind: '=', a: i, b: i });
  for (const o of core(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf))) ops.push({ kind: o.kind, a: o.a + pre, b: o.b + pre });
  for (let i = suf; i > 0; i--) ops.push({ kind: '=', a: a.length - i, b: b.length - i });
  return ops;
}

function core(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) (x++, y++);
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return [...a.map((_, i) => ({ kind: '-' as const, a: i, b: 0 })), ...b.map((_, j) => ({ kind: '+' as const, a: n, b: j }))];
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const at = (k: number) => v[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = d === 0 ? 0 : at(prevK);
    const py = d === 0 ? 0 : px - prevK;
    while (x > px && y > py) ops.push({ kind: '=', a: --x, b: --y });
    if (d > 0) ops.push(x === px ? { kind: '+', a: x, b: --y } : { kind: '-', a: --x, b: y });
  }
  return ops.reverse();
}
