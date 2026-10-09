import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as pagefind from 'pagefind';
import * as marcxml from './marcxml.js';
import * as callnumber from './callnumber.js';
import * as aliasesLib from './aliases.js';
import * as manifestLib from './manifest.js';
import * as holdingsLib from './holdings.js';
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
  if (fs.existsSync(orgsPath)) {
    fs.copyFileSync(orgsPath, path.join(distDir, 'orgs.json'));
  }
  const aliases = aliasesLib.loadAliases(aliasesPath);
  const manifest = manifestLib.loadManifest(manifestPath);
  const newManifest = {};

  const allHoldingsMap = holdingsLib.loadAllHoldings(holdingsDir);
  const holdingsByRecord = new Map();
  for (const [orgCode, rows] of allHoldingsMap.entries()) {
    const { resolved } = holdingsLib.resolveHoldingsRecords(rows, aliases);
    for (const row of resolved) {
      if (!holdingsByRecord.has(row.record)) {
        holdingsByRecord.set(row.record, []);
      }
      holdingsByRecord.get(row.record).push({
        org: row.org,
        call_number: row.full_call_number || row.class_number || '',
        location: row.location || 'Main'
      });
    }
  }

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
    const holdings = [];
    if (fs.existsSync(holdingFile)) {
      try { holdings.push(...JSON.parse(fs.readFileSync(holdingFile, 'utf8'))); } catch (e) {}
    }
    if (holdingsByRecord.has(recordId)) {
      holdings.push(...holdingsByRecord.get(recordId));
    }
    if (orgs['PNM'] && (f852 || callNum852)) {
      if (!holdings.some(h => h.org === 'PNM')) {
        holdings.push({
          org: 'PNM',
          call_number: callNum852 || 'General Collection',
          location: getSubfield(f852, 'b') || 'PERPUSTAKAAN NEGARA MALAYSIA'
        });
      }
    }
    
    const orgCodes = [...new Set(holdings.map(h => h.org))];
    
    // Pagefind index
    let searchableText = [title, author, publisher, ...subjects, ...isbns, lcc, ddc, callNum852, summary, note].filter(Boolean).join(' ');
    
    const schemes = [];
    if (lcc) schemes.push('LCC');
    if (ddc) schemes.push('DDC');

    const primaryIsbn = isbns[0] || '';

    await pfIndex.addCustomRecord({
      url: `book/${recordId}/`,
      content: searchableText,
      language: lang,
      meta: {
        title,
        author,
        isbn: primaryIsbn,
        image: primaryIsbn ? `https://covers.openlibrary.org/b/isbn/${primaryIsbn}-M.jpg` : ''
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
      const control001 = record.controlFields?.find(f => f.tag === '001')?.value;
      const pnmQuery = primaryIsbn || control001 || title;
      const opacUrl = (h.org === 'PNM') ? `https://opac.pnm.gov.my/search?query=${encodeURIComponent(pnmQuery)}` : (orgInfo.opac_url || '#');
      holdingsHtml += `<li><div><strong>${escapeHTML(orgName)}</strong> &mdash; Call Number: <span class="badge badge-call">${escapeHTML(h.call_number)}</span></div> <a href="${escapeHTML(opacUrl)}" target="_blank" rel="noopener" class="opac-link-btn">View in OPAC &rarr;</a></li>`;
      
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

      // Build metadata list (only non-empty fields)
      const metaEntries = [];
      if (author) {
        metaEntries.push(`<div class="meta-dt">Author</div><div class="meta-dd">${escapeHTML(author)}</div>`);
      }
      if (publisher) {
        metaEntries.push(`<div class="meta-dt">Publisher</div><div class="meta-dd">${escapeHTML(publisher)}</div>`);
      }
      if (year) {
        metaEntries.push(`<div class="meta-dt">Year</div><div class="meta-dd">${escapeHTML(year)}</div>`);
      }
      if (isbns.length > 0) {
        metaEntries.push(`<div class="meta-dt">ISBN</div><div class="meta-dd">${escapeHTML(isbns.join(', '))}</div>`);
      }
      if (callNum852) {
        metaEntries.push(`<div class="meta-dt">Call Number</div><div class="meta-dd"><span class="badge badge-call">${escapeHTML(callNum852)}</span></div>`);
      }
      if (ddc) {
        metaEntries.push(`<div class="meta-dt">DDC (Dewey)</div><div class="meta-dd"><span class="badge badge-ddc">${escapeHTML(ddc)}</span></div>`);
      }
      if (lcc) {
        metaEntries.push(`<div class="meta-dt">LCC</div><div class="meta-dd"><span class="badge badge-lcc">${escapeHTML(lcc)}</span></div>`);
      }
      if (subjects.length > 0) {
        const subjectBadges = subjects.map(s => `<span class="badge badge-subject">${escapeHTML(s)}</span>`).join(' ');
        metaEntries.push(`<div class="meta-dt">Subjects</div><div class="meta-dd">${subjectBadges}</div>`);
      }

      const metadataHtml = metaEntries.length > 0
        ? `<div class="metadata-grid-card"><div class="meta-grid">\n${metaEntries.join('\n')}\n</div></div>`
        : '';

      const coverHtml = primaryIsbn
        ? `<div class="book-cover-wrapper">
             <img src="https://covers.openlibrary.org/b/isbn/${escapeHTML(primaryIsbn)}-M.jpg?default=false" 
                  alt="Cover for ${escapeHTML(title)}" 
                  class="book-cover" 
                  loading="lazy" 
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
             <div class="cover-placeholder" style="display: none;">
               <div class="placeholder-title">${escapeHTML(title)}</div>
               <div class="placeholder-author">${escapeHTML(author || '')}</div>
             </div>
           </div>`
        : `<div class="book-cover-wrapper">
             <div class="cover-placeholder" style="display: flex;">
               <div class="placeholder-title">${escapeHTML(title)}</div>
               <div class="placeholder-author">${escapeHTML(author || '')}</div>
             </div>
           </div>`;

      const actionsHtml = `
        <div class="book-actions-panel">
          <button id="basket-toggle-btn" class="btn-action btn-basket-toggle" onclick="toggleRecordBasket()">+ Add to Basket</button>
          <button class="btn-action btn-cite-trigger" onclick="toggleCiteSection()">❝ Cite Record</button>
          <a href="${baseUrl}id/${recordId}.xml" download="${recordId}.xml" class="btn-action btn-download-xml">⬇ Download MARCXML</a>
        </div>`;

      // Citations
      const apaAuthor = author ? `${escapeHTML(author)}. ` : '';
      const apaYear = year ? `(${escapeHTML(year)}). ` : '(n.d.). ';
      const apaTitle = `<em>${escapeHTML(title)}</em>. `;
      const apaPub = publisher ? `${escapeHTML(publisher)}.` : 'Perpustakaan Negara Malaysia.';
      const apaFormatted = `${apaAuthor}${apaYear}${apaTitle}${apaPub}`;

      const cleanTitleBib = title.replace(/[{}\\]/g, '');
      const cleanAuthorBib = (author || 'Perpustakaan Negara Malaysia').replace(/[{}\\]/g, '');
      const cleanPubBib = (publisher || '').replace(/[{}\\]/g, '');
      const bibtexEntry = `@book{pustaka_${recordId},
  title     = {${cleanTitleBib}},
  author    = {${cleanAuthorBib}},
  year      = {${year || ''}},
  publisher = {${cleanPubBib}},
  isbn      = {${primaryIsbn}},
  url       = {${baseUrl}book/${recordId}/}
}`;

      const citeCardHtml = `
        <div id="citation-section" class="card-section citation-box" style="display: none;">
          <h2>Cite this Record <span id="cite-toast" class="cite-toast">Copied to clipboard!</span></h2>
          <div class="cite-entry">
            <h3>APA 7th <button class="btn-copy-cite" onclick="copyCitation('apa')">Copy APA</button></h3>
            <div id="cite-apa-text" class="cite-text">${apaFormatted}</div>
          </div>
          <div class="cite-entry" style="margin-top: 1rem;">
            <h3>BibTeX <button class="btn-copy-cite" onclick="copyCitation('bibtex')">Copy BibTeX</button></h3>
            <pre id="cite-bibtex-text" class="cite-text">${escapeHTML(bibtexEntry)}</pre>
          </div>
        </div>`;

      const shortTitle = title.length > 55 ? title.substring(0, 52) + '...' : title;

      const html = `<!DOCTYPE html>
<html lang="${escapeHTML(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(title)} — PustakaTerbuka</title>
<meta property="og:title" content="${escapeHTML(title)}">
<meta property="og:type" content="book">
<meta property="og:site_name" content="PustakaTerbuka">
<meta property="og:url" content="${baseUrl}book/${recordId}/">
${primaryIsbn ? `<meta property="og:image" content="https://covers.openlibrary.org/b/isbn/${escapeHTML(primaryIsbn)}-M.jpg">\n` : ''}<link rel="stylesheet" href="${baseUrl}style.css">
</head>
<body>
<header class="detail-header">
  <div class="header-container">
    <a href="${baseUrl}" class="header-brand">
      <span class="brand-name">PustakaTerbuka</span>
      <span class="brand-tagline">Katalog Induk Terbuka Kebangsaan</span>
    </a>
    <div class="header-nav">
      <a href="${baseUrl}" class="nav-back-btn">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;">
          <path fill-rule="evenodd" d="M15 8a.75.75 0 0 1-.75.75H3.56l4.22 4.22a.75.75 0 1 1-1.06 1.06l-5.5-5.5a.75.75 0 0 1 0-1.06l5.5-5.5a.75.75 0 0 1 1.06 1.06L3.56 7.25h10.69A.75.75 0 0 1 15 8z"/>
        </svg>
        Back to Search / Kembali ke Carian
      </a>
    </div>
  </div>
</header>

<nav class="breadcrumbs" aria-label="Breadcrumb">
  <a href="${baseUrl}">Home</a> &rsaquo;
  <a href="${baseUrl}">Catalog</a> &rsaquo;
  <span>${escapeHTML(shortTitle)}</span>
</nav>

<main class="book-container">
  <aside class="book-sidebar">
    ${coverHtml}
    ${actionsHtml}
  </aside>

  <article class="book-content">
    <div class="book-title-header">
      <h1>${escapeHTML(title)}</h1>
      ${author ? `<p class="book-author-lead">${escapeHTML(author)}</p>` : ''}
    </div>

    ${metadataHtml}

    ${summary ? `<section class="card-section"><h2>Summary / Abstract</h2><p>${escapeHTML(summary)}</p></section>` : ''}
    ${note ? `<section class="card-section"><h2>Notes</h2><p>${escapeHTML(note)}</p></section>` : ''}

    ${holdings.length > 0 ? `<section class="card-section"><h2>Held By</h2><ul class="holdings-list">${holdingsHtml}</ul></section>` : ''}

    ${citeCardHtml}
  </article>
</main>

<script>
(function() {
  const recordId = '${escapeHTML(recordId)}';
  const basketKey = 'pustaka-basket';
  
  function getBasket() {
    try {
      return new Set(JSON.parse(localStorage.getItem(basketKey) || '[]'));
    } catch(e) {
      return new Set();
    }
  }
  
  function updateBasketUI() {
    const basket = getBasket();
    const btn = document.getElementById('basket-toggle-btn');
    if (!btn) return;
    if (basket.has(recordId)) {
      btn.textContent = '✓ In Basket (Remove)';
      btn.classList.add('in-basket');
    } else {
      btn.textContent = '+ Add to Basket';
      btn.classList.remove('in-basket');
    }
  }
  
  window.toggleRecordBasket = function() {
    const basket = getBasket();
    if (basket.has(recordId)) {
      basket.delete(recordId);
    } else {
      basket.add(recordId);
    }
    localStorage.setItem(basketKey, JSON.stringify(Array.from(basket)));
    updateBasketUI();
  };
  
  window.copyCitation = function(format) {
    let text = '';
    if (format === 'apa') {
      const el = document.getElementById('cite-apa-text');
      text = el ? (el.innerText || el.textContent) : '';
    } else if (format === 'bibtex') {
      const el = document.getElementById('cite-bibtex-text');
      text = el ? (el.innerText || el.textContent) : '';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast();
    }
  };

  function showToast() {
    const toast = document.getElementById('cite-toast');
    if (toast) {
      toast.style.display = 'inline-block';
      setTimeout(function() { toast.style.display = 'none'; }, 2000);
    }
  }

  window.toggleCiteSection = function() {
    const section = document.getElementById('citation-section');
    if (section) {
      const isHidden = (section.style.display === 'none' || !section.style.display);
      section.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBasketUI);
  } else {
    updateBasketUI();
  }
})();
</script>
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
