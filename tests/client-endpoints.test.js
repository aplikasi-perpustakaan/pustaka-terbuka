import fs from 'fs';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert';
import { buildSite, enrichWithAttribution } from '../tools/lib/build.js';

const TEST_DIR = path.join(process.cwd(), 'tests', 'client-tmp');
const DATA_DIR = path.join(TEST_DIR, 'data');
const DIST_DIR = path.join(TEST_DIR, 'dist');
const DUMPS_DIR = path.join(TEST_DIR, 'dumps');

function setupTest() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(DATA_DIR, 'bib', '07'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'holdings'), { recursive: true });

  fs.writeFileSync(path.join(DATA_DIR, 'orgs.json'), JSON.stringify({
    "PNM": { name: "Perpustakaan Negara Malaysia", opac_url: "https://opac.pnm.gov.my/" }
  }));
  fs.writeFileSync(path.join(DATA_DIR, 'aliases.jsonl'), '');

  // Rich MARC record with PNM control numbers, ISBN, and ISSN
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">
  <marc:record>
    <marc:leader>00000nam a2200000Ia 4500</marc:leader>
    <marc:controlfield tag="001">vtls000898574</marc:controlfield>
    <marc:datafield tag="035" ind1=" " ind2=" ">
      <marc:subfield code="a">(PNM)vtls000898574</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="020" ind1=" " ind2=" ">
      <marc:subfield code="a">978-983-01-2345-6 (pbk.)</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="022" ind1=" " ind2=" ">
      <marc:subfield code="a">0128-1232</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="040" ind1=" " ind2=" ">
      <marc:subfield code="a">MY-KLP</marc:subfield>
      <marc:subfield code="c">MY-KLP</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="082" ind1="0" ind2="4">
      <marc:subfield code="a">510</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="100" ind1="1" ind2=" ">
      <marc:subfield code="a">Ahmad bin Abdullah</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="245" ind1="1" ind2="0">
      <marc:subfield code="a">Matematik Tingkatan 1 /</marc:subfield>
      <marc:subfield code="c">Ahmad bin Abdullah.</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="264" ind1=" " ind2="1">
      <marc:subfield code="b">Dewan Bahasa dan Pustaka</marc:subfield>
      <marc:subfield code="c">2024</marc:subfield>
    </marc:datafield>
    <marc:datafield tag="852" ind1=" " ind2=" ">
      <marc:subfield code="h">510 AHM</marc:subfield>
      <marc:subfield code="b">PERPUSTAKAAN NEGARA MALAYSIA</marc:subfield>
    </marc:datafield>
  </marc:record>
</marc:collection>`;

  fs.writeFileSync(path.join(DATA_DIR, 'bib', '07', '07wbdk04t6.xml'), sampleXml);
}

test('Client Endpoints & Attribution Tests', async (t) => {
  setupTest();

  await t.test('enrichWithAttribution unit test', () => {
    const record = {
      leader: '00000nam a2200000Ia 4500',
      controlFields: [{ tag: '001', value: 'vtls001' }],
      dataFields: [
        { tag: '040', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: 'MY-KLP' }] },
        { tag: '245', ind1: '1', ind2: '0', subfields: [{ code: 'a', value: 'Title' }] }
      ]
    };
    const enriched = enrichWithAttribution(record, 'TESTID1234');
    
    // Check 040 $d
    const f040 = enriched.dataFields.find(f => f.tag === '040');
    assert.ok(f040);
    const dSubfield = f040.subfields.find(sf => sf.code === 'd');
    assert.strictEqual(dSubfield.value, 'PustakaTerbuka');

    // Check 856
    const f856 = enriched.dataFields.find(f => f.tag === '856');
    assert.ok(f856);
    assert.strictEqual(f856.subfields.find(s => s.code === 'u').value, 'https://github.com/aplikasi-perpustakaan/pustaka-terbuka');

    // Check 900
    const f900 = enriched.dataFields.find(f => f.tag === '900');
    assert.ok(f900);
    assert.strictEqual(f900.subfields.find(s => s.code === 'a').value, 'PustakaTerbuka');
    assert.strictEqual(f900.subfields.find(s => s.code === 'r').value, 'TESTID1234');

    // Check original fields preserved
    assert.strictEqual(enriched.controlFields[0].value, 'vtls001');
    assert.strictEqual(enriched.dataFields.find(f => f.tag === '245').subfields[0].value, 'Title');
  });

  await t.test('Build creates normalized ISBN and ISSN endpoints with attribution', async () => {
    const report = await buildSite({
      dataDir: DATA_DIR,
      distDir: DIST_DIR,
      dumpsDir: DUMPS_DIR,
      baseUrl: '/pustaka-terbuka/',
      isbnFetchFiles: true,
      issnFetchFiles: true
    });

    assert.strictEqual(report.recordsProcessed, 1);

    // 1. Direct ID endpoint
    const idPath = path.join(DIST_DIR, 'id', '07wbdk04t6.xml');
    assert.ok(fs.existsSync(idPath), 'ID endpoint must exist');
    const idXml = fs.readFileSync(idPath, 'utf8');

    // Preserved source fields
    assert.ok(idXml.includes('vtls000898574'), 'PNM 001 control field must be preserved');
    assert.ok(idXml.includes('(PNM)vtls000898574'), '035 field must be preserved');
    assert.ok(idXml.includes('510 AHM'), '852 call number must be preserved');

    // Injected attribution
    assert.ok(idXml.includes('code="d">PustakaTerbuka</marc:subfield>'), '040 $d attribution must be present');
    assert.ok(idXml.includes('tag="856"'), '856 link must be present');
    assert.ok(idXml.includes('tag="900"'), '900 custom attribution tag must be present');

    // 2. Direct ISBN endpoint (normalized without hyphens or trailing text)
    const isbnPath = path.join(DIST_DIR, 'isbn', '9789830123456.xml');
    assert.ok(fs.existsSync(isbnPath), 'Normalized ISBN endpoint must exist');
    const isbnXml = fs.readFileSync(isbnPath, 'utf8');
    assert.strictEqual(isbnXml, idXml, 'ISBN endpoint must match enriched ID XML');

    // 3. Direct ISSN endpoint (normalized without hyphens)
    const issnPath = path.join(DIST_DIR, 'issn', '01281232.xml');
    assert.ok(fs.existsSync(issnPath), 'Normalized ISSN endpoint must exist');
    const issnXml = fs.readFileSync(issnPath, 'utf8');
    assert.strictEqual(issnXml, idXml, 'ISSN endpoint must match enriched ID XML');
  });

  // Cleanup
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});
