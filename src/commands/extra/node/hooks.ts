/** A running sandbox that can claim host-level uncaught errors raised on its behalf. */
export interface ErrorOwner {
  owns(err: unknown, promise?: Promise<unknown>): boolean;
  uncaught(err: unknown, promise?: Promise<unknown>): void;
}

const active = new Set<ErrorOwner>();

function route(event: string, err: unknown, promise?: Promise<unknown>): void {
  const owner = [...active].find((o) => o.owns(err, promise)) ?? (active.size === 1 ? [...active][0] : undefined);
  if (owner) return owner.uncaught(err, promise);
  // Not ours: fall back to Node's default (print and exit) unless someone else listens.
  if (process.listenerCount(event) > 1) return;
  console.error(err);
  process.exit(1);
}

const onRejection = (reason: unknown, promise: Promise<unknown>) => route('unhandledRejection', reason, promise);
const onException = (err: unknown) => route('uncaughtException', err);

/** Sandbox callbacks run from host streams and promises; without this, their errors would kill tuxrt. */
export function attach(owner: ErrorOwner): void {
  if (!active.size) {
    process.on('unhandledRejection', onRejection);
    process.on('uncaughtException', onException);
  }
  active.add(owner);
}

export function detach(owner: ErrorOwner): void {
  active.delete(owner);
  if (!active.size) {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
  }
}
