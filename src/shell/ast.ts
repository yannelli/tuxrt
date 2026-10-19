export type RedirOp = '>' | '>>' | '>|' | '<' | '<<' | '<<-' | '<<<' | '>&' | '<&' | '&>' | '&>>' | '<>';

export interface Heredoc {
  body: string;
  expand: boolean;
}

export interface Redir {
  fd: number | null;
  op: RedirOp;
  target: string;
  heredoc?: Heredoc;
}

export type Node =
  | { type: 'seq'; items: Node[] }
  | { type: 'bg'; body: Node }
  | { type: 'and' | 'or'; left: Node; right: Node }
  | { type: 'not'; body: Node }
  | { type: 'pipe'; cmds: Node[] }
  | { type: 'cmd'; assigns: string[]; words: string[]; redirs: Redir[]; noAlias?: string[] }
  | { type: 'subshell' | 'group'; body: Node }
  | { type: 'redirect'; body: Node; redirs: Redir[] }
  | { type: 'if'; branches: { cond: Node; body: Node }[]; otherwise: Node | null }
  | { type: 'for'; name: string; items: string[] | null; body: Node }
  | { type: 'while'; cond: Node; body: Node; until: boolean }
  | { type: 'case'; word: string; arms: { patterns: string[]; body: Node }[] }
  | { type: 'func'; name: string; body: Node }
  | { type: 'cond'; words: CondWord[] };

/** A word inside [[ ... ]]; `op` marks unquoted operators like && || ( ) ! < >. */
export interface CondWord {
  raw: string;
  op: boolean;
}

export class IncompleteInput extends Error {}

export class ShellSyntaxError extends Error {}

/** Short human-readable rendering of a node, for `jobs` and `ps`. */
export function describe(node: Node): string {
  switch (node.type) {
    case 'cmd': return [...node.assigns, ...node.words].join(' ');
    case 'pipe': return node.cmds.map(describe).join(' | ');
    case 'and': return `${describe(node.left)} && ${describe(node.right)}`;
    case 'or': return `${describe(node.left)} || ${describe(node.right)}`;
    case 'seq': return node.items.map(describe).join('; ');
    case 'redirect': return describe(node.body);
    case 'subshell': return `( ${describe(node.body)} )`;
    case 'group': return `{ ${describe(node.body)}; }`;
    default: return node.type;
  }
}
