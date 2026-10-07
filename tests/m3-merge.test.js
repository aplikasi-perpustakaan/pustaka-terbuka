import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { mergeInbox } from '../tools/lib/merge.js';
import { serialize } from '../tools/lib/marcxml.js';
import { loadAliases } from '../tools/lib/aliases.js';

function setupEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-merge-test-'));
  const dataDir = path.join(tempDir, 'data');
  const inboxDir = path.join(tempDir, 'inbox');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(inboxDir, { recursive: true });
  
  const sourcesPath = path.join(tempDir, 'sources.json');
  fs.writeFileSync(sourcesPath, JSON.stringify({
    "test-source-a": { "name": "Test Source A", "prefix": "TSA", "priority": 1 },
    "test-source-b": { "name": "Test Source B", "prefix": "TSB", "priority": 2 }
  }));
  
  return { tempDir, dataDir, inboxDir, sourcesPath };
}

function teardownEnv(tempDir) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function createRecord(fields) {
  const record = {
    leader: '00000nam a2200000 u 4500',
    controlFields: [],
    dataFields: []
  };

  if (fields.f001) record.controlFields.push({ tag: '001', value: fields.f001 });
  
  if (fields.isbn) {
    record.dataFields.push({ tag: '020', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: fields.isbn }] });
  }

  if (fields.title) {
    record.dataFields.push({ tag: '245', ind1: '1', ind2: '0', subfields: [{ code: 'a', value: fields.title }] });
  }

  if (fields.source) {
    record.dataFields.push({ tag: '996', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: fields.source }] });
  }

  return record;
}

test('Merge Engine - New record', async (t) => {
  const env = setupEnv();
  const rec = createRecord({ f001: '123', isbn: '9781234567897', title: 'Test Book', source: 'test-source-a' });
  
  fs.writeFileSync(path.join(env.inboxDir, 'rec1.xml'), serialize([rec]));
  
  const report = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  
  assert.strictEqual(report.new, 1);
  assert.strictEqual(report.mergedIntoExisting, 0);
  
  const aliasMap = loadAliases(path.join(env.dataDir, 'aliases.jsonl'));
  assert.strictEqual(aliasMap.has('035:(TSA)123'), true);
  assert.strictEqual(aliasMap.has('isbn:9781234567897'), true);
  
  teardownEnv(env.tempDir);
});

test('Merge Engine - Same ISBN from two sources', async (t) => {
  const env = setupEnv();
  const rec1 = createRecord({ f001: '123', isbn: '9781234567897', title: 'Test Book', source: 'test-source-a' });
  const rec2 = createRecord({ f001: '456', isbn: '9781234567897', title: 'Test Book', source: 'test-source-b' });
  
  fs.writeFileSync(path.join(env.inboxDir, 'rec1.xml'), serialize([rec1]));
  const report1 = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  assert.strictEqual(report1.new, 1);
  
  // Clear inbox and add second
  fs.rmSync(path.join(env.inboxDir, 'rec1.xml'));
  fs.writeFileSync(path.join(env.inboxDir, 'rec2.xml'), serialize([rec2]));
  const report2 = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  
  assert.strictEqual(report2.mergedIntoExisting, 1);
  
  const aliasMap = loadAliases(path.join(env.dataDir, 'aliases.jsonl'));
  const id1 = aliasMap.get('035:(TSA)123').id;
  const id2 = aliasMap.get('035:(TSB)456').id;
  assert.strictEqual(id1, id2); // Merged into same ID
  
  teardownEnv(env.tempDir);
});

test('Merge Engine - Idempotent rerun', async (t) => {
  const env = setupEnv();
  const rec = createRecord({ f001: '123', isbn: '9781234567897', title: 'Test Book', source: 'test-source-a' });
  
  fs.writeFileSync(path.join(env.inboxDir, 'rec1.xml'), serialize([rec]));
  
  await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  const report = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  
  assert.strictEqual(report.unchanged, 1);
  assert.strictEqual(report.new, 0);
  assert.strictEqual(report.mergedIntoExisting, 0);
  
  teardownEnv(env.tempDir);
});

test('Merge Engine - Corrupt alias table refusal', async (t) => {
  const env = setupEnv();
  const rec = createRecord({ f001: '123', isbn: '9781234567897', title: 'Test Book', source: 'test-source-a' });
  
  fs.writeFileSync(path.join(env.inboxDir, 'rec1.xml'), serialize([rec]));
  await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  
  // Now corrupt the alias table
  fs.unlinkSync(path.join(env.dataDir, 'aliases.jsonl'));
  
  try {
    await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
    assert.fail('Should have thrown error');
  } catch (err) {
    assert.match(err.message, /Alias table missing/);
  }
  
  teardownEnv(env.tempDir);
});

test('Merge Engine - Ambiguous fallback match', async (t) => {
  const env = setupEnv();
  // We need two distinct existing records to cause ambiguity
  const rec1 = createRecord({ f001: '123', isbn: '9781234567897', title: 'Test Book A', source: 'test-source-a' });
  const rec2 = createRecord({ f001: '456', isbn: '9780000000000', title: 'Test Book B', source: 'test-source-b' });
  
  fs.writeFileSync(path.join(env.inboxDir, 'rec1.xml'), serialize([rec1, rec2]));
  const report1 = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  assert.strictEqual(report1.new, 2);
  
  // Now create a third record that matches rec1 on ISBN and rec2 on fallback key
  const rec3 = createRecord({ f001: '789', isbn: '9781234567897', title: 'Test Book B', source: 'test-source-a' });
  fs.rmSync(path.join(env.inboxDir, 'rec1.xml'));
  fs.writeFileSync(path.join(env.inboxDir, 'rec3.xml'), serialize([rec3]));
  
  const report2 = await mergeInbox(env.inboxDir, { dataDir: env.dataDir, sourcesPath: env.sourcesPath });
  assert.strictEqual(report2.ambiguous, 1);
  
  teardownEnv(env.tempDir);
});

