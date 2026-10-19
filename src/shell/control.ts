export class BreakSignal {
  levels: number;
  constructor(levels: number) {
    this.levels = levels;
  }
}

export class ContinueSignal {
  levels: number;
  constructor(levels: number) {
    this.levels = levels;
  }
}

export class ReturnSignal {
  code: number;
  constructor(code: number) {
    this.code = code;
  }
}

export class ExitSignal {
  code: number;
  constructor(code: number) {
    this.code = code;
  }
}

/** Thrown when the foreground job receives SIGINT/SIGTERM/SIGKILL. */
export class Interrupt {
  code: number;
  constructor(code = 130) {
    this.code = code;
  }
}
