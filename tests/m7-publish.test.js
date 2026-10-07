import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

test('Publish-Catalog.ps1 dry-run mode', (t) => {
    if (!fs.existsSync('config')) {
        fs.mkdirSync('config');
    }
    if (!fs.existsSync('config/config.json')) {
        fs.writeFileSync('config/config.json', JSON.stringify({}));
    }

    const result = spawnSync('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', '.\\scripts\\Publish-Catalog.ps1',
        '-WhatIf', '-SkipHarvest', '-SkipPublish'
    ], { stdio: 'pipe', encoding: 'utf-8' });

    assert.strictEqual(result.status, 0, 'Script failed with output:\n' + result.stdout + '\n' + result.stderr);
});
