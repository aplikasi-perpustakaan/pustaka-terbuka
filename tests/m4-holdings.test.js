import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { loadHoldings, saveHoldings, resolveHoldingsRecords, getHoldingsForRecord, getHoldingsForOrg, loadAllHoldings } from '../tools/lib/holdings.js';
import { validateHoldings } from '../tools/validate-holdings.js';

test('Holdings functionality', async (t) => {
  const fixturesDir = path.resolve('tests/fixtures/holdings');
  const orgsFile = path.resolve('data/orgs.json');
  
  // Create a temporary alias map
  const aliasMap = new Map();
  aliasMap.set('9780000000000', { id: 'test-permanent-id', type: 'isbn', ts: Date.now() });

  await t.test('orgs.json schema validation', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve('tools/schemas/orgs.schema.json'), 'utf8'));
    const orgs = JSON.parse(fs.readFileSync(orgsFile, 'utf8'));
    const ajv = new Ajv();
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(orgs);
    assert.ok(valid, ajv.errorsText(validate.errors));
  });

  await t.test('Load valid holdings file', () => {
    const rows = loadHoldings(path.join(fixturesDir, 'SKBayanLepas.csv'));
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].record, 'rec1');
  });

  await t.test('Resolve records with ISBN alias', () => {
    const rows = loadHoldings(path.join(fixturesDir, 'isbn-record.csv'));
    const { resolved, unresolvable } = resolveHoldingsRecords(rows, aliasMap);
    assert.strictEqual(unresolvable.length, 0);
    assert.strictEqual(resolved[0].record, 'test-permanent-id');
  });

  await t.test('Unresolved record ID warned', () => {
    const rows = loadHoldings(path.join(fixturesDir, 'unresolved-record.csv'));
    const { resolved, unresolvable } = resolveHoldingsRecords(rows, aliasMap);
    assert.strictEqual(unresolvable.length, 1);
    assert.strictEqual(unresolvable[0].record, '9781234567890');
    assert.strictEqual(resolved[0].record, '9781234567890'); // Original stays
  });

  await t.test('Validation reports errors for duplicate, wrong org, etc.', () => {
    const tempOrgsFile = path.join(fixturesDir, 'temp-orgs.json');
    fs.writeFileSync(tempOrgsFile, JSON.stringify({
      'SKBayanLepas': { name: '1', state: '1', type: 'school', default_scheme: 'DDC' },
      'wrong-org': { name: '1', state: '1', type: 'school', default_scheme: 'DDC' },
      'duplicate-rows': { name: '1', state: '1', type: 'school', default_scheme: 'DDC' },
      'unresolved-record': { name: '1', state: '1', type: 'school', default_scheme: 'DDC' },
      'isbn-record': { name: '1', state: '1', type: 'school', default_scheme: 'DDC' }
    }));
    
    const tempAliasFile = path.join(fixturesDir, 'temp-aliases.jsonl');
    fs.writeFileSync(tempAliasFile, JSON.stringify({ key: '9780000000000', id: 'test-permanent-id', type: 'isbn', ts: Date.now() }) + '\n');

    const report = validateHoldings(fixturesDir, tempOrgsFile, tempAliasFile);
    
    const duplicateError = report.errors.find(e => e.includes('Duplicate row found'));
    assert.ok(duplicateError, 'Should find duplicate row error');

    const wrongOrgError = report.errors.find(e => e.includes('does not match file org'));
    assert.ok(wrongOrgError, 'Should find wrong org error');

    const unresolvedWarning = report.warnings.find(w => w.includes('unresolved ISBN'));
    assert.ok(unresolvedWarning, 'Should find unresolved warning');
    
    fs.unlinkSync(tempOrgsFile);
    fs.unlinkSync(tempAliasFile);
  });
});
