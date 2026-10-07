import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  let sizes = [5000];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sizes') {
      sizes = args[++i].split(',').map(s => parseInt(s.trim(), 10));
    }
  }
  return { sizes };
}

function runCommand(command, env = {}) {
  console.log(`Running: ${command}`);
  const start = Date.now();
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } });
    const end = Date.now();
    return { success: true, timeMs: end - start, output };
  } catch (error) {
    const end = Date.now();
    console.error(`Command failed: ${command}`);
    console.error(error.stdout);
    console.error(error.stderr);
    return { success: false, timeMs: end - start, error: error.message };
  }
}

async function main() {
  const { sizes } = parseArgs();
  const report = {};

  for (const size of sizes) {
    console.log(`\n=== Running pilot for size ${size} ===`);
    const sourceCode = `pilot-source-${size}`;
    const runId = `run-${Date.now()}`;
    const inboxDir = `harvest/inbox/${sourceCode}/${runId}`;
    const dataDir = `pilot-data-${size}`;
    const distDir = `pilot-dist-${size}`;

    // Clean up previous runs
    for (const dir of [inboxDir, dataDir, distDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const metrics = {};

    // 1. Generate fixtures
    const genRes = runCommand(`node tools/gen-fixtures.js --count ${size} --outdir ${inboxDir}`);
    metrics.genFixtures = { timeMs: genRes.timeMs, success: genRes.success };

    if (!genRes.success) {
      report[size] = metrics;
      continue;
    }

    // 2. Merge
    const mergeRes = runCommand(`node tools/merge.js ${inboxDir} --data-dir ${dataDir}`);
    metrics.merge = { timeMs: mergeRes.timeMs, success: mergeRes.success };

    // 3. Build
    const buildRes = runCommand(`node tools/build.js --data-dir ${dataDir} --dist-dir ${distDir}`);
    metrics.build = { timeMs: buildRes.timeMs, success: buildRes.success };
    
    report[size] = metrics;

    // Clean up after success to save disk space if it gets too large?
    // Let's keep them as they might be needed.
  }

  console.log('\n=== Pilot Report ===');
  console.log(JSON.stringify(report, null, 2));
  
  // Write report to file
  fs.writeFileSync('pilot-report.json', JSON.stringify(report, null, 2));
  console.log('Saved report to pilot-report.json');
}

main().catch(console.error);
