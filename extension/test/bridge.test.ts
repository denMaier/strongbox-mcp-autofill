import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bridge, type PortLike } from '../src/bridge.ts';
import { FillError, type ErrorKind } from '../src/protocol.ts';

class FakePort implements PortLike {
  sent: Record<string, unknown>[] = [];
  disconnected = false;
  #onMessage: ((message: unknown) => void)[] = [];
  #onDisconnect: (() => void)[] = [];
  onMessage = { addListener: (callback: (message: unknown) => void) => void this.#onMessage.push(callback) };
  onDisconnect = { addListener: (callback: () => void) => void this.#onDisconnect.push(callback) };

  postMessage(message: unknown): void {
    if (this.disconnected) throw new Error('disconnected');
    this.sent.push(message as Record<string, unknown>);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  reply(message: unknown): void {
    for (const callback of this.#onMessage) callback(message);
  }

  drop(): void {
    for (const callback of this.#onDisconnect) callback();
  }
}

function setup(dropKind: ErrorKind = 'bridge_failed') {
  const port = new FakePort();
  const closes: (ErrorKind | undefined)[] = [];
  const bridge = new Bridge(port, () => dropKind, kind => closes.push(kind));
  return { port, bridge, closes };
}

const kind = (expected: ErrorKind) => (error: unknown) => error instanceof FillError && error.kind === expected;

test('matches replies to requests by id', async () => {
  const { port, bridge } = setup();
  const first = bridge.request({ op: 'status' });
  const second = bridge.request({ op: 'search', url: 'https://example.com/' });
  assert.deepEqual(port.sent, [
    { op: 'status', id: 1 },
    { op: 'search', url: 'https://example.com/', id: 2 },
  ]);
  port.reply({ id: 2, matches: [] });
  port.reply({ id: 1, databases: [] });
  assert.deepEqual(await first, { id: 1, databases: [] });
  assert.deepEqual(await second, { id: 2, matches: [] });
  bridge.close();
});

test('passes bridge error kinds on', async () => {
  const { port, bridge } = setup();
  const pending = bridge.request({ op: 'status' });
  port.reply({ id: 1, error: 'not_paired' });
  await assert.rejects(pending, kind('not_paired'));
  bridge.close();
});

test('an unknown error kind or an unexpected id closes the bridge', async () => {
  let { port, bridge, closes } = setup();
  let pending = bridge.request({ op: 'status' });
  port.reply({ id: 1, error: 'Strongbox says something' });
  await assert.rejects(pending, kind('bridge_failed'));
  bridge.close();

  ({ port, bridge, closes } = setup());
  pending = bridge.request({ op: 'status' });
  port.reply({ id: 9, databases: [] });
  await assert.rejects(pending, kind('bridge_failed'));
  assert.equal(port.disconnected, true);
  assert.deepEqual(closes, ['bridge_failed']);
});

test('a dropped port fails pending requests with the disconnect kind', async () => {
  const { port, bridge, closes } = setup('no_bridge');
  const pending = bridge.request({ op: 'status' });
  port.drop();
  await assert.rejects(pending, kind('no_bridge'));
  assert.deepEqual(closes, ['no_bridge']);
  assert.equal(bridge.closed, true);
  await assert.rejects(bridge.request({ op: 'status' }), kind('bridge_failed'));
});

test('close is final and reported once', () => {
  const { port, bridge, closes } = setup();
  bridge.close();
  bridge.close('timeout');
  assert.equal(port.disconnected, true);
  assert.deepEqual(closes, [undefined]);
});
