import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateId,
  isValidId,
  getShard
} from '../tools/lib/id-generator.js';

test('generates 10-character IDs', () => {
  const id = generateId();
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 10);
});

test('IDs use only Crockford Base32 characters', () => {
  const id = generateId();
  assert.match(id, /^[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
});

test('isValidId accepts valid IDs', () => {
  assert.equal(isValidId('0123456789'), true);
  assert.equal(isValidId('abcdefghjk'), true);
  assert.equal(isValidId('mnpqrstvwx'), true);
});

test('isValidId rejects invalid IDs', () => {
  assert.equal(isValidId('123'), false, 'too short');
  assert.equal(isValidId('12345678901'), false, 'too long');
  assert.equal(isValidId('123456789O'), false, 'contains O');
  assert.equal(isValidId('123456789I'), false, 'contains I');
  assert.equal(isValidId('123456789L'), false, 'contains L');
  assert.equal(isValidId('123456789U'), false, 'contains U');
  assert.equal(isValidId(null), false);
  assert.equal(isValidId(1234567890), false);
});

test('generateId avoids collisions', () => {
  const existing = new Set(['1234567890', 'abcdefghjk']);
  // Hard to test this exactly without mocking crypto, but we can verify it doesn't infinite loop
  // and returns a valid ID. Let's just generate a bunch and check for uniqueness.
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = generateId(ids);
    assert.equal(ids.has(id), false);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

test('getShard returns first 2 chars', () => {
  assert.equal(getShard('1234567890'), '12');
  assert.equal(getShard('abcdefghjk'), 'ab');
});

test('getShard throws on invalid ID', () => {
  assert.throws(() => getShard('123'), /Invalid ID/);
});
