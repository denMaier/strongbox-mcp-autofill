// One native-messaging port to the bridge, for one user action. It closes on
// close(), when the bridge goes away, on a reply outside the protocol, or after
// two minutes.

import { FillError, isBridgeError, type ErrorKind } from './protocol.ts';

export const lifetimeMs = 2 * 60 * 1000;

// The parts of chrome.runtime.Port that are used, so tests can pass a fake.
export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
}

type Reply = Record<string, unknown>;

interface Pending {
  resolve(reply: Reply): void;
  reject(error: FillError): void;
}

export class Bridge {
  #port: PortLike;
  #onClose: (kind: ErrorKind | undefined) => void;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;
  #timer: ReturnType<typeof setTimeout>;

  // disconnectKind is called inside onDisconnect, where chrome.runtime.lastError
  // says why the port closed.
  constructor(port: PortLike, disconnectKind: () => ErrorKind, onClose: (kind: ErrorKind | undefined) => void) {
    this.#port = port;
    this.#onClose = onClose;
    this.#timer = setTimeout(() => this.close('timeout'), lifetimeMs);
    port.onMessage.addListener(message => this.#receive(message));
    port.onDisconnect.addListener(() => this.close(disconnectKind()));
  }

  get closed(): boolean {
    return this.#closed;
  }

  request(message: { op: string } & Reply): Promise<Reply> {
    if (this.#closed) return Promise.reject(new FillError('bridge_failed'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#port.postMessage({ ...message, id });
      } catch {
        this.close('bridge_failed');
      }
    });
  }

  // Without a kind this is a normal end; pending requests still fail.
  close(kind?: ErrorKind): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    try {
      this.#port.disconnect();
    } catch {
      // Already disconnected.
    }
    for (const pending of this.#pending.values()) pending.reject(new FillError(kind ?? 'failed'));
    this.#pending.clear();
    this.#onClose(kind);
  }

  #receive(message: unknown): void {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return this.close('bridge_failed');
    const reply = message as Reply;
    const pending = typeof reply.id === 'number' ? this.#pending.get(reply.id) : undefined;
    if (!pending) return this.close('bridge_failed');
    this.#pending.delete(reply.id as number);
    if (reply.error === undefined) pending.resolve(reply);
    else pending.reject(new FillError(isBridgeError(reply.error) ? reply.error : 'bridge_failed'));
  }
}
