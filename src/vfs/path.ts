export function normalize(path: string, cwd = '/'): string {
  const abs = path.startsWith('/') ? path : `${cwd}/${path}`;
  const out: string[] = [];
  for (const part of abs.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

export function split(path: string): string[] {
  return path.split('/').filter((p) => p !== '');
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '.';
  return idx === 0 ? '/' : trimmed.slice(0, idx);
}

export function basename(path: string, suffix?: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return path.startsWith('/') ? '/' : '';
  let base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if (suffix && base !== suffix && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  return base;
}

export function join(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/').replace(/\/{2,}/g, '/');
}
