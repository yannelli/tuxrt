import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { buildSync } from 'esbuild';

const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';
const smoke = readFileSync(new URL('./engines/smoke.js', import.meta.url), 'utf8');
const bundle = buildSync({ entryPoints: [new URL('../src/runtime.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], bundle: true, format: 'iife', globalName: 'tuxrt', target: 'es2020', write: false }).outputFiles[0].text;

interface Report {
  ran: number;
  failures: unknown[];
}

test('the bundle runs in a bare ECMAScript context with only timers', async () => {
  const report = await new Promise<Report>((resolve) => {
    const context = createContext({ setTimeout, clearTimeout, report: (s: string) => resolve(JSON.parse(s)) });
    runInContext(bundle, context);
    runInContext(smoke, context);
  });
  assert.deepEqual(report.failures, []);
  assert.ok(report.ran > 10);
});

test('the bundle runs in JavaScriptCore', { skip: !existsSync(JSC) && 'jsc is macOS-only' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tuxrt-jsc-'));
  writeFileSync(join(dir, 'tuxrt.js'), bundle);
  writeFileSync(join(dir, 'smoke.js'), smoke);
  const out = execFileSync(JSC, [join(dir, 'tuxrt.js'), join(dir, 'smoke.js')], { encoding: 'utf8', timeout: 60000 });
  const report = JSON.parse(out.trim().split('\n').pop()!) as Report;
  assert.deepEqual(report.failures, []);
});
