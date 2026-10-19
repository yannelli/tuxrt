type Listener = () => void;

/** The subset of DOM AbortSignal the shell uses, implemented here because JavaScriptCore and Hermes lack it. */
export class AbortSignal {
  aborted = false;
  reason: unknown = undefined;
  private listeners = new Set<Listener>();

  addEventListener(_type: 'abort', fn: Listener, _opts?: { once?: boolean }): void {
    if (!this.aborted) this.listeners.add(fn);
  }

  removeEventListener(_type: 'abort', fn: Listener): void {
    this.listeners.delete(fn);
  }

  /** @internal Called by the owning controller. */
  fire(reason: unknown): void {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason;
    const fns = [...this.listeners];
    this.listeners.clear();
    for (const fn of fns) fn();
  }

  static any(signals: AbortSignal[]): AbortSignal {
    const c = new AbortController();
    for (const s of signals) {
      if (s.aborted) return c.abort(s.reason), c.signal;
      s.addEventListener('abort', () => c.abort(s.reason));
    }
    return c.signal;
  }
}

export class AbortController {
  readonly signal = new AbortSignal();

  abort(reason: unknown = new Error('aborted')): void {
    this.signal.fire(reason);
  }
}
