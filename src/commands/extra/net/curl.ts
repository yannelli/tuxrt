import { readAll } from '../../../shell/io.ts';
import { FsError } from '../../../vfs/errors.ts';
import type { Ctx } from '../../types.ts';
import { fromBytes, toBytes } from '../bytes.ts';
import {
  abortCode, ArgError, causeCode, defaultPort, DNS_ERRORS, parseUrl, requestSignal, scanArgs, withScheme, type Opt,
} from './argv.ts';
import { CURL_HELP, headerBlock, headerLines, progressMeter, writeOut, type Outcome } from './curlfmt.ts';

const SPEC = {
  flags: 'sSOLIifkvh',
  values: 'oXHdwAum',
  long: {
    silent: 's', 'show-error': 'S', 'remote-name': 'O', location: 'L', head: 'I', include: 'i', fail: 'f',
    insecure: 'k', verbose: 'v', help: 'h', compressed: 'compressed', 'output=': 'o', 'request=': 'X',
    'header=': 'H', 'data=': 'd', 'data-ascii=': 'd', 'data-raw=': 'data-raw', 'data-binary=': 'data-binary',
    'write-out=': 'w', 'user-agent=': 'A', 'user=': 'u', 'max-time=': 'm', 'url=': 'url',
  },
};

const HINT = "curl: try 'curl --help' or 'curl --manual' for more information\n";

interface CurlOpts {
  urls: string[];
  /** Paired with URLs in order; null means -O (remote name). */
  outputs: (string | null)[];
  flags: Set<string>;
  method: string | null;
  headers: string[];
  data: Opt[];
  writeOut: string | null;
  agent: string;
  user: string | null;
  maxTime: number;
}

function parse(args: string[]): CurlOpts | string {
  const { opts, operands } = scanArgs(args, SPEC);
  const o: CurlOpts = {
    urls: operands, outputs: [], flags: new Set(), method: null, headers: [], data: [],
    writeOut: null, agent: 'curl/8.5.0', user: null, maxTime: 0,
  };
  for (const [key, value] of opts) {
    const v = String(value);
    if (value === true) o.flags.add(key);
    else if (key === 'o') o.outputs.push(v);
    else if (key === 'X') o.method = v;
    else if (key === 'H') o.headers.push(v);
    else if (key === 'w') o.writeOut = v;
    else if (key === 'A') o.agent = v;
    else if (key === 'u') o.user = v;
    else if (key === 'url') o.urls.push(v);
    else if (key === 'm') {
      o.maxTime = Number(v);
      if (!(o.maxTime >= 0)) return `option -m: expected a proper numerical parameter`;
    } else o.data.push([key, v]);
    if (key === 'O') o.outputs.push(null);
  }
  return o;
}

async function postData(ctx: Ctx, o: CurlOpts): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!o.data.length) return undefined;
  const parts: string[] = [];
  for (const [kind, value] of o.data) {
    const v = String(value);
    if (kind === 'data-raw' || !v.startsWith('@')) {
      parts.push(v);
      continue;
    }
    const file = v.slice(1);
    let text = '';
    try {
      text = file === '-' ? await readAll(ctx.stdin) : ctx.vfs.readFile(ctx.shell.abs(file));
    } catch (e) {
      if (!(e instanceof FsError)) throw e;
      if (!o.flags.has('s')) ctx.stderr.write(`Warning: Couldn't read data from file "${file}", this makes an empty POST.\n`);
    }
    parts.push(kind === 'd' ? text.replace(/[\r\n]/g, '') : text);
  }
  return new Uint8Array(toBytes(parts.join('&')));
}

function credentials(o: CurlOpts, url: URL): string | null {
  if (o.user !== null || !url.username) return o.user;
  return `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
}

function requestHeaders(o: CurlOpts, url: URL, body: Uint8Array | undefined): [string, string][] {
  const list: [string, string][] = [['Host', url.host], ['User-Agent', o.agent], ['Accept', '*/*']];
  const user = credentials(o, url);
  if (user !== null) list.push(['Authorization', `Basic ${Buffer.from(user).toString('base64')}`]);
  if (body) list.push(['Content-Length', String(body.length)], ['Content-Type', 'application/x-www-form-urlencoded']);
  for (const h of o.headers) {
    const m = /^([^:;]+)([:;])\s*(.*)$/s.exec(h);
    if (!m) continue;
    const name = m[1].trim();
    const at = list.findIndex(([n]) => n.toLowerCase() === name.toLowerCase());
    if (at !== -1) list.splice(at, 1);
    if (m[2] === ';' || m[3] !== '') list.push([name, m[3]]);
  }
  return list;
}

function failure(e: unknown, url: URL, ms: number, timedOut: boolean): [number, string] {
  const where = `${url.hostname} port ${defaultPort(url)} after ${ms} ms`;
  const code = causeCode(e);
  if (timedOut) return [28, `Operation timed out after ${ms} milliseconds with 0 bytes received`];
  if (DNS_ERRORS.has(code)) return [6, `Could not resolve host: ${url.hostname}`];
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return [28, `Failed to connect to ${where}: Timeout was reached`];
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return [56, 'Recv failure: Connection reset by peer'];
  if (/CERT|SSL|TLS/.test(code)) return [60, `SSL certificate problem: ${(e as { cause: Error }).cause.message}`];
  if (!(e as { cause?: unknown }).cause) return [43, 'A libcurl function was given a bad argument'];
  return [7, `Failed to connect to ${where}: Couldn't connect to server`];
}

