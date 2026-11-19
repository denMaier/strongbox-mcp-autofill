import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FillError, parseDatabases, parseMatches, parseOk, parseValues } from '../src/protocol.ts';

const isBridgeFailed = (error: unknown) => error instanceof FillError && error.kind === 'bridge_failed';

const match = {
  database_id: 'd',
  database_name: 'Vault',
  credential_id: 'c',
  title: 'Example',
  username: 'me',
  available_fields: ['password', 'totp'],
};

test('parses databases', () => {
  assert.deepEqual(parseDatabases({ databases: [{ id: 'd', name: 'Vault', locked: true, extra: 1 }] }), [
    { id: 'd', name: 'Vault', locked: true },
  ]);
});

test('rejects malformed databases', () => {
  assert.throws(() => parseDatabases({}), isBridgeFailed);
  assert.throws(() => parseDatabases({ databases: [{ id: 'd', name: 'Vault', locked: 'no' }] }), isBridgeFailed);
});

test('parses matches and keeps only known keys', () => {
  assert.deepEqual(parseMatches({ matches: [{ ...match, notes: 'x' }] }), [match]);
});

test('rejects more than 20 matches or bad fields', () => {
  assert.throws(() => parseMatches({ matches: Array(21).fill(match) }), isBridgeFailed);
  assert.throws(() => parseMatches({ matches: [{ ...match, available_fields: [1] }] }), isBridgeFailed);
  assert.throws(() => parseMatches({ matches: [{ ...match, title: null }] }), isBridgeFailed);
});

test('accepts only ok: true', () => {
  parseOk({ ok: true });
  assert.throws(() => parseOk({ ok: 'yes' }), isBridgeFailed);
});

test('values must hold exactly the requested fields', () => {
  assert.deepEqual(parseValues({ values: { password: 'p' } }, ['password']), { password: 'p' });
  assert.throws(() => parseValues({ values: { password: 'p', notes: 'n' } }, ['password']), isBridgeFailed);
  assert.throws(() => parseValues({ values: { password: 'p' } }, ['password', 'totp']), isBridgeFailed);
  assert.throws(() => parseValues({ values: { password: 1 } }, ['password']), isBridgeFailed);
  assert.throws(() => parseValues({ values: [] }, ['password']), isBridgeFailed);
});
