import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldsToReveal, isFromFrame, pageOrigin, parseReport, pickFrame, searchUrl, type Frame } from '../src/plan.ts';

const login = { hasLogin: true, hasPassword: true, hasOtp: false };
const none = { hasLogin: false, hasPassword: false, hasOtp: false };

test('only http and https pages have an origin', () => {
  assert.equal(pageOrigin('https://example.com:8443/a?b#c'), 'https://example.com:8443');
  assert.equal(pageOrigin('http://example.com/'), 'http://example.com');
  assert.equal(pageOrigin('chrome://settings'), undefined);
  assert.equal(pageOrigin('file:///etc/passwd'), undefined);
  assert.equal(pageOrigin('about:blank'), undefined);
  assert.equal(pageOrigin('not a url'), undefined);
  assert.equal(pageOrigin(undefined), undefined);
});

test('search URL drops query and fragment and stays short', () => {
  assert.equal(searchUrl('https://example.com/login?token=x#y'), 'https://example.com/login');
  assert.equal(searchUrl('https://example.com/' + 'a'.repeat(3000)), 'https://example.com/');
});

test('reports must be three booleans', () => {
  assert.deepEqual(parseReport({ ...login, extra: 1 }), login);
  assert.equal(parseReport({ hasLogin: true, hasPassword: 'yes', hasOtp: false }), undefined);
  assert.equal(parseReport(undefined), undefined);
});

test('a fill connection must come from the exact tab, frame and document', () => {
  const frame = { frameId: 3, documentId: 'doc' };
  const sender = { tab: { id: 1 }, frameId: 3, documentId: 'doc' };
  assert.equal(isFromFrame(1, frame, sender), true);
  assert.equal(isFromFrame(2, frame, sender), false);
  assert.equal(isFromFrame(1, frame, { ...sender, frameId: 4 }), false);
  assert.equal(isFromFrame(1, frame, { ...sender, documentId: 'next' }), false);
  assert.equal(isFromFrame(1, frame, { tab: { id: 1 }, frameId: 3 }), false);
  assert.equal(isFromFrame(1, { frameId: 3, documentId: undefined as unknown as string }, { tab: { id: 1 }, frameId: 3 }), false);
  assert.equal(isFromFrame(1, frame, undefined), false);
});

test('picks the top frame first', () => {
  const frames: Frame[] = [
    { frameId: 7, documentId: 'b', url: 'https://example.com/frame', report: login },
    { frameId: 0, documentId: 'a', url: 'https://example.com/', report: login },
  ];
  assert.equal(pickFrame(frames)?.documentId, 'a');
});

test('prefers an embedded sign-in frame with a password over a top frame without one', () => {
  const frames: Frame[] = [
    { frameId: 0, documentId: 'a', url: 'https://www.icloud.com/', report: { ...login, hasPassword: false } },
    { frameId: 3, documentId: 'b', url: 'https://idmsa.apple.com/signin', report: login },
  ];
  assert.equal(pickFrame(frames)?.documentId, 'b');
});

test('skips frames that are not http(s), without a report or without fields', () => {
  const frames: Frame[] = [
    { frameId: 0, documentId: 'a', url: 'https://example.com/', report: none },
    { frameId: 2, documentId: 'c', url: 'https://example.com/x' },
    { frameId: 3, documentId: 'd', url: 'about:blank', report: login },
  ];
  assert.equal(pickFrame(frames), undefined);
  frames.push({ frameId: 4, documentId: 'e', url: 'https://example.com/otp', report: { ...none, hasOtp: true } });
  assert.equal(pickFrame(frames)?.documentId, 'e');
});

test('reveals only what the frame and the entry both have', () => {
  assert.deepEqual(fieldsToReveal(login, ['password', 'totp', 'notes']), ['password']);
  assert.deepEqual(fieldsToReveal({ ...login, hasOtp: true }, ['password', 'totp']), ['password', 'totp']);
  assert.deepEqual(fieldsToReveal({ ...none, hasOtp: true }, ['password', 'totp']), ['totp']);
  assert.deepEqual(fieldsToReveal({ hasLogin: true, hasPassword: false, hasOtp: false }, ['password']), []);
  assert.deepEqual(fieldsToReveal(login, []), []);
});
