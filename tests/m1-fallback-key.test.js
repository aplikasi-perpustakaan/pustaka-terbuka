import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  generateFallbackKey, 
  stripArticles, 
  normalizeWhitespace, 
  stripMarcPunctuation,
  normalizeTitle,
  normalizeAuthor,
  normalizePublisher,
  extractYear
} from '../tools/lib/fallback-key.js';

test('Normalization utilities', async (t) => {
  await t.test('stripArticles', () => {
    assert.equal(stripArticles('the cat in the hat'), 'cat in the hat');
    assert.equal(stripArticles('sang kancil'), 'kancil');
    assert.equal(stripArticles('a book'), 'book');
    assert.equal(stripArticles('an apple'), 'apple');
    assert.equal(stripArticles('si tanggang'), 'tanggang');
    assert.equal(stripArticles('para pelajar'), 'pelajar');
    assert.equal(stripArticles('there is a cat'), 'there is a cat');
  });

  await t.test('normalizeWhitespace & NFC', () => {
    const eAcuteDecomposed = 'e\u0301';
    const eAcuteComposed = '\u00e9';
    assert.equal(normalizeWhitespace(`A  B\tC\n ${eAcuteDecomposed}`), `a b c ${eAcuteComposed}`);
  });

  await t.test('stripMarcPunctuation', () => {
    assert.equal(stripMarcPunctuation('Dr. Seuss.'), 'Dr. Seuss');
    assert.equal(stripMarcPunctuation('A title / '), 'A title');
    assert.equal(stripMarcPunctuation('Kuala Lumpur :'), 'Kuala Lumpur');
    assert.equal(stripMarcPunctuation('Something ;'), 'Something');
    assert.equal(stripMarcPunctuation('abc ='), 'abc');
  });
});

test('Fallback Key Generation', async (t) => {
  const getRecord = (titleA, author, pub, year) => ({
    fields: [
      { '245': { subfields: [{ 'a': titleA }] } },
      author ? { '100': { subfields: [{ 'a': author }] } } : null,
      pub ? { '260': { subfields: [{ 'b': pub }] } } : null,
      year ? { '008': `0123456${year}abcde` } : null
    ].filter(Boolean)
  });

  await t.test('Normal record produces key', () => {
    const r = getRecord('The Cat in the Hat /', 'Dr. Seuss.', 'Random House,', '1957');
    const key = generateFallbackKey(r);
    assert.equal(key, 'cat in the hat|dr. seuss|random house|1957');
  });

  await t.test('Missing author still produces key', () => {
    const r = getRecord('A book', null, 'Pub', '2020');
    const key = generateFallbackKey(r);
    assert.equal(key, 'book||pub|2020');
  });

  await t.test('Missing title returns null', () => {
    const r = { fields: [{ '100': { subfields: [{ 'a': 'Author' }] } }] };
    assert.equal(generateFallbackKey(r), null);
  });
  
  await t.test('Different year produces different key', () => {
    const r1 = getRecord('Title', 'Author', 'Pub', '2020');
    const r2 = getRecord('Title', 'Author', 'Pub', '2021');
    assert.notEqual(generateFallbackKey(r1), generateFallbackKey(r2));
  });

  await t.test('Extracts year from 260c if 008 is invalid', () => {
    const r = {
      fields: [
        { '245': { subfields: [{ 'a': 'Title' }] } },
        { '008': `0123456||||abcde` },
        { '260': { subfields: [{ 'c': 'c1999.' }] } }
      ]
    };
    assert.equal(generateFallbackKey(r), 'title|||1999');
  });
  
  await t.test('Extracts publisher from 264 ind2=1', () => {
    const r = {
      fields: [
        { '245': { subfields: [{ 'a': 'Title' }] } },
        { '264': { ind2: '1', subfields: [{ 'b': 'O\'Reilly,' }] } }
      ]
    };
    assert.equal(generateFallbackKey(r), 'title||o\'reilly|');
  });
});
