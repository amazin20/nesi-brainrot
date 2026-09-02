import test from 'node:test';
import assert from 'node:assert/strict';
import { courseProgress, formatTime, isNewRecord } from '../src/game/rules.js';

test('course progress is clamped', () => {
  assert.equal(courseProgress(50), 0);
  assert.equal(courseProgress(-178), 1);
  assert.ok(courseProgress(-80) > 0.4 && courseProgress(-80) < 0.6);
});

test('timer uses mm:ss.mmm', () => {
  assert.equal(formatTime(0), '00:00.000');
  assert.equal(formatTime(65432), '01:05.432');
});

test('record comparison handles an empty previous result', () => {
  assert.equal(isNewRecord(50000, Number.NaN), true);
  assert.equal(isNewRecord(50000, 45000), false);
  assert.equal(isNewRecord(42000, 45000), true);
});
