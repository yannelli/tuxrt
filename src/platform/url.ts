import { utf8Encode } from '../vfs/bytes.ts';

export interface Url {
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443', 'file:': '' };
const encode = (s: string, extra: RegExp) => s.replace(extra, (c) => [...utf8Encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''));
const PATH_UNSAFE = /[\x00-\x20"#<>?`{}\x7f]|[^\x00-\x7f]/gu;
const QUERY_UNSAFE = /[\x00-\x20"#<>'\x7f]|[^\x00-\x7f]/gu;
const FRAGMENT_UNSAFE = /[\x00-\x20"<>`\x7f]|[^\x00-\x7f]/gu;

function normalizePath(path: string): string {
  const out: string[] = [];
  const segs = path.split('/').slice(1);
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s === '.' || s.toLowerCase() === '%2e') return last && out.push('');
    if (s === '..' || /^(\.|%2e){2}$/i.test(s)) {
      out.pop();
      return last && out.push('');
    }
    out.push(s);
  });
  return `/${out.join('/')}`;
}

/** WHATWG URL parsing for the special schemes, used only when the engine has no global URL (JavaScriptCore, QuickJS). */
export class MiniUrl implements Url {
  protocol = '';
  username = '';
  password = '';
  hostname = '';
  port = '';
  pathname = '';
  search = '';
  hash = '';
  private opaque = false;

  constructor(input: string, base?: string | Url) {
    let s = input.trim().replace(/[\t\n\r]/g, '');
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(s);
    if (!scheme) {
      if (base === undefined) throw new TypeError('Invalid URL');
      const b = typeof base === 'string' ? new MiniUrl(base) : base;
      if (!(b.protocol in DEFAULT_PORTS)) throw new TypeError('Invalid URL');
      s = s.replace(/\\/g, '/');
      if (s.startsWith('//')) s = `${b.protocol}${s}`;
      else {
        const auth = `${b.protocol}//${b.username ? `${b.username}${b.password ? `:${b.password}` : ''}@` : ''}${b.host}`;
        if (s.startsWith('/')) s = auth + s;
        else if (s.startsWith('?')) s = auth + b.pathname + s;
        else if (s.startsWith('#') || s === '') s = auth + b.pathname + b.search + s;
        else s = auth + b.pathname.replace(/[^/]*$/, '') + s;
      }
      return this.parse(s);
    }
    this.parse(s);
  }

  private parse(s: string): MiniUrl {
    const [, scheme] = /^([a-z][a-z\d+.-]*):/i.exec(s)!;
    this.protocol = `${scheme.toLowerCase()}:`;
    let rest = s.slice(scheme.length + 1);
    const hashAt = rest.indexOf('#');
    if (hashAt !== -1) {
      this.hash = rest.length > hashAt + 1 ? encode(rest.slice(hashAt), FRAGMENT_UNSAFE) : '';
      rest = rest.slice(0, hashAt);
    }
    const queryAt = rest.indexOf('?');
    if (queryAt !== -1) {
      this.search = rest.length > queryAt + 1 ? encode(rest.slice(queryAt), QUERY_UNSAFE) : '';
      rest = rest.slice(0, queryAt);
    }
    if (!(this.protocol in DEFAULT_PORTS)) {
      this.opaque = !rest.startsWith('//');
      if (this.opaque) return (this.pathname = rest), this;
    }
    rest = rest.replace(/\\/g, '/').replace(this.protocol === 'file:' ? /^\/\// : /^\/*/, '');
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const at = authority.lastIndexOf('@');
    if (at !== -1) {
      const [user, ...pass] = authority.slice(0, at).split(':');
      this.username = encode(user, PATH_UNSAFE);
      this.password = encode(pass.join(':'), PATH_UNSAFE);
    }
    const hostPort = authority.slice(at + 1);
    const m = /^(\[[\da-f:.]+\]|[^:]*)(?::(\d*))?$/i.exec(hostPort);
    if (!m || /[\s<>^|%]/.test(m[1]) || (!m[1] && this.protocol !== 'file:')) throw new TypeError('Invalid URL');
    this.hostname = m[1].toLowerCase();
    const port = m[2] ?? '';
    if (port && Number(port) > 65535) throw new TypeError('Invalid URL');
    this.port = port === '' || String(Number(port)) === DEFAULT_PORTS[this.protocol] ? '' : String(Number(port));
    this.pathname = normalizePath(encode(slash === -1 ? '/' : rest.slice(slash), PATH_UNSAFE));
    return this;
  }

  get host(): string {
    return this.port ? `${this.hostname}:${this.port}` : this.hostname;
  }

  get href(): string {
    if (this.opaque) return `${this.protocol}${this.pathname}${this.search}${this.hash}`;
    const auth = this.username || this.password ? `${this.username}${this.password ? `:${this.password}` : ''}@` : '';
    return `${this.protocol}//${auth}${this.host}${this.pathname}${this.search}${this.hash}`;
  }

  toString(): string {
    return this.href;
  }
}

type UrlConstructor = new (input: string, base?: string | Url) => Url;
export const URL: UrlConstructor = (globalThis as { URL?: UrlConstructor }).URL ?? MiniUrl;
