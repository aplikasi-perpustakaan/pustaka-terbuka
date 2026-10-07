import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

describe('M0: Scaffold', () => {
  const requiredFiles = [
    'package.json',
    '.gitattributes',
    '.gitignore',
    'data/orgs.json',
    'data/sources.json',
    'data/state/sources-state.json',
    'config/config.example.json',
  ];

  for (const file of requiredFiles) {
    it(`${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, file)), `Missing: ${file}`);
    });
  }
});
