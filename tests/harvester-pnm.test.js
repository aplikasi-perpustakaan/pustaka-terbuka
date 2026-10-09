import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runHarvest } from '../tools/harvesters/pnm/harvester.js';
import { validateInbox } from '../tools/validate-inbox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmpInboxDir = path.join(__dirname, 'fixtures', 'inbox', 'pnm', 'test-run');

test('PNM Harvester Node module exports runHarvest and handles --help', async () => {
  const code = await runHarvest(['--help']);
  assert.strictEqual(code, 0);
});

test('Existing PNM harvest inbox batch passes validation', async () => {
  const pnmBatchDir = path.join(__dirname, '..', 'harvest', 'inbox', 'pnm', '2026-10-07T13-16-01-932Z');
  if (fs.existsSync(pnmBatchDir)) {
    const res = await validateInbox(pnmBatchDir, { skipDropGate: true });
    assert.strictEqual(res.valid, true, `Expected valid inbox batch, got errors: ${res.errors.join(', ')}`);
  }
});
