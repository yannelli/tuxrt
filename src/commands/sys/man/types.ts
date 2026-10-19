/** A paragraph ("\n" forces a line break), a [tag, text] tagged paragraph, or a preformatted block. */
export type Item = string | [string, string] | { code: string };

export interface Page {
  name: string;
  section: string;
  /** NAME line text after "name - ". */
  summary: string;
  /** Other names documented by this page (gunzip and zcat on gzip). */
  aliases?: string[];
  /** One entry per synopsis line; the first word renders bold, flags bold, other words underlined. */
  synopsis: string[];
  description: Item[];
  /** [tag, text]: flags in the tag render bold, metavariables underlined. */
  options?: [string, string][];
  /** Extra sections in display order, placed after OPTIONS, e.g. ['EXIT STATUS', [...]]. */
  sections?: [string, Item[]][];
  /** [command line, explanation]. */
  examples?: [string, string][];
  /** "name(section)" references. */
  seeAlso?: string[];
  /** Footer left and center: [source, date]; defaults to FOOTER. */
  footer?: [string, string];
  /** Header center; defaults by section ("User Commands" for 1). */
  manual?: string;
}

export const FOOTER: [string, string] = ['tuxrt 0.1.0', '2026-10'];

/** A bash builtin: one synopsis line, a whatis summary, and description text ("\n\n" separates paragraphs). */
export interface Builtin {
  synopsis: string;
  summary: string;
  text: string;
}

export const GNU_HELP: [string, string][] = [
  ['--help', 'print a short usage summary, then exit'],
  ['--version', 'print the program version, then exit'],
];
