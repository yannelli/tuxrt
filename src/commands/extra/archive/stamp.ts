const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2024-10-19 12:00" in UTC, the listing timestamp used by GNU tar and Ubuntu's unzip. */
export function isoMinute(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
