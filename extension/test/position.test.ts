import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placePopin } from '../src/content/position.ts';

const viewport = { width: 1000, height: 800 };
const popin = { width: 320, height: 100 };
const field = (left: number, top: number, width = 200, height = 30) => ({ left, top, right: left + width, bottom: top + height });

test('goes under the field, aligned with its left edge', () => {
  assert.deepEqual(placePopin(field(100, 100), popin, viewport), { left: 100, top: 134, width: 320, visible: true });
});

test('goes above the field when there is more room there', () => {
  assert.equal(placePopin(field(100, 740), popin, viewport).top, 636);
  // Little room either way: below wins, unless above has more.
  assert.equal(placePopin(field(100, 40, 200, 700), popin, { width: 1000, height: 780 }).top, 744);
});

test('stays inside the viewport', () => {
  assert.equal(placePopin(field(900, 100), popin, viewport).left, 676);
  assert.equal(placePopin(field(-50, 100), popin, viewport).left, 4);
  assert.equal(placePopin(field(0, 300), popin, { width: 200, height: 800 }).width, 192);
  assert.equal(placePopin(field(-50, 30, 200, 30), { width: 320, height: 500 }, { width: 1000, height: 300 }).top, 64);
});

test('is hidden while the field is out of view', () => {
  assert.equal(placePopin(field(100, -40), popin, viewport).visible, false);
  assert.equal(placePopin(field(100, 800), popin, viewport).visible, false);
  assert.equal(placePopin(field(100, -20), popin, viewport).visible, true);
});
