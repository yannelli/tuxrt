export function escapeGlobChars(s: string): string {
  return s.replace(/[*?[\]\\]/g, '\\$&');
}

/** Quotes a string for safe reuse as shell input (xtrace, alias, declare -p, set). */
export function shellQuote(s: string): string {
  if (s !== '' && /^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
