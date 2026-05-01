type Listener = (...args: never[]) => void;

export class SimpleEventEmitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(eventName: string, listener: Listener): this {
    let eventListeners = this.listeners.get(eventName);

    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(eventName, eventListeners);
    }

    eventListeners.add(listener);
    return this;
  }

  off(eventName: string, listener: Listener): this {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  }

  emit(eventName: string, ...args: unknown[]): boolean {
    const eventListeners = this.listeners.get(eventName);

    if (!eventListeners || eventListeners.size === 0) {
      return false;
    }

    for (const listener of eventListeners) {
      (listener as (...listenerArgs: unknown[]) => void)(...args);
    }

    return true;
  }

  listenerCount(eventName: string): number {
    return this.listeners.get(eventName)?.size ?? 0;
  }
}
