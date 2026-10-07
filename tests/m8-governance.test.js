import fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Governance and M8 requirements', () => {
  const rootDir = process.cwd();

  test('GitHub Actions PR validation workflow exists', () => {
    const filePath = path.join(rootDir, '.github', 'workflows', 'validate-pr.yml');
    assert.ok(fs.existsSync(filePath), 'validate-pr.yml should exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /npm run validate-holdings/, 'Workflow must validate holdings');
    assert.doesNotMatch(content, /npm run build/, 'Workflow must not build the site');
  });

  test('CODEOWNERS uses teams and has required documentation', () => {
    const filePath = path.join(rootDir, '.github', 'CODEOWNERS');
    assert.ok(fs.existsSync(filePath), 'CODEOWNERS should exist');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /@aplikasi-perpustakaan\//, 'CODEOWNERS should use organization teams');
    assert.match(content, /Write access/, 'Must document write access requirement');
    assert.match(content, /branch protection/, 'Must document branch protection requirement');
  });

  test('README.md has correct tagline and sections', () => {
    const filePath = path.join(rootDir, 'README.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /PustakaTerbuka: an open, shared MARC catalog for Malaysian schools and libraries\./, 'Must have correct tagline');
    assert.match(content, /## Architecture/, 'Must explain architecture');
    assert.match(content, /Quick Start for Librarians/, 'Must have quick start for librarians');
    assert.match(content, /\?org=/, 'Must explain how to link to org view');
  });

  test('CONTRIBUTING.md explains holdings PR process', () => {
    const filePath = path.join(rootDir, 'CONTRIBUTING.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /Submitting or Updating Holdings/i, 'Must explain how to submit or update holdings');
    assert.match(content, /pull request/i, 'Must mention pull request');
  });

  test('RUNBOOK.md includes all required sections', () => {
    const filePath = path.join(rootDir, 'docs', 'RUNBOOK.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /Full Pipeline Explanation/, 'Must include full pipeline');
    assert.match(content, /Recovery from a Lost Machine/, 'Must include recovery process');
    assert.match(content, /Rollback to a Previous Tag/, 'Must include rollback process');
    assert.match(content, /Training a Second Operator/, 'Must include training instructions');
    assert.match(content, /Zenodo/i, 'Must document Zenodo steps');
    assert.match(content, /GitHub settings/i, 'Must mention GitHub settings for Zenodo');
  });

  test('Preservation files exist', () => {
    assert.ok(fs.existsSync(path.join(rootDir, '.zenodo.json')), '.zenodo.json should exist');
    assert.ok(fs.existsSync(path.join(rootDir, 'CITATION.cff')), 'CITATION.cff should exist');
    assert.ok(fs.existsSync(path.join(rootDir, 'docs', 'TAKEDOWN.md')), 'docs/TAKEDOWN.md should exist');
    assert.ok(fs.existsSync(path.join(rootDir, 'docs', 'DATA_LICENSE.md')), 'docs/DATA_LICENSE.md should exist');
  });
});
