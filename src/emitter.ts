type Listener = (...args: any[]) => void;

export class SimpleEventEmitter<EventMap extends { [Key in keyof EventMap]: unknown[] } = Record<string, unknown[]>> {
  private readonly listeners = new Map<string, Set<Listener>>();

  on<EventName extends keyof EventMap & string>(
    eventName: EventName,
    listener: (...args: EventMap[EventName]) => void,
  ): this;
  on(eventName: string, listener: Listener): this;
  on(eventName: string, listener: Listener): this {
    let eventListeners = this.listeners.get(eventName);

    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(eventName, eventListeners);
    }

    eventListeners.add(listener);
    return this;
  }

  off<EventName extends keyof EventMap & string>(
    eventName: EventName,
    listener: (...args: EventMap[EventName]) => void,
  ): this;
  off(eventName: string, listener: Listener): this;
  off(eventName: string, listener: Listener): this {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  }

  emit<EventName extends keyof EventMap & string>(eventName: EventName, ...args: EventMap[EventName]): boolean;
  emit(eventName: string, ...args: unknown[]): boolean;
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
