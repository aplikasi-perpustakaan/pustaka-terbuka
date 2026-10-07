import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

test('M9 Pilot: Generate fixtures and validate', async (t) => {
  const count = 10;
  const sourceCode = 'm9-pilot-test';
  const runId = 'run-test';
  const outdir = 'tests/m9-pilot-tmp';

  // Clean up if exists
  if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true, force: true });
  }

  // 1. Generate fixtures
  execSync(`node tools/gen-fixtures.js --count ${count} --outdir ${outdir}`, { stdio: 'pipe' });

  // Verify files exist
  assert.ok(fs.existsSync(path.join(outdir, 'manifest.json')), 'manifest.json should exist');
  assert.ok(fs.existsSync(path.join(outdir, 'provenance.jsonl')), 'provenance.jsonl should exist');
  assert.ok(fs.existsSync(path.join(outdir, 'records')), 'records directory should exist');

  // 2. Validate inbox
  try {
    execSync(`node tools/validate-inbox.js ${outdir}`, { stdio: 'pipe' });
    assert.ok(true, 'validate-inbox should pass without error');
  } catch (err) {
    assert.fail(`validate-inbox failed: ${err.stdout?.toString() || err.message}`);
  }

  // Clean up
  if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
});
