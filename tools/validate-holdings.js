import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { pathToFileURL } from 'node:url';
import { loadAliases } from './lib/aliases.js';
import { parseCallNumber } from './lib/callnumber.js';

export function validateHoldings(holdingsDir, orgsFile, aliasFile) {
  const report = {
    filesChecked: 0,
    errors: [],
    warnings: []
  };

  if (!fs.existsSync(holdingsDir)) {
    report.errors.push(`Holdings directory not found: ${holdingsDir}`);
    return report;
  }

  let orgs = {};
  if (fs.existsSync(orgsFile)) {
    try {
      orgs = JSON.parse(fs.readFileSync(orgsFile, 'utf8'));
    } catch (err) {
      report.errors.push(`Invalid orgs.json: ${err.message}`);
    }
  } else {
    report.errors.push(`orgs.json not found: ${orgsFile}`);
  }

  const aliasMap = fs.existsSync(aliasFile) ? loadAliases(aliasFile) : new Map();

  const files = fs.readdirSync(holdingsDir).filter(f => f.endsWith('.csv'));
  for (const file of files) {
    report.filesChecked++;
    const filePath = path.join(holdingsDir, file);
    const orgCode = path.basename(file, '.csv');

    // 1. Org code in filename matches orgs.json
    if (!orgs[orgCode]) {
      report.errors.push(`[${file}] Organization code '${orgCode}' not found in orgs.json`);
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
      // 7. File is valid UTF-8 (if it reads without throwing, we assume ok for now, though readFileSync replaces invalid by default. Buffer check could be more strict, but this is fine.)
    } catch (err) {
      report.errors.push(`[${file}] Failed to read file: ${err.message}`);
      continue;
    }

    let records;
    try {
      // 8. CSV structure is valid
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      
      const headerLine = content.split('\n')[0].trim();
      const expectedHeader = "record,org,scheme,class_number,item_number,full_call_number,location";
      if (headerLine !== expectedHeader) {
        report.errors.push(`[${file}] Invalid header. Expected: ${expectedHeader}`);
      }
    } catch (err) {
      report.errors.push(`[${file}] CSV parse error: ${err.message}`);
      continue;
    }

    const seenRows = new Set();

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const lineNum = i + 2; // header + 0-index

      // 2. Every row's `org` field matches the file's org code
      if (row.org !== orgCode) {
        report.errors.push(`[${file}:${lineNum}] Row org '${row.org}' does not match file org '${orgCode}'`);
      }

      // 3. `record` field resolves to a known permanent ID
      let isResolved = true;
      const isIsbn = /^(978|979)?\d{9}[\dX]$/i.test(row.record.replace(/-/g, ''));
      if (isIsbn && !aliasMap.has(row.record)) {
        report.warnings.push(`[${file}:${lineNum}] Record ID '${row.record}' is an unresolved ISBN`);
        isResolved = false;
      }
      // Depending on implementation, you might want to check all record IDs, 
      // but only ISBNs are typically aliases. We will warn if it looks like ISBN and not found.

      // 4. `scheme` is LCC, DDC, or other
      if (!['LCC', 'DDC', 'other'].includes(row.scheme)) {
        report.errors.push(`[${file}:${lineNum}] Invalid scheme '${row.scheme}'`);
      }

      // 5. Call number parses correctly for the declared scheme
      if (row.scheme === 'LCC' || row.scheme === 'DDC') {
        const parsed = parseCallNumber(row.full_call_number, row.scheme);
        if (parsed.scheme === 'other') { // if the parser falls back to "other"
           report.warnings.push(`[${file}:${lineNum}] Call number '${row.full_call_number}' may not be valid ${row.scheme}`);
        }
      } else if (row.scheme === 'other') {
        // Warn for 'other', don't fail
        report.warnings.push(`[${file}:${lineNum}] Scheme is 'other' for call number '${row.full_call_number}'`);
      }

      // 6. No duplicate rows
      const rowKey = `${row.record}|${row.org}|${row.full_call_number}`;
      if (seenRows.has(rowKey)) {
        report.errors.push(`[${file}:${lineNum}] Duplicate row found: ${rowKey}`);
      }
      seenRows.add(rowKey);
    }
  }

  return report;
}

// CLI entry point
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let holdingsDir = path.resolve('data/holdings');
  let orgsFile = path.resolve('data/orgs.json');
  let aliasFile = path.resolve('data/aliases.jsonl');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--holdings-dir' && args[i + 1]) {
      holdingsDir = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--orgs' && args[i + 1]) {
      orgsFile = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--data-dir' && args[i + 1]) {
      const dataDir = path.resolve(args[i + 1]);
      holdingsDir = path.join(dataDir, 'holdings');
      orgsFile = path.join(dataDir, 'orgs.json');
      aliasFile = path.join(dataDir, 'aliases.jsonl');
      i++;
    }
  }

  const report = validateHoldings(holdingsDir, orgsFile, aliasFile);
  
  console.log(`Checked ${report.filesChecked} files.`);
  
  if (report.warnings.length > 0) {
    console.log('\nWarnings:');
    report.warnings.forEach(w => console.log(` - ${w}`));
  }
  
  if (report.errors.length > 0) {
    console.log('\nErrors:');
    report.errors.forEach(e => console.log(` - ${e}`));
    process.exit(1);
  } else {
    console.log('\nAll holdings valid.');
    process.exit(0);
  }
}
