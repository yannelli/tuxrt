import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { FsError } from '../../../vfs/errors.ts';
import type { Ctx } from '../../types.ts';
import { fromBytes } from '../../../vfs/bytes.ts';
import {
  abortCode, ArgError, causeCode, defaultPort, DNS_ERRORS, parseUrl, requestSignal, scanArgs, untilAbort, withScheme,
} from './argv.ts';
import { reason } from './curlfmt.ts';
import { human, progressBar, retrRate, stamp, WGET_HELP, WGET_TRY } from './wgetfmt.ts';

const SPEC = {
  flags: 'qch',
  values: 'OPU',
  long: {
    quiet: 'q', continue: 'c', help: 'h', 'no-check-certificate': 'insecure',
    'output-document=': 'O', 'directory-prefix=': 'P', 'user-agent=': 'U', 'header=': 'header',
  },
};

const MAX_REDIRECTS = 20;

const CONNECT_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'Connection refused', ETIMEDOUT: 'Connection timed out', UND_ERR_CONNECT_TIMEOUT: 'Connection timed out',
  EHOSTUNREACH: 'No route to host', ENETUNREACH: 'Network is unreachable', ECONNRESET: 'Connection reset by peer',
};

interface WgetOpts {
  urls: string[];
  quiet: boolean;
  resume: boolean;
  output: string | null;
  outputUsed: boolean;
  prefix: string;
  headers: [string, string][];
}

function parse(args: string[]): WgetOpts | 'help' {
  const { opts, operands } = scanArgs(args, SPEC);
  const o: WgetOpts = { urls: operands, quiet: false, resume: false, output: null, outputUsed: false, prefix: '', headers: [] };
  let agent = 'Wget/1.21.4';
  for (const [key, value] of opts) {
    const v = String(value);
    if (key === 'h') return 'help';
    if (key === 'q') o.quiet = true;
    else if (key === 'c') o.resume = true;
    else if (key === 'O') o.output = v;
    else if (key === 'P') o.prefix = v;
    else if (key === 'U') agent = v;
    else if (key === 'header') {
      const at = v.indexOf(':');
      if (at > 0) o.headers.push([v.slice(0, at).trim(), v.slice(at + 1).trim()]);
    }
  }
  const named = new Set(o.headers.map(([n]) => n.toLowerCase()));
  const defaults: [string, string][] = [['User-Agent', agent], ['Accept', '*/*'], ['Accept-Encoding', 'identity']];
  o.headers.unshift(...defaults.filter(([n]) => !named.has(n.toLowerCase())));
  return o;
}

function remoteName(url: URL): string {
  const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {}
  return (name || 'index.html') + url.search;
}

/** Picks the local path: -O as given, else PREFIX/name with wget's .1, .2 ... suffixes for existing files. */
function localName(ctx: Ctx, o: WgetOpts, url: URL): string {
  if (o.output !== null) return o.output;
  const base = o.prefix ? `${o.prefix.replace(/\/+$/, '')}/${remoteName(url)}` : remoteName(url);
  if (o.resume) return base;
  let name = base;
  for (let n = 1; ctx.vfs.exists(ctx.shell.abs(name)); n++) name = `${base}.${n}`;
  return name;
}

function save(ctx: Ctx, o: WgetOpts, name: string, text: string): string | null {
  try {
    if (o.output === null && o.prefix) ctx.vfs.mkdir(ctx.shell.abs(o.prefix), true);
    const append = o.output !== null && o.outputUsed;
    o.outputUsed = true;
    ctx.vfs.writeFile(ctx.shell.abs(name), text, append);
    return null;
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    return e.message;
  }
}

async function resolveHost(ctx: Ctx, host: string, signal: AbortSignal, log: (s: string) => void): Promise<string | number> {
  log(`Resolving ${host} (${host})... `);
  try {
    const addrs = await untilAbort(lookup(host, { all: true }), signal);
    log(`${addrs.map((a) => a.address).join(', ')}\n`);
    return addrs[0].address;
  } catch (e) {
    if (ctx.signal.aborted) return abortCode(ctx.signal);
    const code = (e as { code?: string }).code;
    log(`failed: ${code === 'EAI_AGAIN' ? 'Temporary failure in name resolution' : 'Name or service not known'}.\n`);
    log(`wget: unable to resolve host address ‘${host}’\n`);
    return 4;
  }
}

