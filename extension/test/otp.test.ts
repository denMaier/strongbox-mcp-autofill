import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeOtp, words } from '../src/content/otp.ts';

const field = (hints: Partial<{ type: string; autocomplete: string; name: string; id: string }>) =>
  looksLikeOtp({ type: 'text', autocomplete: '', name: '', id: '', ...hints });

test('splits names into words', () => {
  assert.deepEqual(words('twoFactorCode'), ['two', 'factor', 'code']);
  assert.deepEqual(words('OTPInput'), ['otp', 'input']);
  assert.deepEqual(words('one-time_code'), ['one', 'time', 'code']);
});

test('autocomplete one-time-code wins', () => {
  assert.equal(field({ autocomplete: 'one-time-code' }), true);
  assert.equal(field({ autocomplete: 'section-login one-time-code', name: 'zip' }), true);
});

test('name and id hints', () => {
  for (const name of ['otp', 'totp', 'otpCode', 'mfa_code', '2fa', 'verificationCode', 'code', 'otpinput', 'one-time-code']) {
    assert.equal(field({ name }), true);
  }
  assert.equal(field({ id: 'TOTP' }), true);
  assert.equal(field({ type: 'tel', name: 'otp' }), true);
  assert.equal(field({ type: 'number', name: 'code' }), true);
});

test('other codes and fields are not one-time codes', () => {
  for (const name of ['username', 'password', 'zip_code', 'postCode', 'postcode', 'promo-code', 'countryCode', 'card_code', 'decode', 'barcode']) {
    assert.equal(field({ name }), false);
  }
  assert.equal(field({ autocomplete: 'cc-csc', name: 'code' }), false);
  assert.equal(field({ type: 'email', name: 'otp' }), false);
  assert.equal(field({ type: 'hidden', name: 'otp' }), false);
  assert.equal(field({ type: 'checkbox', name: 'mfa' }), false);
});
