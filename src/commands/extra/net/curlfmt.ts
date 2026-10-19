import { STATUS_CODES } from 'node:http';

export interface Outcome {
  url: string;
  status: number;
  contentType: string;
  redirectUrl: string;
  size: number;
  ms: number;
}

export function reason(res: Response): string {
  return res.statusText || STATUS_CODES[res.status] || '';
}

export function statusLine(res: Response): string {
  return `HTTP/1.1 ${res.status} ${reason(res)}`;
}

export function headerLines(res: Response): string[] {
  const out = [statusLine(res)];
  for (const [name, value] of res.headers) {
    if (name === 'set-cookie') continue;
    out.push(`${name}: ${value}`);
  }
  for (const cookie of res.headers.getSetCookie()) out.push(`set-cookie: ${cookie}`);
  return out;
}

export function headerBlock(res: Response): string {
  return `${headerLines(res).join('\r\n')}\r\n\r\n`;
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\' };

/** Expands -w formats; unknown variables warn on stderr and expand to nothing, like curl. */
export function writeOut(fmt: string, o: Outcome, warn: (msg: string) => void): string {
  const code = String(o.status).padStart(3, '0');
  const vars: Record<string, string> = {
    http_code: code,
    response_code: code,
    url_effective: o.url,
    content_type: o.contentType,
    size_download: String(o.size),
    time_total: (o.ms / 1000).toFixed(6),
    redirect_url: o.redirectUrl,
  };
  return fmt.replace(/%\{([^}]*)\}|%%|\\([nrt\\])/g, (all, name: string | undefined, esc: string | undefined) => {
    if (esc) return ESCAPES[esc];
    if (name === undefined) return '%';
    if (name in vars) return vars[name];
    warn(`unknown --write-out variable: '${name}'`);
    return '';
  });
}

const KB = 1024;
const MB = KB * KB;

/** curl's max5data: any byte count squeezed into five columns. */
function max5(n: number): string {
  if (n < 100000) return String(n).padStart(5);
  if (n < 10000 * KB) return `${String(Math.floor(n / KB)).padStart(4)}k`;
  if (n < 100 * MB) return `${String(Math.floor(n / MB)).padStart(2)}.${Math.floor((n % MB) / (MB / 10))}M`;
  if (n < 10000 * MB) return `${String(Math.floor(n / MB)).padStart(4)}M`;
  return `${String(Math.floor(n / (KB * MB))).padStart(4)}G`;
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s <= 0) return '--:--:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(Math.floor(s / 3600)).padStart(2)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** The classic meter, reduced to its final row since transfers complete in one step here. */
export function progressMeter(size: number, known: boolean, ms: number): string {
  const speed = Math.floor(size / Math.max(ms / 1000, 0.001));
  const total = known ? clock(ms) : '--:--:--';
  const pct = (on: boolean) => (on && size > 0 ? '100' : '  0');
  const row = [
    `${pct(true)} ${max5(size)}  ${pct(known)} ${max5(size)}    0 ${max5(0)}  ${max5(speed)}  ${max5(0)}`,
    total, clock(ms), '--:--:--', max5(speed),
  ].join(' ');
  return (
    '  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n' +
    '                                 Dload  Upload   Total   Spent    Left  Speed\n' +
    `${row}\n`
  );
}

export const CURL_HELP = `Usage: curl [options...] <url>
 -d, --data <data>           HTTP POST data
 -f, --fail                  Fail fast with no output on HTTP errors
 -h, --help <category>       Get help for commands
 -H, --header <header/@file> Pass custom header(s) to server
 -i, --include               Include protocol response headers in the output
 -I, --head                  Show document info only
 -L, --location              Follow redirects
 -o, --output <file>         Write to file instead of stdout
 -O, --remote-name           Write output to a file named as the remote file
 -s, --silent                Silent mode
 -S, --show-error            Show error even when -s is used
 -u, --user <user:password>  Server user and password
 -A, --user-agent <name>     Send User-Agent <name> to server
 -v, --verbose               Make the operation more talkative
 -w, --write-out <format>    Use output FORMAT after completion
 -X, --request <method>      Specify request method to use

This is not the full help, this menu is stripped into categories.
Use "--help category" to get an overview of all categories.
For all options use the manual or "--help all".
`;