async function retrieve(ctx: Ctx, o: WgetOpts, raw: string): Promise<number> {
  const log = (s: string) => {
    if (!o.quiet) ctx.stderr.write(s);
  };
  let url = parseUrl(withScheme(raw));
  if (!url) return (log(`${raw}: Invalid host name.\n`), 1);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return (log(`${raw}: Unsupported scheme ‘${url.protocol.slice(0, -1)}’.\n`), 1);
  const name = localName(ctx, o, url);
  let connected = '';
  for (let hops = 0; ; hops++) {
    log(`--${stamp()}--  ${url.href}\n`);
    const host = url.hostname;
    const port = defaultPort(url);
    const req = requestSignal(ctx.signal, 0);
    try {
      if (connected === `${host}:${port}`) log(`Reusing existing connection to ${host}:${port}.\n`);
      else if (isIP(host.replace(/^\[|\]$/g, ''))) log(`Connecting to ${host}:${port}... `);
      else {
        const ip = await resolveHost(ctx, host, req.signal, log);
        if (typeof ip === 'number') return ip;
        log(`Connecting to ${host} (${host})|${ip}|:${port}... `);
      }
      let res: Response;
      try {
        res = await fetch(url, { headers: o.headers, redirect: 'manual', signal: req.signal });
      } catch (e) {
        if (ctx.signal.aborted) return abortCode(ctx.signal);
        const code = causeCode(e);
        if (DNS_ERRORS.has(code)) return (log(`failed: Name or service not known.\nwget: unable to resolve host address ‘${host}’\n`), 4);
        const cause = (e as { cause?: Error }).cause;
        return (log(`failed: ${CONNECT_ERRORS[code] ?? cause?.message ?? (e as Error).message}.\n`), 4);
      }
      if (connected !== `${host}:${port}`) log('connected.\n');
      connected = `${host}:${port}`;
      log(`HTTP request sent, awaiting response... ${res.status} ${reason(res)}\n`);
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        log(`Location: ${location} [following]\n`);
        const next = parseUrl(location, url);
        if (!next || !/^https?:$/.test(next.protocol)) return (log(`${location}: Unsupported scheme.\n`), 1);
        if (hops + 1 >= MAX_REDIRECTS) return (log(`${MAX_REDIRECTS} redirections exceeded.\n`), 8);
        url = next;
        continue;
      }
      if (res.status >= 400) return (log(`${stamp()} ERROR ${res.status}: ${reason(res)}.\n\n`), 8);
      return await download(ctx, o, res, name, log);
    } finally {
      req.release();
    }
  }
}

async function download(ctx: Ctx, o: WgetOpts, res: Response, name: string, log: (s: string) => void): Promise<number> {
  const length = res.headers.get('content-length');
  const type = res.headers.get('content-type')?.split(';')[0].trim();
  const total = length === null ? null : Number(length);
  const sized = total === null ? 'unspecified' : `${total}${total >= 1024 ? ` (${human(total, 10, 1)})` : ''}`;
  log(`Length: ${sized}${type ? ` [${type}]` : ''}\n`);
  const toStdout = name === '-';
  log(`Saving to: ‘${toStdout ? 'STDOUT' : name}’\n\n`);
  const start = performance.now();
  let data: Uint8Array;
  try {
    data = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (ctx.signal.aborted) return abortCode(ctx.signal);
    return (log(`Read error at byte 0 (${(e as Error).message}).\n`), 4);
  }
  const text = fromBytes(data);
  const ms = performance.now() - start;
  if (toStdout) ctx.stdout.write(text);
  else {
    const err = save(ctx, o, name, text);
    if (err !== null) return (log(`Cannot write to ‘${name}’ (${err}).\n`), 3);
  }
  // Like wget, the bar label drops the -P prefix but keeps an -O path.
  const label = o.output === null && o.prefix ? name.slice(o.prefix.replace(/\/+$/, '').length + 1) : name;
  log(`${progressBar(label, data.length, total !== null, ms)}\n\n`);
  const counts = total === null ? `${data.length}` : `${data.length}/${total}`;
  const what = toStdout ? 'written to stdout' : `‘${name}’ saved`;
  log(`${stamp()} (${retrRate(data.length, ms)}) - ${what} [${counts}]\n\n`);
  return 0;
}

/** wget's precedence: among failures, the lowest exit code wins. */
function worst(a: number, b: number): number {
  return a === 0 ? b : b === 0 ? a : Math.min(a, b);
}

export async function wget(ctx: Ctx): Promise<number> {
  let o: WgetOpts | 'help';
  try {
    o = parse(ctx.args);
  } catch (e) {
    if (!(e instanceof ArgError)) throw e;
    const what = e.option.startsWith('--')
      ? e.missing ? `option '${e.option.split('=')[0]}' requires an argument` : `unrecognized option '${e.option}'`
      : e.message;
    return (ctx.stderr.write(`wget: ${what}\n${WGET_TRY}`), 2);
  }
  if (o === 'help') return (ctx.stdout.write(WGET_HELP), 0);
  if (!o.urls.length) return (ctx.stderr.write(`wget: missing URL\n${WGET_TRY}`), 1);
  let status = 0;
  for (const raw of o.urls) {
    status = worst(status, await retrieve(ctx, o, raw));
    if (ctx.signal.aborted) return abortCode(ctx.signal);
  }
  return status;
}
