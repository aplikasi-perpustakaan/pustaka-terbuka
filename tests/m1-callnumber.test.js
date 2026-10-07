import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallNumber, parseDDC, parseLCC, compareCallNumbers, getTopLevelClass } from '../tools/lib/callnumber.js';

test('DDC Parsing', async (t) => {
  await t.test('005.133 ABC', () => {
    const res = parseDDC('005.133 ABC');
    assert.equal(res.scheme, 'DDC');
    assert.equal(res.classNumber, '005.133');
    assert.equal(res.itemNumber, 'ABC');
    assert.equal(res.sortKey, '005.1330000000 ABC');
    assert.deepEqual(res.searchTokens, ['005.133', '005', 'ABC']);
  });

  await t.test('813.54 UPD', () => {
    const res = parseDDC('813.54 UPD');
    assert.equal(res.sortKey, '813.5400000000 UPD');
  });

  await t.test('FIC ABU', () => {
    const res = parseDDC('FIC ABU');
    assert.equal(res.scheme, 'DDC');
    assert.equal(res.prefix, 'FIC');
    assert.equal(res.sortKey, 'ZZZ FIC ABU');
  });

  await t.test('[B] 921 NEL', () => {
    const res = parseDDC('[B] 921 NEL');
    assert.equal(res.classNumber, '921');
    assert.equal(res.prefix, '[B]');
    assert.equal(res.itemNumber, 'NEL');
  });
});

test('LCC Parsing', async (t) => {
  await t.test('QA76.73.V27 A12 2019', () => {
    const res = parseLCC('QA76.73.V27 A12 2019');
    assert.equal(res.scheme, 'LCC');
    assert.equal(res.classLetters, 'QA');
    assert.equal(res.classNumber, 76.73);
    assert.equal(res.date, '2019');
    assert.deepEqual(res.cutters, ['.V27', ' A12']); // Depending on extraction
    // Ensure search tokens have all elements
    ['QA76.73', 'QA76', 'QA', 'V27', 'A12', '2019'].forEach(token => {
      assert.ok(res.searchTokens.includes(token), `Missing token ${token}`);
    });
  });

  await t.test('PR6045.A97 Z46 1999', () => {
    const res = parseLCC('PR6045.A97 Z46 1999');
    assert.equal(res.classLetters, 'PR');
    assert.equal(res.classNumber, 6045);
    assert.equal(res.date, '1999');
    assert.equal(res.sortKey.substring(0, 15), 'PR  06045.00000');
  });

  await t.test('Z699.35.M28', () => {
    const res = parseLCC('Z699.35.M28');
    assert.equal(res.classLetters, 'Z');
    assert.equal(res.classNumber, 699.35);
  });
});

test('Other / Invalid parsing', async (t) => {
  const cases = ['', null, 'Random text 123', 'A B C'];
  for (const c of cases) {
    const res = parseCallNumber(c, 'LCC');
    assert.equal(res.scheme, 'other');
    assert.equal(res.parsed, false);
    assert.equal(res.sortKey, String(c || '').toLowerCase());
  }
});

test('Sort order tests', async (t) => {
  const lccList = ['Z699.35.M28', 'QA76.73.V27', 'PR6045.A97 Z46 1999'].map(c => parseLCC(c));
  lccList.sort(compareCallNumbers);
  assert.equal(lccList[0].classLetters, 'PR');
  assert.equal(lccList[1].classLetters, 'QA');
  assert.equal(lccList[2].classLetters, 'Z');

  const ddcList = ['813.54 UPD', '005.133 ABC', 'FIC ABU', '100.00 A'].map(c => parseDDC(c));
  ddcList.sort(compareCallNumbers);
  assert.equal(ddcList[0].classNumber, '005.133');
  assert.equal(ddcList[1].classNumber, '100.00');
  assert.equal(ddcList[2].classNumber, '813.54');
  assert.equal(ddcList[3].prefix, 'FIC');
});

test('Top-level class extraction', async (t) => {
  assert.equal(getTopLevelClass(parseDDC('005.133 ABC')), '000 Computer science, information & general works');
  assert.equal(getTopLevelClass(parseDDC('813.54 UPD')), '800 Literature');
  assert.equal(getTopLevelClass(parseLCC('QA76.73')), 'Q Science');
  assert.equal(getTopLevelClass(parseLCC('PR6045')), 'P Language and Literature');
});
