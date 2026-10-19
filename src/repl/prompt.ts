import type { Shell } from '../shell/shell.ts';

/** Expands bash PS1 escapes: \u \h \H \w \W \$ \n \t \T \d \e \[ \]. */
export function renderPrompt(ps: string, shell: Shell): string {
  const home = shell.get('HOME') ?? '';
  const cwd = shell.cwd;
  const w = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
  const now = new Date();
  const host = shell.get('HOSTNAME') ?? 'ubuntu';
  return ps.replace(/\\([uhHwW$ntTde\[\]\\])/g, (_, c: string) => {
    switch (c) {
      case 'u': return shell.user.name;
      case 'h': return host.split('.')[0];
      case 'H': return host;
      case 'w': return w;
      case 'W': return cwd === home ? '~' : cwd === '/' ? '/' : cwd.slice(cwd.lastIndexOf('/') + 1);
      case '$': return shell.user.uid === 0 ? '#' : '$';
      case 'n': return '\n';
      case 't': return now.toTimeString().slice(0, 8);
      case 'T': return now.toTimeString().slice(0, 8);
      case 'd': return now.toDateString().slice(0, 10);
      case 'e': return '\x1b';
      case '\\': return '\\';
      default: return '';
    }
  });
}
