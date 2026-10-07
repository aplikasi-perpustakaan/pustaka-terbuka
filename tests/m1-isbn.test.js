import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIsbn,
  extractIsbns,
  isbn10to13,
  isbn13to10,
  validateIsbn10,
  validateIsbn13
} from '../tools/lib/isbn.js';

test('validateIsbn10', () => {
  assert.equal(validateIsbn10('0-201-63361-2'), true);
  assert.equal(validateIsbn10('080442957X'), true);
  assert.equal(validateIsbn10('0-201-63361-3'), false);
  assert.equal(validateIsbn10('invalid'), false);
});

test('validateIsbn13', () => {
  assert.equal(validateIsbn13('978-0-201-63361-0'), true);
  assert.equal(validateIsbn13('979-1-234-56789-6'), true);
  assert.equal(validateIsbn13('9780201633611'), false);
});

test('isbn10to13', () => {
  assert.equal(isbn10to13('0-201-63361-2'), '9780201633610');
  assert.equal(isbn10to13('080442957X'), '9780804429573');
});

test('isbn13to10', () => {
  assert.equal(isbn13to10('978-0-201-63361-0'), '0201633612');
  assert.equal(isbn13to10('978-0-804-42957-3'), '080442957X');
  assert.equal(isbn13to10('979-1-234-56789-6'), null);
});

test('normalizeIsbn handles valid ISBN-10', () => {
  const result = normalizeIsbn('0-201-63361-2 (pbk.)');
  assert.equal(result.valid, true);
  assert.equal(result.isbn10, '0201633612');
  assert.equal(result.isbn13, '9780201633610');
});

test('normalizeIsbn handles valid ISBN-13', () => {
  const result = normalizeIsbn('978-0-201-63361-0 (hardcover)');
  assert.equal(result.valid, true);
  assert.equal(result.isbn10, '0201633612');
  assert.equal(result.isbn13, '9780201633610');
});

test('normalizeIsbn handles valid 979 ISBN-13', () => {
  const result = normalizeIsbn('979-1-234-56789-6 (v. 1)');
  assert.equal(result.valid, true);
  assert.equal(result.isbn10, null);
  assert.equal(result.isbn13, '9791234567896');
});

test('normalizeIsbn rejects invalid', () => {
  const result = normalizeIsbn('invalid');
  assert.equal(result.valid, false);
});

test('extractIsbns extracts valid ISBNs from record and skips $z', () => {
  const record = {
    dataFields: [
      {
        tag: '020',
        subfields: [
          { code: 'a', value: '0-201-63361-2 (pbk.)' },
          { code: 'z', value: '0201633613 (cancelled)' }
        ]
      },
      {
        tag: '020',
        subfields: [
          { code: 'a', value: '9780804429573' }
        ]
      }
    ]
  };
  
  const isbns = extractIsbns(record);
  assert.equal(isbns.length, 2);
  assert.equal(isbns[0].isbn10, '0201633612');
  assert.equal(isbns[1].isbn13, '9780804429573');
});
