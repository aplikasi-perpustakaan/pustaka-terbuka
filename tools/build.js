import fs from 'fs';
import path from 'path';
import { buildSite } from './lib/build.js';

const args = process.argv.slice(2);
let dataDir = 'data';
let distDir = 'dist';
let configPath = 'config/config.json';
let isbnFetchFiles = true;
let issnFetchFiles = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data-dir') dataDir = args[++i];
  else if (args[i] === '--dist-dir') distDir = args[++i];
  else if (args[i] === '--config') configPath = args[++i];
  else if (args[i] === '--no-isbn-fetch') isbnFetchFiles = false;
  else if (args[i] === '--no-issn-fetch') issnFetchFiles = false;
}

const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

async function run() {
  try {
    const report = await buildSite({
      dataDir,
      distDir,
      dumpsDir: 'dumps',
      baseUrl: config.baseUrl || '/pustaka-terbuka/',
      config,
      isbnFetchFiles,
      issnFetchFiles
    });
    
    console.log('Build Report:');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

run();
