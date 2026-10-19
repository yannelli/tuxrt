export const COWPATH = '/usr/share/cowsay/cows';

/** Cowfile bodies as rendered, with cowsay's $thoughts, $eyes and $tongue placeholders. */
const COWS: Record<string, string> = {
  bunny: String.raw`  $thoughts
   $thoughts   /|  |\
       | |  | |
       ( $eyes  )
        \ -- /
       /|    |\
      (_|____|_)
`,
  default: String.raw`        $thoughts   ^__^
         $thoughts  ($eyes)\_______
            (__)\       )\/\
             $tongue ||----w |
                ||     ||
`,
  moose: String.raw`  $thoughts
   $thoughts  _||_      _||_
    $thoughts  \  \____/  /
          \_($eyes)_/
           /    \________
          ( __ )          )~
           $tongue  ||------||
               ||      ||
`,
  small: String.raw`      $thoughts
       $thoughts  ^ ^
         ($eyes)____
          \/  __  )=
           $tongue||  ||
`,
  tux: String.raw`   $thoughts
    $thoughts
        _.-._
       / o o \
       |  v  |
      /| --- |\
     / |     | \
       |_____|
       /_/ \_\
`,
};

export const cowNames = (): string[] => Object.keys(COWS).sort();

/** Accepts "tux" or "tux.cow" like cowsay's COWPATH lookup, plus "cow" as an alias for the default. */
export function findCow(name: string): string | undefined {
  const base = name.replace(/\.cow$/, '');
  if (base === 'cow') return COWS.default;
  return Object.hasOwn(COWS, base) ? COWS[base] : undefined;
}

export interface Face {
  thoughts: string;
  eyes: string;
  tongue: string;
}

export function renderCow(cow: string, face: Face): string {
  return cow.replace(/\$(thoughts|eyes|tongue)/g, (_, key: keyof Face) => face[key]);
}
