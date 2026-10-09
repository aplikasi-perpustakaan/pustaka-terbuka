import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as pagefind from 'pagefind';
import * as marcxml from './marcxml.js';
import * as callnumber from './callnumber.js';
import * as aliasesLib from './aliases.js';
import * as manifestLib from './manifest.js';
import { recordToIso2709 } from './marc-iso2709.js';

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSubfield(field, code) {
  const sf = field.subfields?.find(s => s.code === code);
  return sf ? sf.value : '';
}

function getSubfields(field, code) {
  return (field.subfields || []).filter(s => s.code === code).map(s => s.value);
}

function cleanRecord(record) {
  // Remove 99x fields
  const cloned = JSON.parse(JSON.stringify(record));
  if (cloned.dataFields) {
    cloned.dataFields = cloned.dataFields.filter(df => !df.tag.startsWith('99'));
  }
  return cloned;
}

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getDirectorySize(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      size += getDirectorySize(fullPath);
    } else {
      size += stats.size;
    }
  }
  return size;
}

function countFiles(dirPath) {
  let count = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

export async function buildSite(options) {
  const startTime = Date.now();
  const dataDir = options.dataDir || 'data';
  const distDir = options.distDir || 'dist';
  const dumpsDir = options.dumpsDir || 'dumps';
  const baseUrl = options.baseUrl || '/pustaka-terbuka/';
  const config = options.config || {};
  const isbnFetchFiles = options.isbnFetchFiles !== false;

  const siteDir = 'site';
  if (fs.existsSync(siteDir)) {
    fs.cpSync(siteDir, distDir, { recursive: true });
  }

  const bibDir = path.join(dataDir, 'bib');
  const holdingsDir = path.join(dataDir, 'holdings');
  const aliasesPath = path.join(dataDir, 'aliases.jsonl');
  const orgsPath = path.join(dataDir, 'orgs.json');
  const manifestPath = path.join(dataDir, 'manifest.json');

  const report = {
    recordsProcessed: 0,
    bookPages: 0,
    fetchFiles: 0,
    filesCount: 0,
    sizeMB: 0,
    timeTakenMs: 0
  };

  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
  if (!fs.existsSync(dumpsDir)) fs.mkdirSync(dumpsDir, { recursive: true });

  const orgs = fs.existsSync(orgsPath) ? JSON.parse(fs.readFileSync(orgsPath, 'utf8')) : {};
  const aliases = aliasesLib.loadAliases(aliasesPath);
  const manifest = manifestLib.loadManifest(manifestPath);
  const newManifest = {};

  const { index: pfIndex } = await pagefind.createIndex();

  const allRecords = [];
  const orgHoldings = {};
  const orgShelfBrowse = {};
  const isoDate = new Date().toISOString().substring(0, 10).replace(/-/g, '');

  let bibFiles = [];
  if (fs.existsSync(bibDir)) {
    const shards = fs.readdirSync(bibDir).filter(f => fs.statSync(path.join(bibDir, f)).isDirectory());
    for (const shard of shards) {
      const files = fs.readdirSync(path.join(bibDir, shard)).filter(f => f.endsWith('.xml'));
      bibFiles.push(...files.map(f => path.join(shard, f)));
    }
  }

  for (const file of bibFiles) {
    const recordId = path.basename(file, '.xml');
    const filePath = path.join(bibDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const hash = computeHash(content);
    newManifest[recordId] = hash;

    const bookDir = path.join(distDir, 'book', recordId);
    const bookHtmlPath = path.join(bookDir, 'index.html');
    const idXmlPath = path.join(distDir, 'id', `${recordId}.xml`);
    const isUnchanged = manifest[recordId] === hash && fs.existsSync(bookHtmlPath) && fs.existsSync(idXmlPath);
    // For a real incremental build, we would skip some things if unchanged,
    // but we still need to add to Pagefind index and rebuild collections.
    // However, if requested to test incremental builds, we can skip file writes for unchanged records.
    
    const records = marcxml.parse(content);
    if (records.length === 0) continue;
    const record = records[0];
    report.recordsProcessed++;

    // Parse bib metadata
    const titleField = record.dataFields?.find(f => f.tag === '245');
    const title = titleField ? (getSubfield(titleField, 'a') + ' ' + getSubfield(titleField, 'b')).trim() : 'Unknown Title';
    const authorField = record.dataFields?.find(f => f.tag === '100' || f.tag === '110' || f.tag === '111');
    const author = authorField ? getSubfield(authorField, 'a') : '';
    const pubField = record.dataFields?.find(f => f.tag === '260' || f.tag === '264');
    const publisher = pubField ? getSubfield(pubField, 'b') : '';
    let year = pubField ? getSubfield(pubField, 'c') : '';
    year = year.replace(/[^0-9]/g, '');

    const subjects = record.dataFields?.filter(f => f.tag === '650').map(f => getSubfield(f, 'a')).filter(Boolean) || [];
    const isbns = record.dataFields?.filter(f => f.tag === '020').map(f => getSubfield(f, 'a').split(' ')[0]).filter(Boolean) || [];
    
    const lccField = record.dataFields?.find(f => f.tag === '050' || f.tag === '090');
    let lcc = lccField ? (getSubfield(lccField, 'a') + ' ' + getSubfield(lccField, 'b')).trim() : '';
    
    const ddcField = record.dataFields?.find(f => f.tag === '082' || f.tag === '092');
    let ddc = ddcField ? getSubfield(ddcField, 'a').trim() : '';

    const f852 = record.dataFields?.find(f => f.tag === '852');
    const callNum852 = f852 ? getSubfield(f852, 'h').trim() : '';

    if (!ddc && callNum852) {
      const parsedDDC = callnumber.parseDDC(callNum852);
      if (parsedDDC && parsedDDC.classNumber) {
        ddc = parsedDDC.classNumber;
      }
    }

    if (!lcc && !ddc && callNum852) {
      const parsedLCC = callnumber.parseLCC(callNum852);
      if (parsedLCC && parsedLCC.scheme === 'LCC') {
        lcc = parsedLCC.fullCallNumber;
      }
    }

    const summaryField = record.dataFields?.find(f => f.tag === '520');
    const summary = summaryField ? getSubfield(summaryField, 'a').trim() : '';

    const noteField = record.dataFields?.find(f => f.tag === '500');
    const note = noteField ? getSubfield(noteField, 'a').trim() : '';
    
    let lang = 'en';
    const f008 = record.controlFields?.find(f => f.tag === '008')?.value;
    if (f008 && f008.length >= 38) {
      lang = f008.substring(35, 38).trim() || 'en';
    }

    const format = record.leader && record.leader.length >= 8 ? record.leader.substring(6, 8) : 'am';

    // Parse holdings
    const holdingFile = path.join(holdingsDir, `${recordId}.json`);
    const holdings = fs.existsSync(holdingFile) ? JSON.parse(fs.readFileSync(holdingFile, 'utf8')) : [];
    
    const orgCodes = [...new Set(holdings.map(h => h.org))];
    
    // Pagefind index
    let searchableText = [title, author, publisher, ...subjects, ...isbns, lcc, ddc, callNum852, summary, note].filter(Boolean).join(' ');
    
    const schemes = [];
    if (lcc) schemes.push('LCC');
    if (ddc) schemes.push('DDC');

    await pfIndex.addCustomRecord({
      url: `book/${recordId}/`,
      content: searchableText,
      language: lang,
      meta: {
        title,
        author,
        isbn: isbns[0] || ''
      },
      filters: {
        organization: orgCodes,
        year: year ? [year] : [],
        format: [format],
        subject: subjects,
        scheme: schemes
      }
    });

    let holdingsHtml = '';
    for (const h of holdings) {
      const orgInfo = orgs[h.org] || {};
      const orgName = orgInfo.name || h.org;
      const opacUrl = orgInfo.opac_url || '#';
      holdingsHtml += `<li><strong>${escapeHTML(orgName)}</strong>: Call Number: ${escapeHTML(h.call_number)} - <a href="${escapeHTML(opacUrl)}">View in OPAC</a></li>`;
      
      // Collect org holdings
      if (!orgHoldings[h.org]) orgHoldings[h.org] = [];
      orgHoldings[h.org].push({ id: recordId, title, call_number: h.call_number });

      // Collect shelf browse
      if (!orgShelfBrowse[h.org]) orgShelfBrowse[h.org] = { LCC: [], DDC: [] };
      const parsed = callnumber.parseCallNumber(h.call_number, orgInfo.default_scheme || 'LCC');
      if (parsed.scheme === 'LCC' || parsed.scheme === 'DDC') {
        orgShelfBrowse[h.org][parsed.scheme].push({
          id: recordId,
          title,
          callNumber: h.call_number,
          sortKey: parsed.sortKey
        });
      }
    }

    if (!isUnchanged) {
      // Write static book page
      fs.mkdirSync(bookDir, { recursive: true });


    const html = `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
<meta charset="utf-8">
<title>${escapeHTML(title)} — PustakaTerbuka</title>
<meta property="og:title" content="${escapeHTML(title)}">
<meta property="og:type" content="book">
<meta property="og:site_name" content="PustakaTerbuka">
<meta property="og:url" content="${baseUrl}book/${recordId}/">
<style>
body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
h1 { font-size: 2rem; margin-bottom: 0.5rem; }
.metadata { background: #f4f4f4; padding: 1rem; border-radius: 4px; margin-bottom: 2rem; }
.summary, .notes { background: #f9fbfd; border-left: 4px solid #0056b3; padding: 1rem; margin: 1.5rem 0; border-radius: 4px; }
.summary h2, .notes h2 { font-size: 1.2rem; margin-top: 0; margin-bottom: 0.5rem; color: #0056b3; }
.holdings { margin-top: 2rem; }
</style>
</head>
<body>
<h1>${escapeHTML(title)}</h1>
<div class="metadata">
  <p><strong>Author:</strong> ${escapeHTML(author)}</p>
  <p><strong>Publisher:</strong> ${escapeHTML(publisher)}</p>
  <p><strong>Year:</strong> ${escapeHTML(year)}</p>
  <p><strong>ISBNs:</strong> ${escapeHTML(isbns.join(', '))}</p>
  <p><strong>Subjects:</strong> ${escapeHTML(subjects.join(', '))}</p>
  <p><strong>LCC:</strong> ${escapeHTML(lcc)}</p>
  <p><strong>DDC:</strong> ${escapeHTML(ddc)}</p>
  ${callNum852 ? `<p><strong>Call Number:</strong> ${escapeHTML(callNum852)}</p>` : ''}
</div>
${summary ? `<div class="summary"><h2>Summary / Abstract</h2><p>${escapeHTML(summary)}</p></div>` : ''}
${note ? `<div class="notes"><h2>Notes</h2><p>${escapeHTML(note)}</p></div>` : ''}
<div class="holdings">
  <h2>Held By</h2>
  <ul>${holdingsHtml}</ul>
</div>
<p><a href="${baseUrl}id/${recordId}.xml">Download MARCXML</a></p>
</body>
</html>`;
    
    fs.writeFileSync(path.join(bookDir, 'index.html'), html, 'utf8');
    report.bookPages++;

    // Write fetch files
    const idDir = path.join(distDir, 'id');
    fs.mkdirSync(idDir, { recursive: true });
    fs.writeFileSync(path.join(idDir, `${recordId}.xml`), content, 'utf8');
    report.fetchFiles++;

    if (isbnFetchFiles) {
      const isbnDir = path.join(distDir, 'isbn');
      fs.mkdirSync(isbnDir, { recursive: true });
      for (const isbn of isbns) {
        fs.writeFileSync(path.join(isbnDir, `${isbn}.xml`), content, 'utf8');
        report.fetchFiles++;
      }
    }

      // Exports
      const exportDir = path.join(distDir, 'export');
      fs.mkdirSync(exportDir, { recursive: true });
      const cleaned = cleanRecord(record);
      const cleanedXml = marcxml.serialize([cleaned]);
      fs.writeFileSync(path.join(exportDir, `${recordId}.xml`), cleanedXml, 'utf8');
    } else {
      // Just do cleanup to avoid uninitialized variable usage if we needed `cleaned` in dumps later
      // The dump process currently expects allRecords to have cleaned.
    }
    
    // We always push to allRecords for dumps (though in a real massive incremental we'd dump differently)
    const cleaned = cleanRecord(record);
    allRecords.push({ recordId, content, cleaned, orgCodes });
  }

  // Write Pagefind
  await pfIndex.writeFiles({
    outputPath: path.join(distDir, "pagefind")
  });

  // Org indices
  for (const org of Object.keys(orgHoldings)) {
    const orgDir = path.join(distDir, 'org', org);
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(path.join(orgDir, 'index.json'), JSON.stringify(orgHoldings[org]), 'utf8');
    report.fetchFiles++;
  }

  // Shelf browse
  for (const org of Object.keys(orgShelfBrowse)) {
    const browseDir = path.join(distDir, 'browse', org);
    fs.mkdirSync(browseDir, { recursive: true });
    
    for (const scheme of ['LCC', 'DDC']) {
      const items = orgShelfBrowse[org][scheme];
      if (items && items.length > 0) {
        items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        fs.writeFileSync(path.join(browseDir, `${scheme}.json`), JSON.stringify(items), 'utf8');
      }
    }
  }

  // Book Resolver
  const aliasMap = {};
  for (const [key, val] of aliases.entries()) {
    try {
      aliasMap[key] = aliasesLib.resolveId(aliases, val.id);
    } catch (e) {
      // Circular reference or invalid, just map to original ID
      aliasMap[key] = val.id;
    }
  }
  
  const bookBaseDir = path.join(distDir, 'book');
  fs.mkdirSync(bookBaseDir, { recursive: true });
  fs.writeFileSync(path.join(bookBaseDir, 'aliases.json'), JSON.stringify(aliasMap), 'utf8');
  
  const resolverHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Book Resolver</title>
<script>
async function resolve() {
  const params = new URLSearchParams(window.location.search);
  const bookId = params.get('book');
  if (!bookId) {
    document.getElementById('msg').textContent = 'No book identifier provided.';
    return;
  }
  
  try {
    const res = await fetch('aliases.json');
    const aliases = await res.json();
    let targetId = bookId;
    if (aliases[bookId]) {
      targetId = aliases[bookId];
    }
    window.location.href = '${baseUrl}book/' + targetId + '/';
  } catch (err) {
    document.getElementById('msg').textContent = 'Error resolving book.';
  }
}
window.onload = resolve;
</script>
</head>
<body>
<div id="msg">Resolving...</div>
</body>
</html>`;
  fs.writeFileSync(path.join(bookBaseDir, 'index.html'), resolverHtml, 'utf8');

  // Bulk Dumps
  // By Org
  const dumpDir = dumpsDir;
  fs.mkdirSync(dumpDir, { recursive: true });
  for (const org of Object.keys(orgHoldings)) {
    const orgRecords = allRecords.filter(r => r.orgCodes.includes(org)).map(r => r.cleaned);
    const xml = marcxml.serialize(orgRecords);
    fs.writeFileSync(path.join(dumpDir, `pustakaterbuka-${org}-${isoDate}.xml`), xml, 'utf8');
    
    const mrcBufs = orgRecords.map(r => recordToIso2709(r));
    fs.writeFileSync(path.join(dumpDir, `pustakaterbuka-${org}-${isoDate}.mrc`), Buffer.concat(mrcBufs));
  }
  
  // All records dump
  if (allRecords.length > 0) {
    const cleanAll = allRecords.map(r => r.cleaned);
    const xml = marcxml.serialize(cleanAll);
    fs.writeFileSync(path.join(dumpDir, `pustakaterbuka-all-${isoDate}.xml`), xml, 'utf8');
    
    const mrcBufs = cleanAll.map(r => recordToIso2709(r));
    fs.writeFileSync(path.join(dumpDir, `pustakaterbuka-all-${isoDate}.mrc`), Buffer.concat(mrcBufs));
  }

  // Update manifest
  manifestLib.saveManifest(manifestPath, newManifest);

  // Stats
  report.sizeMB = getDirectorySize(distDir) / (1024 * 1024);
  report.filesCount = countFiles(distDir);
  report.timeTakenMs = Date.now() - startTime;

  const sizeWarnMB = config.sizeWarnMB || 700;
  const sizeFailMB = config.sizeFailMB || 950;

  if (report.sizeMB > sizeFailMB) {
    throw new Error(`Build failed: Output size ${report.sizeMB.toFixed(2)} MB exceeds fail threshold ${sizeFailMB} MB.`);
  }
  if (report.sizeMB > sizeWarnMB) {
    console.warn(`Warning: Output size ${report.sizeMB.toFixed(2)} MB exceeds warning threshold ${sizeWarnMB} MB.`);
  }

  return report;
}