async function transfer(ctx: Ctx, o: CurlOpts, raw: string, output: string | null | undefined, body?: Uint8Array<ArrayBuffer>): Promise<number> {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  const loud = !o.flags.has('s') || o.flags.has('S');
  const outcome: Outcome = { url: raw, status: 0, contentType: '', redirectUrl: '', size: 0, ms: 0 };
  const finish = (code: number, msg?: string) => {
    if (msg && loud) ctx.stderr.write(`curl: ${code ? `(${code}) ` : ''}${msg}\n`);
    outcome.ms = elapsed();
    if (o.writeOut !== null) ctx.stdout.write(writeOut(o.writeOut, outcome, (m) => ctx.stderr.write(`curl: ${m}\n`)));
    return code;
  };
  const url = parseUrl(withScheme(raw));
  if (!url) return finish(3, 'URL rejected: Malformed input to a URL function');
  outcome.url = url.href;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return finish(1, `Protocol "${url.protocol.slice(0, -1)}" not supported`);
  const file = output === null ? url.pathname.slice(url.pathname.lastIndexOf('/') + 1) : output;
  if (file === '') return (finish(0, 'Remote file name has no length!'), 23);

  const follow = o.flags.has('L');
  const method = o.method ?? (o.flags.has('I') ? 'HEAD' : body ? 'POST' : 'GET');
  const headers = requestHeaders(o, url, body);
  if (o.flags.has('v')) {
    const lines = [`${method} ${url.pathname}${url.search} HTTP/1.1`, ...headers.map(([n, v]) => `${n}: ${v}`), ''];
    ctx.stderr.write(lines.map((l) => `> ${l}\r\n`).join(''));
  }
  const sent = headers.filter(([n]) => n !== 'Host' && n !== 'Content-Length');
  // undici decompresses transparently, so ask for identity to keep sizes and bytes as sent.
  if (!o.flags.has('compressed') && !sent.some(([n]) => n.toLowerCase() === 'accept-encoding')) sent.push(['Accept-Encoding', 'identity']);
  const target = new URL(url);
  target.username = target.password = '';
  const req = requestSignal(ctx.signal, o.maxTime * 1000);
  let res: Response;
  let data = new Uint8Array();
  try {
    res = await fetch(target, { method, headers: sent, body, redirect: follow ? 'follow' : 'manual', signal: req.signal });
    const redirect = !follow && res.status >= 300 && res.status < 400;
    if (method !== 'HEAD' && !redirect) data = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (ctx.signal.aborted) return abortCode(ctx.signal);
    return finish(...failure(e, url, elapsed(), req.timedOut()));
  } finally {
    req.release();
  }

  outcome.status = res.status;
  outcome.contentType = res.headers.get('content-type') ?? '';
  outcome.url = res.url || url.href;
  outcome.size = data.length;
  const location = res.headers.get('location');
  if (!follow && location && res.status >= 300 && res.status < 400) outcome.redirectUrl = parseUrl(location, url)?.href ?? '';
  if (o.flags.has('v')) ctx.stderr.write([...headerLines(res), ''].map((l) => `< ${l}\r\n`).join(''));
  if (o.flags.has('f') && res.status >= 400) return finish(22, `The requested URL returned error: ${res.status}`);

  const head = o.flags.has('i') || o.flags.has('I') ? headerBlock(res) : '';
  const text = fromBytes(Buffer.concat([Buffer.from(head), data]));
  if (file === undefined || file === '-') {
    ctx.stdout.write(text);
    return finish(0);
  }
  if (!o.flags.has('s')) ctx.stderr.write(progressMeter(data.length, res.headers.has('content-length'), elapsed()));
  try {
    ctx.vfs.writeFile(ctx.shell.abs(file), text);
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    if (!o.flags.has('s')) ctx.stderr.write(`Warning: Failed to open the file ${file}: ${e.message}\n`);
    return finish(23, 'Failure writing output to destination');
  }
  return finish(0);
}

export async function curl(ctx: Ctx): Promise<number> {
  if (!ctx.args.length) return (ctx.stderr.write(HINT), 2);
  let o: CurlOpts | string;
  try {
    o = parse(ctx.args);
  } catch (e) {
    if (!(e instanceof ArgError)) throw e;
    const opt = e.option.startsWith('--') ? e.option.split('=')[0] : `-${e.option}`;
    o = `option ${opt}: ${e.missing ? 'requires parameter' : 'is unknown'}`;
  }
  if (typeof o === 'string') return (ctx.stderr.write(`curl: ${o}\n${HINT}`), 2);
  if (o.flags.has('h')) return (ctx.stdout.write(CURL_HELP), 0);
  if (!o.urls.length) return (ctx.stderr.write(`curl: no URL specified!\n${HINT}`), 2);
  const body = await postData(ctx, o);
  let status = 0;
  for (const [i, url] of o.urls.entries()) {
    status = (await transfer(ctx, o, url, o.outputs[i], body)) || status;
    if (ctx.signal.aborted) return abortCode(ctx.signal);
  }
  return status;
}
