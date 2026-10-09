#!/usr/bin/env node

/**
 * PustakaTerbuka - PNM (Perpustakaan Negara Malaysia) Harvester (Node.js)
 * 
 * Harvests catalog records from the PNM Vega Discover REST API
 * into MARCXML following PustakaTerbuka Harvester Standards.
 * 
 * Spec: docs/HARVESTERS.md
 * Contract: harvest/inbox/pnm/<run-id>/
 *   - manifest.json
 *   - records/batch_<n>.xml
 *   - provenance.jsonl
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const SOURCE_CODE = 'pnm';
const SOURCE_NAME = 'Perpustakaan Negara Malaysia';
const SOURCE_BASE_URL = 'https://opac.pnm.gov.my/';
const TERMS_URL = 'https://www.pnm.gov.my/';
const BASE_API_URL = 'https://ap.iiivega.com/api/search-result/search/format-groups';
const USER_AGENT = 'PustakaTerbuka Harvester (+https://github.com/aplikasi-perpustakaan/pustaka-terbuka)';
const HARVESTER_NAME = 'pnm-vega-scraper-node';
const HARVESTER_VERSION = '1.0.0';

// Find repository root (directory containing package.json)
function findRepoRoot(startDir) {
  let curr = path.resolve(startDir);
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, 'package.json'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return startDir;
}

// Parse CLI arguments
function parseArgs(args) {
  const options = {
    maxPages: 0,
    pageSize: 100,
    query: '*',
    delayMs: 2000,
    mode: 'full',
    outDir: null,
    skipPipeline: false,
    freshRun: false,
    resumeTarget: null,
    dateFrom: null,
    dateTo: null,
    partitioned: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--max-pages' && i + 1 < args.length) {
      options.maxPages = parseInt(args[++i], 10);
    } else if (arg === '--page-size' && i + 1 < args.length) {
      options.pageSize = parseInt(args[++i], 10);
    } else if (arg === '--query' && i + 1 < args.length) {
      options.query = args[++i];
    } else if (arg === '--delay' && i + 1 < args.length) {
      options.delayMs = parseInt(args[++i], 10);
    } else if (arg === '--mode' && i + 1 < args.length) {
      options.mode = args[++i];
    } else if (arg === '--out-dir' && i + 1 < args.length) {
      options.outDir = args[++i];
    } else if (arg === '--date-from' && i + 1 < args.length) {
      options.dateFrom = parseInt(args[++i], 10);
    } else if (arg === '--date-to' && i + 1 < args.length) {
      options.dateTo = parseInt(args[++i], 10);
    } else if (arg === '--partitioned') {
      options.partitioned = true;
    } else if (arg === '--skip-pipeline' || arg === '--no-pipeline') {
      options.skipPipeline = true;
    } else if (arg === '--fresh' || arg === '--no-resume' || arg === '--new') {
      options.freshRun = true;
    } else if (arg === '--resume') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.resumeTarget = args[++i];
      } else {
        options.resumeTarget = 'auto';
      }
    }
  }

  return options;
}

function printHelp() {
  console.log(`
PustakaTerbuka PNM Harvester (Node.js)

Usage:
  node tools/harvesters/pnm/harvester.js [options]

Options:
  --max-pages <num>          Maximum number of pages to fetch (default: 0 for all records)
  --page-size <num>          Records per page, max 100 (default: 100)
  --query <str>              Search query string (default: "*")
  --delay <ms>               Delay between page requests in ms (default: 2000)
  --mode <full|incremental>  Harvest mode (default: "full")
  --date-from <year>         Filter records by starting publication year
  --date-to <year>           Filter records by ending publication year
  --partitioned              Harvest catalog using query partitioning (bypasses OpenSearch 10k window)
  --out-dir <path>           Override output inbox directory
  --skip-pipeline            Skip automated validate, merge, and build steps
  --fresh, --no-resume       Always start a new harvest run (do not resume incomplete run)
  --resume [run-id]          Resume a specific run ID or folder (default: auto-resumes latest incomplete run)
  -h, --help                 Show this help message
`);
}

function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/\uFFFD/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPageWithRetry(query, pageNum, pageSize, extraParams = {}, maxRetries = 5) {
  const body = {
    searchText: query,
    searchType: extraParams.searchType || 'everything',
    pageNum,
    pageSize,
    resourceType: 'FormatGroup'
  };
  if (extraParams.dateFrom != null) body.dateFrom = extraParams.dateFrom;
  if (extraParams.dateTo != null) body.dateTo = extraParams.dateTo;
  if (extraParams.languageIds) body.languageIds = extraParams.languageIds;

  const payload = JSON.stringify(body);

  const headers = {
    'iii-customer-domain': 'pnm.ap.iiivega.com',
    'iii-host-domain': 'opac.pnm.gov.my',
    'api-version': '2',
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json'
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(BASE_API_URL, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(60000)
      });

      if (response.ok) {
        return await response.json();
      }

      const status = response.status;
      if (status === 400 && pageNum >= 100) {
        console.warn(`[WARN] Page ${pageNum} reached OpenSearch 10,000 max_result_window. Safely capping partition.`);
        return { data: [], totalResults: 10000 };
      }
      let backoffMs = Math.min(300000, 5000 * Math.pow(2, attempt - 1));

      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        if (!isNaN(parsed)) {
          backoffMs = parsed * 1000;
        }
      }

      console.warn(`[WARN] HTTP ${status} on page ${pageNum} (attempt ${attempt}/${maxRetries}). Backing off ${backoffMs / 1000}s...`);
      if (attempt === maxRetries) {
        throw new Error(`HTTP ${status}: ${response.statusText}`);
      }
      await sleep(backoffMs);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoffMs = Math.min(300000, 5000 * Math.pow(2, attempt - 1));
      console.warn(`[WARN] Network error on page ${pageNum} (attempt ${attempt}/${maxRetries}): ${err.message}. Backing off ${backoffMs / 1000}s...`);
      await sleep(backoffMs);
    }
  }

  throw new Error(`Failed to fetch page ${pageNum} after ${maxRetries} attempts.`);
}

function isIncompleteRun(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return fs.existsSync(path.join(dir, 'records'));
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest.status !== 'complete';
  } catch {
    return true;
  }
}

function findLatestIncompleteRun(baseDir) {
  if (!fs.existsSync(baseDir)) return null;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  for (const name of entries) {
    const fullPath = path.join(baseDir, name);
    if (isIncompleteRun(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function inspectBatches(recordsDir) {
  const validBatches = new Set();
  let highestPage = -1;
  let recordCount = 0;
  if (!fs.existsSync(recordsDir)) return { validBatches, highestPage, recordCount };

  const files = fs.readdirSync(recordsDir).filter(f => f.startsWith('batch_') && f.endsWith('.xml'));
  for (const file of files) {
    const match = file.match(/^batch_(\d+)\.xml$/);
    if (match) {
      const pNum = parseInt(match[1], 10);
      const filePath = path.join(recordsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      if (content.includes('</collection>')) {
        validBatches.add(file);
        if (pNum > highestPage) highestPage = pNum;
        const matches = content.match(/<record[\s>]/g);
        recordCount += matches ? matches.length : 0;
      } else {
        console.log(`[RESUME] Removing corrupt/incomplete batch file: ${file}`);
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  }
  return { validBatches, highestPage, recordCount };
}

function cleanProvenanceFile(provPath, validBatches) {
  if (!fs.existsSync(provPath)) return;
  const content = fs.readFileSync(provPath, 'utf8');
  const lines = content.split('\n');
  const validLines = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.file && validBatches.has(parsed.file)) {
        validLines.push(line);
      }
    } catch {}
  }

  fs.writeFileSync(provPath, validLines.length > 0 ? validLines.join('\n') + '\n' : '', 'utf8');
}

function convertItemToMarcRecord(item, errorCallback) {
  const id = item.id || '';
  const identifiers = item.identifiers || {};
  const localId = identifiers.local || id;

  const title = item.title ? String(item.title).trim() : '';
  if (!title || !localId) {
    if (errorCallback) errorCallback(`missing ${!localId ? 'control ID' : 'title (245)'}`);
    return null;
  }

  // Determine Issuance (monograph vs serial)
  let issuanceType = 'm';
  if (Array.isArray(item.materialTabs)) {
    for (const tab of item.materialTabs) {
      if (Array.isArray(tab.issuance) && tab.issuance.includes('serial')) {
        issuanceType = 's';
        break;
      }
    }
  }

  const xmlLines = [];
  xmlLines.push('  <record>');
  xmlLines.push(`    <leader>00000na${issuanceType} a2200000Ia 4500</leader>`);
  xmlLines.push(`    <controlfield tag="001">${escapeXml(localId)}</controlfield>`);

  // Language (041 $a)
  if (item.language) {
    xmlLines.push('    <datafield tag="041" ind1=" " ind2=" ">');
    xmlLines.push(`      <subfield code="a">${escapeXml(item.language)}</subfield>`);
    xmlLines.push('    </datafield>');
  }

  // Extract detailed data from materialTabs
  const isbns = new Set();
  const localIds = new Set();
  const editions = new Set();
  const descriptions = new Set();
  const formats = new Set();
  const urls = new Set();
  const locations = new Set();
  let callNumber = null;

  if (identifiers.isbn) {
    if (Array.isArray(identifiers.isbn)) identifiers.isbn.forEach(v => isbns.add(String(v).trim()));
    else isbns.add(String(identifiers.isbn).trim());
  }

  if (Array.isArray(item.materialTabs)) {
    for (const tab of item.materialTabs) {
      if (tab.name) formats.add(tab.name.trim());
      if (tab.description) descriptions.add(tab.description.trim());
      
      if (tab.identifiedBy) {
        if (Array.isArray(tab.identifiedBy.isbn)) tab.identifiedBy.isbn.forEach(v => isbns.add(String(v).trim()));
        if (Array.isArray(tab.identifiedBy.local)) tab.identifiedBy.local.forEach(v => localIds.add(String(v).trim()));
      }

      if (tab.availability && Array.isArray(tab.availability.urls)) {
        tab.availability.urls.forEach(u => urls.add(String(u).trim()));
      }
      if (Array.isArray(tab.multimediaLinks)) {
        tab.multimediaLinks.forEach(m => { if (m.url) urls.add(String(m.url).trim()); });
      }

      if (Array.isArray(tab.locations)) {
        tab.locations.forEach(loc => { if (loc.label) locations.add(loc.label.trim()); });
      }

      if (Array.isArray(tab.editions)) {
        for (const ed of tab.editions) {
          if (ed.edition) editions.add(ed.edition.trim());
          if (!callNumber && ed.callNumber) callNumber = ed.callNumber;
        }
      }
    }
  }

  for (const isbn of isbns) {
    if (isbn) {
      xmlLines.push('    <datafield tag="020" ind1=" " ind2=" ">');
      xmlLines.push(`      <subfield code="a">${escapeXml(isbn)}</subfield>`);
      xmlLines.push('    </datafield>');
    }
  }

  if (identifiers.issn) {
    xmlLines.push('    <datafield tag="022" ind1=" " ind2=" ">');
    xmlLines.push(`      <subfield code="a">${escapeXml(identifiers.issn)}</subfield>`);
    xmlLines.push('    </datafield>');
  }

  for (const lid of localIds) {
    if (lid && lid !== localId) {
      xmlLines.push('    <datafield tag="035" ind1=" " ind2=" ">');
      xmlLines.push(`      <subfield code="a">${escapeXml(lid)}</subfield>`);
      xmlLines.push('    </datafield>');
    }
  }

  const author = item.primaryAgent?.label;
  if (author) {
    xmlLines.push('    <datafield tag="100" ind1="1" ind2=" ">');
    xmlLines.push(`      <subfield code="a">${escapeXml(author)}</subfield>`);
    xmlLines.push('    </datafield>');
  }

  xmlLines.push('    <datafield tag="245" ind1="0" ind2="0">');
  xmlLines.push(`      <subfield code="a">${escapeXml(title)}</subfield>`);
  xmlLines.push('    </datafield>');

  for (const ed of editions) {
    if (ed) {
      xmlLines.push('    <datafield tag="250" ind1=" " ind2=" ">');
      xmlLines.push(`      <subfield code="a">${escapeXml(ed)}</subfield>`);
      xmlLines.push('    </datafield>');
    }
  }

  const pubDate = item.publicationDate;
  if (pubDate) {
    xmlLines.push('    <datafield tag="264" ind1=" " ind2="1">');
    xmlLines.push(`      <subfield code="c">${escapeXml(pubDate)}</subfield>`);
    xmlLines.push('    </datafield>');
  }

  const series = item.seriesTitle;
  if (series) {
    xmlLines.push('    <datafield tag="490" ind1="0" ind2=" ">');
    xmlLines.push(`      <subfield code="a">${escapeXml(series)}</subfield>`);
    xmlLines.push('    </datafield>');
  }

  for (const desc of descriptions) {
    if (desc) {
      xmlLines.push('    <datafield tag="520" ind1=" " ind2=" ">');
      xmlLines.push(`      <subfield code="a">${escapeXml(desc)}</subfield>`);
      xmlLines.push('    </datafield>');
    }
  }

  for (const format of formats) {
    if (format) {
      xmlLines.push('    <datafield tag="655" ind1=" " ind2="7">');
      xmlLines.push(`      <subfield code="a">${escapeXml(format)}</subfield>`);
      xmlLines.push('      <subfield code="2">local</subfield>');
      xmlLines.push('    </datafield>');
    }
  }

  if (callNumber || locations.size > 0) {
    xmlLines.push('    <datafield tag="852" ind1=" " ind2=" ">');
    if (callNumber) {
      xmlLines.push(`      <subfield code="h">${escapeXml(callNumber)}</subfield>`);
    }
    for (const loc of locations) {
      if (loc) {
        xmlLines.push(`      <subfield code="b">${escapeXml(loc)}</subfield>`);
      }
    }
    xmlLines.push('    </datafield>');
  }

  for (const url of urls) {
    if (url) {
      xmlLines.push('    <datafield tag="856" ind1="4" ind2="0">');
      xmlLines.push(`      <subfield code="u">${escapeXml(url)}</subfield>`);
      xmlLines.push('    </datafield>');
    }
  }

  xmlLines.push('  </record>');

  return {
    localId,
    id,
    xmlText: xmlLines.join('\n')
  };
}

function generatePartitionPlan() {
  const partitions = [];
  let id = 0;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

  // 1. Mature modern catalog years (2024 down to 1980) partitioned by character
  for (let y = 2024; y >= 1980; y--) {
    for (const char of alphabet) {
      partitions.push({ id: id++, name: `year_${y}_${char}`, query: `${char}*`, dateFrom: y, dateTo: y });
    }
  }

  // 2. Current / latest accession years (2025, 2026)
  for (let y of [2025, 2026]) {
    for (const char of alphabet) {
      partitions.push({ id: id++, name: `year_${y}_${char}`, query: `${char}*`, dateFrom: y, dateTo: y });
    }
  }

  // 3. Mid-century single years (1979 down to 1950) - each year strictly <= 9,100 records
  for (let y = 1979; y >= 1950; y--) {
    partitions.push({ id: id++, name: `year_${y}`, query: '*', dateFrom: y, dateTo: y });
  }

  // 4. Historical and future eras (calibrated to stay strictly under OpenSearch 10k ceiling)
  const historicalEras = [
    { name: 'era_1941_1949', query: '*', dateFrom: 1941, dateTo: 1949 },
    { name: 'era_1931_1940', query: '*', dateFrom: 1931, dateTo: 1940 },
    { name: 'era_1921_1930', query: '*', dateFrom: 1921, dateTo: 1930 },
    { name: 'era_1900_1920', query: '*', dateFrom: 1900, dateTo: 1920 },
    { name: 'era_1850_1899', query: '*', dateFrom: 1850, dateTo: 1899 },
    { name: 'era_1800_1849', query: '*', dateFrom: 1800, dateTo: 1849 },
    { name: 'era_1700_1799', query: '*', dateFrom: 1700, dateTo: 1799 },
    { name: 'era_1001_1699', query: '*', dateFrom: 1001, dateTo: 1699 },
    { name: 'era_1_1000', query: '*', dateFrom: 1, dateTo: 1000 },
    { name: 'era_2027_2050', query: '*', dateFrom: 2027, dateTo: 2050 }
  ];
  for (const e of historicalEras) {
    partitions.push({ id: id++, ...e });
  }

  return partitions;
}

export async function runHarvest(cliArgs = process.argv.slice(2)) {
  const options = parseArgs(cliArgs);
  if (options.help) {
    printHelp();
    return 0;
  }

  const repoRoot = findRepoRoot(__dirname);
  const pnmInboxBase = path.join(repoRoot, 'harvest', 'inbox', SOURCE_CODE);
  let inboxDir = null;
  let runId = null;
  let isResuming = false;
  let startPageNum = 0;
  let fetchedCount = 0;
  let errorCount = 0;
  let startedAt = null;

  if (!options.freshRun) {
    if (options.resumeTarget && options.resumeTarget !== 'auto') {
      if (fs.existsSync(options.resumeTarget)) {
        inboxDir = path.resolve(options.resumeTarget);
      } else if (fs.existsSync(path.join(pnmInboxBase, options.resumeTarget))) {
        inboxDir = path.join(pnmInboxBase, options.resumeTarget);
      } else {
        console.error(`[ERROR] Specified resume directory does not exist: ${options.resumeTarget}`);
        return 1;
      }
      isResuming = true;
    } else if (options.outDir) {
      if (fs.existsSync(options.outDir) && isIncompleteRun(options.outDir)) {
        inboxDir = path.resolve(options.outDir);
        isResuming = true;
      }
    } else if (fs.existsSync(pnmInboxBase)) {
      const candidate = findLatestIncompleteRun(pnmInboxBase);
      if (candidate) {
        inboxDir = candidate;
        isResuming = true;
      }
    }
  }

  const nowIso = new Date().toISOString();
  if (isResuming && inboxDir) {
    runId = path.basename(inboxDir);
    const recordsDir = path.join(inboxDir, 'records');
    fs.mkdirSync(recordsDir, { recursive: true });

    const inspected = inspectBatches(recordsDir);
    startPageNum = inspected.highestPage + 1;
    fetchedCount = inspected.recordCount;

    cleanProvenanceFile(path.join(inboxDir, 'provenance.jsonl'), inspected.validBatches);

    const manifestPath = path.join(inboxDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (prev.started_at) startedAt = prev.started_at;
        if (typeof prev.error_count === 'number') errorCount = prev.error_count;
      } catch {}
    }
    if (!startedAt) startedAt = nowIso;
  } else {
    isResuming = false;
    startedAt = nowIso;
    runId = startedAt.replace(/:/g, '-').replace(/\..+/, '') + 'Z';
    inboxDir = options.outDir
      ? path.resolve(options.outDir)
      : path.join(pnmInboxBase, runId);
    fs.mkdirSync(path.join(inboxDir, 'records'), { recursive: true });
    startPageNum = 0;
    fetchedCount = 0;
  }

  const recordsDir = path.join(inboxDir, 'records');

  console.log(`=== PustakaTerbuka PNM Harvester (Node.js) ===`);
  console.log(`Run ID:      ${runId} ${isResuming ? '[RESUMING]' : '[NEW]'}`);
  console.log(`Inbox:       ${inboxDir}`);
  if (isResuming) {
    console.log(`Resuming:    Starting at page ${startPageNum} (${fetchedCount} records already saved)`);
  }
  console.log(`Query:       ${options.query}`);
  console.log(`Page Size:   ${options.pageSize}`);
  console.log(`Max Pages:   ${options.maxPages > 0 ? options.maxPages : 'Unlimited'}`);
  console.log(`Rate Delay:  ${options.delayMs}ms`);
  console.log(`===============================================`);

  const provFile = path.join(inboxDir, 'provenance.jsonl');
  const provStream = fs.createWriteStream(provFile, { flags: 'a', encoding: 'utf8' });

  let pageNum = startPageNum;
  let pagesFetchedThisRun = 0;
  let totalResults = (startPageNum + 1) * options.pageSize;
  let harvestStatus = 'complete';
  let failureReason = null;

  try {
    if (options.partitioned) {
      console.log(`[MODE] Partitioned harvest mode active (bypasses OpenSearch 10k window limit).`);
      const partitionStateFile = path.join(inboxDir, 'partition_state.json');
      let partitionState = { completedPartitions: [], nextBatchNumber: 0 };
      if (fs.existsSync(partitionStateFile)) {
        try {
          partitionState = JSON.parse(fs.readFileSync(partitionStateFile, 'utf8'));
        } catch {}
      }

      // Inspect existing batch files to continue numbering seamlessly
      const inspected = inspectBatches(recordsDir);
      let batchNumber = Math.max(inspected.highestPage + 1, partitionState.nextBatchNumber || 0);

      const plan = generatePartitionPlan();
      console.log(`[PLAN] Total partitions to process: ${plan.length} (${partitionState.completedPartitions.length} already completed)`);

      for (const partition of plan) {
        if (partitionState.completedPartitions.includes(partition.name)) {
          continue;
        }

        if (options.maxPages > 0 && pagesFetchedThisRun >= options.maxPages) {
          break;
        }

        console.log(`\n[PARTITION] Starting: ${partition.name} (query="${partition.query}", years=${partition.dateFrom || 'any'}-${partition.dateTo || 'any'})...`);
        let partPage = 0;
        let partTotal = options.pageSize;

        while (partPage * options.pageSize < partTotal && partPage < 100) {
          if (options.maxPages > 0 && pagesFetchedThisRun >= options.maxPages) {
            break;
          }

          const extra = {};
          if (partition.dateFrom != null) extra.dateFrom = partition.dateFrom;
          if (partition.dateTo != null) extra.dateTo = partition.dateTo;

          console.log(`[PAGE] Fetching ${partition.name} page ${partPage}...`);
          const result = await fetchPageWithRetry(partition.query, partPage, options.pageSize, extra);

          if (typeof result.totalResults === 'number') {
            partTotal = result.totalResults;
          }

          const items = Array.isArray(result.data) ? result.data : [];
          if (items.length === 0) {
            break;
          }

          const xmlLines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<collection xmlns="http://www.loc.gov/MARC21/slim">'
          ];

          let recordIndexInBatch = 0;
          for (const item of items) {
            const converted = convertItemToMarcRecord(item, (msg) => {
              console.warn(`[WARN] Skipping invalid record: ${msg}`);
              errorCount++;
            });
            if (!converted) continue;

            xmlLines.push(converted.xmlText);

            // Provenance entry
            const prov = {
              source_001: converted.localId,
              source_url: `${SOURCE_BASE_URL}search/resource/${converted.id}`,
              harvested_at: new Date().toISOString(),
              file: `batch_${batchNumber}.xml`,
              index: recordIndexInBatch
            };
            provStream.write(JSON.stringify(prov) + '\n');

            recordIndexInBatch++;
            fetchedCount++;
          }

          xmlLines.push('</collection>');
          const xmlPath = path.join(recordsDir, `batch_${batchNumber}.xml`);
          fs.writeFileSync(xmlPath, xmlLines.join('\n'), { encoding: 'utf8' });
          console.log(`[SAVE] Wrote ${recordIndexInBatch} records to batch_${batchNumber}.xml (Partition: ${partPage + 1}/${Math.ceil(partTotal / options.pageSize)}, Total Run Fetched: ${fetchedCount})`);

          batchNumber++;
          partPage++;
          pagesFetchedThisRun++;

          if (partPage * options.pageSize < partTotal && (options.maxPages <= 0 || pagesFetchedThisRun < options.maxPages)) {
            await sleep(options.delayMs);
          }
        }

        if (partPage >= 100 && partPage * options.pageSize < partTotal) {
          console.warn(`[WARN] Partition ${partition.name} capped at OpenSearch 10,000 ceiling (${partTotal} total records).`);
        }

        partitionState.completedPartitions.push(partition.name);
        partitionState.nextBatchNumber = batchNumber;
        partitionState.totalRecordsSaved = fetchedCount;
        fs.writeFileSync(partitionStateFile, JSON.stringify(partitionState, null, 2), 'utf8');

        // Politeness sleep between partitions
        if (options.maxPages <= 0 || pagesFetchedThisRun < options.maxPages) {
          await sleep(options.delayMs);
        }
      }
    } else {
      // Standard single-query mode
      const extra = {};
      if (options.dateFrom != null) extra.dateFrom = options.dateFrom;
      if (options.dateTo != null) extra.dateTo = options.dateTo;

      while (pageNum * options.pageSize < totalResults) {
        if (options.maxPages > 0 && pagesFetchedThisRun >= options.maxPages) {
          break;
        }

        console.log(`[PAGE] Fetching page ${pageNum} (records ${pageNum * options.pageSize + 1} - ${Math.min((pageNum + 1) * options.pageSize, totalResults)})...`);
        const result = await fetchPageWithRetry(options.query, pageNum, options.pageSize, extra);

        if (typeof result.totalResults === 'number') {
          totalResults = result.totalResults;
        }

        const items = Array.isArray(result.data) ? result.data : [];
        if (items.length === 0) {
          console.log(`[INFO] No records returned for page ${pageNum}. Ending harvest loop.`);
          break;
        }

        const xmlLines = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<collection xmlns="http://www.loc.gov/MARC21/slim">'
        ];

        let recordIndex = 0;
        for (const item of items) {
          const converted = convertItemToMarcRecord(item, (msg) => {
            console.warn(`[WARN] Skipping invalid record: ${msg}`);
            errorCount++;
          });
          if (!converted) continue;

          xmlLines.push(converted.xmlText);

          // Provenance entry
          const prov = {
            source_001: converted.localId,
            source_url: `${SOURCE_BASE_URL}search/resource/${converted.id}`,
            harvested_at: new Date().toISOString(),
            file: `batch_${pageNum}.xml`,
            index: recordIndex
          };
          provStream.write(JSON.stringify(prov) + '\n');

          recordIndex++;
          fetchedCount++;
        }

        xmlLines.push('</collection>');
        const xmlPath = path.join(recordsDir, `batch_${pageNum}.xml`);
        fs.writeFileSync(xmlPath, xmlLines.join('\n'), { encoding: 'utf8' });
        console.log(`[SAVE] Wrote ${recordIndex} records to batch_${pageNum}.xml (Total fetched: ${fetchedCount} / ${totalResults})`);

        pageNum++;
        pagesFetchedThisRun++;

        // Politeness sleep between page requests
        if (pageNum * options.pageSize < totalResults && (options.maxPages <= 0 || pagesFetchedThisRun < options.maxPages)) {
          await sleep(options.delayMs);
        }
      }
    }
  } catch (err) {
    console.error(`[ERROR] Harvest encountered fatal error:`, err);
    harvestStatus = fetchedCount > 0 ? 'partial' : 'failed';
    failureReason = err.message;
  } finally {
    await new Promise(resolve => provStream.end(resolve));

    const finishedAt = new Date().toISOString();
    // terms_verified_on must match JSON schema format "date" (YYYY-MM-DD)
    const termsVerifiedOn = startedAt.slice(0, 10);

    const manifest = {
      schema_version: '1.0',
      source_code: SOURCE_CODE,
      source_name: SOURCE_NAME,
      source_base_url: SOURCE_BASE_URL,
      terms_url: TERMS_URL,
      terms_verified_on: termsVerifiedOn,
      harvester_name: HARVESTER_NAME,
      harvester_version: HARVESTER_VERSION,
      run_id: runId,
      mode: options.mode,
      started_at: startedAt,
      finished_at: finishedAt,
      record_count: fetchedCount,
      error_count: errorCount,
      status: harvestStatus,
      user_agent: USER_AGENT,
      notes: failureReason
        ? `Harvest ended with status '${harvestStatus}': ${failureReason}`
        : (isResuming
            ? `Harvest resumed and completed successfully from PNM Vega Discover REST API.`
            : `Harvest completed successfully from PNM Vega Discover REST API.`)
    };

    const manifestPath = path.join(inboxDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`===============================================`);
    console.log(`Harvest finished: status = ${harvestStatus}, records = ${fetchedCount}, errors = ${errorCount}`);
    console.log(`Manifest written to ${manifestPath}`);
    console.log(`===============================================`);

    if (harvestStatus !== 'complete') {
      console.log(`\n[WARN] Harvest ended with status '${harvestStatus}'. Automated pipeline will not run on incomplete data.`);
      return 1;
    }

    const isInsideRepo = fs.existsSync(path.join(repoRoot, 'package.json'));
    if (isInsideRepo && !options.skipPipeline) {
      console.log(`\n================================================`);
      console.log(` Running PustakaTerbuka Pipeline Automatically `);
      console.log(`================================================`);

      const { execSync } = await import('child_process');
      try {
        console.log(`\n[Step 1/3] Validating inbox...`);
        execSync(`npm run validate-inbox -- "${inboxDir}"`, { cwd: repoRoot, stdio: 'inherit' });

        console.log(`\n[Step 2/3] Merging & deduplicating records into catalog...`);
        execSync(`npm run merge -- "${inboxDir}"`, { cwd: repoRoot, stdio: 'inherit' });

        console.log(`\n[Step 3/3] Building static OPAC and search index...`);
        execSync(`npm run build`, { cwd: repoRoot, stdio: 'inherit' });

        console.log(`\n================================================`);
        console.log(` Pipeline Completed: Catalog Updated & Built! `);
        console.log(`================================================\n`);
      } catch (err) {
        console.error(`\n[ERROR] Pipeline step failed: ${err.message}`);
        return 1;
      }
    }
  }

  return 0;
}

// Execute if run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runHarvest().then(code => process.exit(code || 0));
}
