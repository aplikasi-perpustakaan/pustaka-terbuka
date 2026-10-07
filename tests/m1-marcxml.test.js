import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parse,
  serialize,
  contentHash,
  getControlField,
  setControlField,
  getDataFields,
  addDataField,
  removeDataFields,
  getSubfield,
  getSubfields,
  cloneRecord
} from '../tools/lib/marcxml.js';

const xmlSingle = `<?xml version="1.0" encoding="UTF-8"?>
<marc:record xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:leader>00000nam a2200000 a 4500</marc:leader>
  <marc:controlfield tag="001">12345</marc:controlfield>
  <marc:datafield tag="245" ind1="1" ind2="0">
    <marc:subfield code="a">Title :</marc:subfield>
    <marc:subfield code="b">subtitle /</marc:subfield>
  </marc:datafield>
</marc:record>`;

const xmlCollection = `<?xml version="1.0" encoding="UTF-8"?>
<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:record>
    <marc:leader>00000nam a2200000 a 4500</marc:leader>
    <marc:controlfield tag="001">1</marc:controlfield>
    <marc:datafield tag="245" ind1="1" ind2="0">
      <marc:subfield code="a">Sejarah Melayu</marc:subfield>
    </marc:datafield>
  </marc:record>
  <marc:record>
    <marc:leader>00000nam a2200000 a 4500</marc:leader>
    <marc:controlfield tag="001">2</marc:controlfield>
    <marc:datafield tag="245" ind1="1" ind2="0">
      <marc:subfield code="a">中国历史</marc:subfield>
    </marc:datafield>
  </marc:record>
</marc:collection>`;

test('parse single record', () => {
  const records = parse(xmlSingle);
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.leader, '00000nam a2200000 a 4500');
  assert.equal(getControlField(rec, '001'), '12345');
  const titleField = getDataFields(rec, '245')[0];
  assert.equal(getSubfield(titleField, 'a'), 'Title :');
});

test('parse collection', () => {
  const records = parse(xmlCollection);
  assert.equal(records.length, 2);
  assert.equal(getControlField(records[0], '001'), '1');
  assert.equal(getSubfield(getDataFields(records[0], '245')[0], 'a'), 'Sejarah Melayu');
  assert.equal(getSubfield(getDataFields(records[1], '245')[0], 'a'), '中国历史');
});

test('round-trip stability', () => {
  const records = parse(xmlCollection);
  const serialized = serialize(records);
  const reParsed = parse(serialized);
  
  assert.deepEqual(reParsed, records);
});

test('unicode round-trip', () => {
  const rec = {
    leader: '00000nam a2200000 a 4500',
    controlFields: [{ tag: '001', value: '1' }],
    dataFields: [
      {
        tag: '245', ind1: '0', ind2: '0',
        subfields: [
          { code: 'a', value: 'தமிழ் இலக்கியம்' },
          { code: 'b', value: 'كتاب ملايو' }
        ]
      }
    ]
  };
  
  const serialized = serialize(rec);
  const parsed = parse(serialized);
  assert.equal(getSubfield(parsed[0].dataFields[0], 'a'), 'தமிழ் இலக்கியம்');
  assert.equal(getSubfield(parsed[0].dataFields[0], 'b'), 'كتاب ملايو');
});

test('helper functions', () => {
  const rec = { leader: '', controlFields: [], dataFields: [] };
  setControlField(rec, '001', 'abc');
  assert.equal(getControlField(rec, '001'), 'abc');
  setControlField(rec, '001', 'def'); // update
  assert.equal(getControlField(rec, '001'), 'def');
  
  addDataField(rec, { tag: '650', ind1: ' ', ind2: ' ', subfields: [{code: 'a', value: 'Test'}]});
  addDataField(rec, { tag: '650', ind1: ' ', ind2: ' ', subfields: [{code: 'a', value: 'Test 2'}, {code: 'a', value: 'Test 3'}]});
  
  const fields = getDataFields(rec, '650');
  assert.equal(fields.length, 2);
  assert.deepEqual(getSubfields(fields[1], 'a'), ['Test 2', 'Test 3']);
  
  removeDataFields(rec, '650');
  assert.equal(getDataFields(rec, '650').length, 0);
  
  const cloned = cloneRecord(rec);
  assert.deepEqual(cloned, rec);
  assert.notEqual(cloned, rec);
});

test('content hash stability', () => {
  const rec = { leader: 'test', controlFields: [{tag: '001', value: '1'}], dataFields: [] };
  const h1 = contentHash(rec);
  const h2 = contentHash(rec);
  assert.equal(h1, h2);
  
  const rec2 = cloneRecord(rec);
  rec2.controlFields[0].value = '2';
  const h3 = contentHash(rec2);
  assert.notEqual(h1, h3);
});

test('handles non-namespaced input', () => {
  const xml = '<record><leader>test</leader><controlfield tag="001">1</controlfield></record>';
  const records = parse(xml);
  assert.equal(records.length, 1);
  assert.equal(records[0].leader, 'test');
  assert.equal(getControlField(records[0], '001'), '1');
});
