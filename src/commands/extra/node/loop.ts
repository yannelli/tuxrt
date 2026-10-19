type Kind = 'timeout' | 'interval' | 'immediate';

/** Node's Timeout object: ref/unref/refresh, and coerces to its numeric id. */
export class Timer {
  readonly id: number;
  readonly kind: Kind;
  host: ReturnType<typeof setTimeout> | ReturnType<typeof setImmediate> | null = null;
  private readonly loop: EventLoop;
  private refd = true;

  constructor(loop: EventLoop, id: number, kind: Kind) {
    this.loop = loop;
    this.id = id;
    this.kind = kind;
  }

  ref(): this {
    this.refd = true;
    if (this.host) this.loop.ref(this);
    return this;
  }

  unref(): this {
    this.refd = false;
    this.loop.unref(this);
    return this;
  }

  hasRef(): boolean {
    return this.refd;
  }

  refresh(): this {
    if (this.host && this.kind !== 'immediate') (this.host as ReturnType<typeof setTimeout>).refresh();
    return this;
  }

  close(): this {
    this.loop.clear(this);
    return this;
  }

  [Symbol.toPrimitive](): number {
    return this.id;
  }
}

/** Liveness for one sandbox run: timers, fetches, children and stdin reads hold refs until done. */
export class EventLoop {
  stopped = false;
  private readonly refs = new Set<object>();
  private readonly timers = new Map<number, Timer>();
  private readonly onError: (e: unknown) => void;
  private wake: (() => void) | null = null;
  private nextId = 1;

  constructor(onError: (e: unknown) => void) {
    this.onError = onError;
  }

  ref(handle: object): void {
    if (!this.stopped) this.refs.add(handle);
  }

  unref(handle: object): void {
    if (this.refs.delete(handle)) this.notify();
  }

  /** Calls sandbox code from a host callback; exceptions become uncaught errors. */
  invoke(fn: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]): void {
    if (this.stopped) return;
    try {
      fn.apply(thisArg, args);
    } catch (e) {
      this.onError(e);
    }
  }

  /** Keeps the loop alive until `p` settles, re-wrapping it in the sandbox's Promise. */
  track<T>(p: Promise<T>, P: PromiseConstructor): Promise<T> {
    const handle = {};
    this.ref(handle);
    return new P<T>((resolve, reject) => {
      p.then(
        (v) => {
          this.unref(handle);
          if (!this.stopped) resolve(v);
        },
        (e) => {
          this.unref(handle);
          if (!this.stopped) reject(e);
        },
      );
    });
  }

  schedule(kind: Kind, fn: unknown, ms: unknown, args: unknown[]): Timer {
    if (typeof fn !== 'function') {
      throw Object.assign(new TypeError(`The "callback" argument must be of type function. Received ${typeof fn}`), {
        code: 'ERR_INVALID_ARG_TYPE',
      });
    }
    const timer = new Timer(this, this.nextId++, kind);
    const fire = () => {
      if (kind !== 'interval') this.clear(timer);
      this.invoke(fn as (...a: unknown[]) => unknown, timer, args);
    };
    const delay = Number(ms) || 0;
    timer.host = kind === 'immediate' ? setImmediate(fire) : kind === 'interval' ? setInterval(fire, delay) : setTimeout(fire, delay);
    this.timers.set(timer.id, timer);
    this.ref(timer);
    return timer;
  }

  clear(t: unknown): void {
    const timer = t instanceof Timer ? t : this.timers.get(Number(t));
    if (!timer?.host) return;
    if (timer.kind === 'immediate') clearImmediate(timer.host as ReturnType<typeof setImmediate>);
    else clearTimeout(timer.host as ReturnType<typeof setTimeout>);
    timer.host = null;
    this.timers.delete(timer.id);
    this.unref(timer);
  }

  /** Resolves when nothing keeps the loop alive (or it was stopped). */
  async run(): Promise<void> {
    while (!this.stopped) {
      // Two macrotask turns let microtasks and nextTick-driven stream work register new handles.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      if (this.stopped || this.refs.size === 0) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of [...this.timers.values()]) this.clear(timer);
    this.refs.clear();
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}
