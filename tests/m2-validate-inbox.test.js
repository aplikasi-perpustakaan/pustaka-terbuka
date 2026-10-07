import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateInbox } from '../tools/validate-inbox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'inbox');
const stateFile = path.join(__dirname, 'fixtures', 'sources-state-drop.json');

test('Valid batch passes all checks', async () => {
  const p = path.join(fixturesDir, 'valid-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, true, `Expected valid, got errors: ${result.errors.join(', ')}`);
});

test('Partial batch rejected without allowPartial', async () => {
  const p = path.join(fixturesDir, 'partial-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("status is 'partial'")));
});

test('Partial batch accepted with allowPartial', async () => {
  const p = path.join(fixturesDir, 'partial-source', 'run-001');
  const result = await validateInbox(p, { allowPartial: true, sourcesState: stateFile });
  assert.strictEqual(result.valid, true, `Expected valid, got errors: ${result.errors.join(', ')}`);
});

test('Malformed manifest (missing field) rejected', async () => {
  const p = path.join(fixturesDir, 'malformed-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("schema validation failed") || e.includes("missing")));
});

test('Count mismatch rejected', async () => {
  const p = path.join(fixturesDir, 'bad-count-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("does not match total records found in XML files")));
});

test('Bad XML rejected', async () => {
  const p = path.join(fixturesDir, 'bad-xml-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("malformed") || e.includes("missing required field")));
});

test('Drop gate triggers when count drops > 5%', async () => {
  const p = path.join(fixturesDir, 'drop-gate-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes("Drop gate triggered")));
});

test('Drop gate passes when skipDropGate is true', async () => {
  const p = path.join(fixturesDir, 'drop-gate-source', 'run-001');
  const result = await validateInbox(p, { sourcesState: stateFile, skipDropGate: true });
  assert.strictEqual(result.valid, true, `Expected valid, got errors: ${result.errors.join(', ')}`);
});
