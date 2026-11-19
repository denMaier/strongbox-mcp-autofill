import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindFrame, isMenuFor, tokenLifetimeMs, Tokens, type Binding } from '../src/tokens.ts';

const binding: Binding = { tabId: 1, frameId: 3, documentId: 'doc', url: 'https://idmsa.apple.com/signin' };

// Predictable tokens: t1, t2, ...
function counter(): () => string {
  let next = 0;
  return () => `t${++next}`;
}

test('a token works once and returns its binding', () => {
  const tokens = new Tokens(counter());
  const token = tokens.issue(binding, 0);
  assert.deepEqual(tokens.use(token, 1), binding);
  assert.equal(tokens.use(token, 2), undefined);
});

test('tokens expire after two minutes', () => {
  const tokens = new Tokens(counter());
  const late = tokens.issue(binding, 0);
  assert.equal(tokens.use(late, tokenLifetimeMs), undefined);
  const early = tokens.issue(binding, 0);
  assert.deepEqual(tokens.use(early, tokenLifetimeMs - 1), binding);
});

test('unknown and malformed tokens fail', () => {
  const tokens = new Tokens(counter());
  tokens.issue(binding, 0);
  assert.equal(tokens.use('t2', 0), undefined);
  assert.equal(tokens.use(undefined, 0), undefined);
  assert.equal(tokens.use({ token: 't1' }, 0), undefined);
});

test('a new token for the same frame replaces the old one', () => {
  const tokens = new Tokens(counter());
  const old = tokens.issue(binding, 0);
  const other = tokens.issue({ ...binding, frameId: 0 }, 0);
  const now = tokens.issue({ ...binding, documentId: 'next' }, 0);
  assert.equal(tokens.use(old, 0), undefined);
  assert.equal(tokens.use(now, 0)?.documentId, 'next');
  assert.equal(tokens.use(other, 0)?.frameId, 0);
});

test('many tokens push out the oldest', () => {
  const tokens = new Tokens(counter());
  const first = tokens.issue({ ...binding, frameId: 0 }, 0);
  for (let frameId = 1; frameId < 100; frameId++) tokens.issue({ ...binding, frameId }, 0);
  assert.equal(tokens.use(first, 0), undefined);
  assert.equal(tokens.use('t100', 0)?.frameId, 99);
});

test('binds only the document that asked, with the URL the browser reports', () => {
  const frame = { documentId: 'doc', url: 'https://idmsa.apple.com/signin' };
  assert.deepEqual(bindFrame(1, 3, 'doc', frame), binding);
  assert.equal(bindFrame(1, 3, 'other', frame), undefined);
  assert.equal(bindFrame(1, 3, 'doc', { ...frame, url: 'about:blank' }), undefined);
  assert.equal(bindFrame(1, 3, 'doc', { documentId: 'doc' }), undefined);
  assert.equal(bindFrame(1, 3, 'doc', null), undefined);
});

test('the menu must be menu.html, in the same tab, in a frame of its own', () => {
  const url = 'chrome-extension://abcdef/menu.html#t1';
  assert.equal(isMenuFor(binding, 1, 7, url), true);
  assert.equal(isMenuFor(binding, 2, 7, url), false);
  assert.equal(isMenuFor(binding, 1, 3, url), false);
  assert.equal(isMenuFor(binding, 1, undefined, url), false);
  assert.equal(isMenuFor(binding, 1, 7, 'chrome-extension://abcdef/popup.html'), false);
  assert.equal(isMenuFor(binding, 1, 7, 'https://example.com/menu.html'), false);
  assert.equal(isMenuFor(binding, 1, 7, undefined), false);
});
