export function stamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** wget's human_readable: binary units, `decimals` places below `acc`. */
export function human(n: number, acc: number, decimals: number): string {
  if (n < 1024) return String(n);
  let val = n / 1024;
  let i = 0;
  for (; val >= 1024 && i < 7; i++) val /= 1024;
  return `${val.toFixed(val < acc ? decimals : 0)}${'KMGTPEZY'[i]}`;
}

function rate(bytes: number, ms: number): [number, number] {
  let r = bytes / Math.max(ms / 1000, 0.0005);
  let unit = 0;
  for (; r >= 1024 && unit < 3; unit++) r /= 1024;
  return [r, unit];
}

const places = (r: number) => (r >= 99.95 ? 0 : r >= 9.995 ? 1 : 2);

export function retrRate(bytes: number, ms: number): string {
  const [r, unit] = rate(bytes, ms);
  return `${r.toFixed(places(r))} ${['B/s', 'KB/s', 'MB/s', 'GB/s'][unit]}`;
}

function decimals(secs: number): string {
  if (secs >= 9.95) return secs.toFixed(0);
  if (secs >= 0.95) return secs.toFixed(1);
  if (secs >= 0.001) return String(Number(secs.toPrecision(1)));
  return secs >= 0.0005 ? secs.toFixed(3) : '0';
}

function shortEta(secs: number): string {
  if (secs < 100) return `${secs}s`;
  if (secs < 6000) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 48 * 3600) return `${Math.floor(secs / 3600)}h ${Math.floor(secs / 60) % 60}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor(secs / 3600) % 24}h`;
}

const WIDTH = 79;
const NAME_COLS = Math.floor(WIDTH / 4);
const BAR_COLS = WIDTH - (NAME_COLS + 1 + 4 + 2 + 8 + 10 + 15);

/** The final frame of wget's default "bar" progress indicator, for an 80-column terminal. */
export function progressBar(name: string, size: number, known: boolean, ms: number): string {
  const pct = known ? '100%' : '    ';
  const bar = known ? `${'='.repeat(BAR_COLS - 1)}>` : ' <=>'.padEnd(BAR_COLS);
  // wget only samples speed after 150 ms, so faster transfers show a placeholder.
  const [r, unit] = rate(size, ms);
  const speed = ms < 150 ? '--.-KB/s' : `${r.toFixed(places(r)).padStart(4)}${[' B/s', 'KB/s', 'MB/s', 'GB/s'][unit]}`;
  const secs = ms / 1000;
  const took = secs >= 10 ? shortEta(Math.round(secs)) : `${decimals(secs)}s`;
  return [
    name.slice(0, NAME_COLS).padEnd(NAME_COLS + 1), pct, `[${bar}]`,
    human(size, 1000, 2).padStart(8), `  ${speed}`, `    in ${took}`.padEnd(15),
  ].join('');
}

export const WGET_USAGE = 'Usage: wget [OPTION]... [URL]...\n';
export const WGET_TRY = `${WGET_USAGE}\nTry \`wget --help' for more options.\n`;

export const WGET_HELP = `GNU Wget 1.21.4, a non-interactive network retriever.
${WGET_USAGE}
Mandatory arguments to long options are mandatory for short options too.

Startup:
  -h,  --help                      print this help

Logging and input file:
  -q,  --quiet                     quiet (no output)

Download:
  -O,  --output-document=FILE      write documents to FILE
  -c,  --continue                  resume getting a partially-downloaded file
  -U,  --user-agent=AGENT          identify as AGENT instead of Wget/VERSION
       --header=STRING             insert STRING among the headers
       --no-check-certificate      don't validate the server's certificate

Directories:
  -P,  --directory-prefix=PREFIX   save files to PREFIX/..

Mail bug reports and suggestions to <bug-wget@gnu.org>
`;
