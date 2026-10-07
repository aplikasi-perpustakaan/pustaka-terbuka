import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

test('Publish-Catalog.ps1 dry-run mode', (t) => {
    // Ensure config/config.json exists
    if (!fs.existsSync('config')) {
        fs.mkdirSync('config');
    }
    if (!fs.existsSync('config/config.json')) {
        fs.writeFileSync('config/config.json', JSON.stringify({}));
    }

    // Ensure harvest/inbox and basic manifest to pass validation
    if (!fs.existsSync('harvest/inbox/records')) {
        fs.mkdirSync('harvest/inbox/records', { recursive: true });
    }
    fs.writeFileSync('harvest/inbox/manifest.json', JSON.stringify({
        schema_version: "1.0",
        source_code: "harvest",
        source_name: "Harvest Dummy",
        source_base_url: "http://dummy.com",
        terms_url: "http://dummy.com",
        terms_verified_on: "2026-10-07",
        harvester_name: "dummy-harvester",
        harvester_version: "1.0.0",
        run_id: "run-1",
        mode: "full",
        started_at: "2026-10-07T00:00:00Z",
        finished_at: "2026-10-07T00:00:00Z",
        record_count: 0,
        error_count: 0,
        status: "complete",
        user_agent: "dummy/1.0"
    }));
    fs.writeFileSync('harvest/inbox/provenance.jsonl', '');

    const result = spawnSync('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', 'scripts/Publish-Catalog.ps1',
        '-WhatIf',
        '-SkipHarvest',
        '-SkipPublish'
    ], {
        encoding: 'utf-8'
    });

    // Check exit code
    assert.strictEqual(result.status, 0, `Script failed with output:\n${result.stdout}\n${result.stderr}`);
    
    // Check if it logged properly
    assert.ok(result.stdout.includes('Publish-Catalog pipeline complete'), 'Should complete pipeline successfully');
    assert.ok(result.stdout.includes('[WhatIf] Would run: git add data/'), 'Should contain WhatIf logs for git operations');
    assert.ok(result.stdout.includes('Validating inbox'), 'Should have executed validation steps');
});
