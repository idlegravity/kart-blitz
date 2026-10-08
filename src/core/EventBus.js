/**
 * Tiny synchronous pub/sub bus shared by every system.
 * Handlers that throw are caught and logged so one broken listener never kills the frame.
 * OWNER: orchestrator. Do not modify.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(name, fn) {
    let set = this._handlers.get(name);
    if (!set) this._handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(name, fn) {
    this._handlers.get(name)?.delete(fn);
  }

  emit(name, payload = {}) {
    const set = this._handlers.get(name);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler for "${name}" threw:`, err);
      }
    }
  }
}

/** The single shared bus instance (also available as game.events). */
export const events = new EventBus();
