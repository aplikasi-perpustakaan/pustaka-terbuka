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
  const cloned = JSON.parse(JSON.stringify(record));
  if (cloned.dataFields) {
    cloned.dataFields = cloned.dataFields.filter(df => !df.tag.startsWith('99'));
  }
  return cloned;
}

export function enrichWithAttribution(record, recordId) {
  const cloned = JSON.parse(JSON.stringify(record));
  if (!cloned.dataFields) cloned.dataFields = [];

  // 1. Update/Add MARC 040 $d PustakaTerbuka
  const f040 = cloned.dataFields.find(f => f.tag === '040');
  if (f040) {
    if (!f040.subfields) f040.subfields = [];
    const has040d = f040.subfields.some(sf => sf.code === 'd' && sf.value.toLowerCase() === 'pustakaterbuka');
    if (!has040d) {
      f040.subfields.push({ code: 'd', value: 'PustakaTerbuka' });
    }
  } else {
    cloned.dataFields.push({
      tag: '040',
      ind1: ' ',
      ind2: ' ',
      subfields: [
        { code: 'a', value: 'MY-KLP' },
        { code: 'c', value: 'MY-KLP' },
        { code: 'd', value: 'PustakaTerbuka' }
      ]
    });
  }

  // 2. Electronic Location and Access (MARC 856)
  const has856 = cloned.dataFields.some(f => f.tag === '856' && f.subfields?.some(sf => sf.value?.includes('pustaka-terbuka')));
  if (!has856) {
    cloned.dataFields.push({
      tag: '856',
      ind1: '4',
      ind2: '2',
      subfields: [
        { code: 'u', value: 'https://github.com/aplikasi-perpustakaan/pustaka-terbuka' },
        { code: 'y', value: 'PustakaTerbuka' },
        { code: 'z', value: 'Shared open catalog record provided by PustakaTerbuka' }
      ]
    });
  }

  // 3. Custom Local Extension Tag (MARC 900)
  const has900 = cloned.dataFields.some(f => f.tag === '900' && f.subfields?.some(sf => sf.value === 'PustakaTerbuka'));
  if (!has900) {
    cloned.dataFields.push({
      tag: '900',
      ind1: ' ',
      ind2: ' ',
      subfields: [
        { code: 'a', value: 'PustakaTerbuka' },
        { code: 'u', value: 'https://github.com/aplikasi-perpustakaan/pustaka-terbuka' },
        { code: 'd', value: 'Open Shared MARC Catalog for Malaysian Libraries' },
        { code: 'r', value: recordId }
      ]
    });
  }

  // Sort dataFields by tag for canonical order
  cloned.dataFields.sort((a, b) => a.tag.localeCompare(b.tag));
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

function generateStaticBookHtml({ recordId, title, author, publisher, year, primaryIsbn, isbns, callNum852, ddc, lcc, subjects, summary, note, lang, holdingsHtml, baseUrl }) {
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

  return `<!DOCTYPE html>
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

    ${holdingsHtml ? `<section class="card-section"><h2>Held By</h2><ul class="holdings-list">${holdingsHtml}</ul></section>` : ''}

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
}

function generateUniversalViewerHtml(baseUrl) {
  return `<!DOCTYPE html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Katalog Buku / Book Catalog — PustakaTerbuka</title>
<link rel="stylesheet" href="${baseUrl}style.css">
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
  <span id="breadcrumb-title">Buku / Book</span>
</nav>

<main class="book-container">
  <aside class="book-sidebar">
    <div id="cover-container">
      <div class="book-cover-wrapper">
        <div class="cover-placeholder" style="display: flex;">
          <div class="placeholder-title">PustakaTerbuka</div>
        </div>
      </div>
    </div>
    <div class="book-actions-panel">
      <button id="basket-toggle-btn" class="btn-action btn-basket-toggle" onclick="toggleRecordBasket()">+ Add to Basket</button>
      <button class="btn-action btn-cite-trigger" onclick="toggleCiteSection()">❝ Cite Record</button>
      <a id="download-marc-btn" href="#" download="" class="btn-action btn-download-xml">⬇ Download MARCXML</a>
    </div>
  </aside>

  <article class="book-content">
    <div class="book-title-header">
      <h1 id="book-title">Memuatkan rekod... / Loading record...</h1>
      <p id="book-author" class="book-author-lead"></p>
    </div>

    <div id="metadata-container"></div>
    <div id="summary-section"></div>
    <div id="notes-section"></div>
    <div id="holdings-section"></div>

    <div id="citation-section" class="card-section citation-box" style="display: none;">
      <h2>Cite this Record <span id="cite-toast" class="cite-toast">Copied to clipboard!</span></h2>
      <div class="cite-entry">
        <h3>APA 7th <button class="btn-copy-cite" onclick="copyCitation('apa')">Copy APA</button></h3>
        <div id="cite-apa-text" class="cite-text"></div>
      </div>
      <div class="cite-entry" style="margin-top: 1rem;">
        <h3>BibTeX <button class="btn-copy-cite" onclick="copyCitation('bibtex')">Copy BibTeX</button></h3>
        <pre id="cite-bibtex-text" class="cite-text"></pre>
      </div>
    </div>
  </article>
</main>

<script>
(function() {
  const baseUrl = '${baseUrl}';
  const params = new URLSearchParams(window.location.search);
  let recordId = params.get('id');
  const bookAlias = params.get('book');
  const basketKey = 'pustaka-basket';

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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
    if (!btn || !recordId) return;
    if (basket.has(recordId)) {
      btn.textContent = '✓ In Basket (Remove)';
      btn.classList.add('in-basket');
    } else {
      btn.textContent = '+ Add to Basket';
      btn.classList.remove('in-basket');
    }
  }

  window.toggleRecordBasket = function() {
    if (!recordId) return;
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

  async function resolveBookAlias(alias) {
    try {
      const res = await fetch('aliases.json');
      if (res.ok) {
        const aliases = await res.json();
        return aliases[alias] || alias;
      }
    } catch(e) {}
    return alias;
  }

  function renderBook(book) {
    document.title = (book.title || 'Untitled') + ' — PustakaTerbuka';
    const shortTitle = book.title && book.title.length > 55 ? book.title.substring(0, 52) + '...' : (book.title || 'Untitled');
    const bcTitle = document.getElementById('breadcrumb-title');
    if (bcTitle) bcTitle.textContent = shortTitle;

    // Title & Author
    const titleEl = document.getElementById('book-title');
    if (titleEl) titleEl.textContent = book.title || 'Untitled';
    const authorEl = document.getElementById('book-author');
    if (authorEl) {
      if (book.author) {
        authorEl.textContent = book.author;
        authorEl.style.display = 'block';
      } else {
        authorEl.style.display = 'none';
      }
    }

    // Cover
    const primaryIsbn = (book.isbns && book.isbns.length > 0) ? book.isbns[0] : '';
    const coverContainer = document.getElementById('cover-container');
    if (coverContainer) {
      if (primaryIsbn) {
        coverContainer.innerHTML = '<div class="book-cover-wrapper">' +
          '<img src="https://covers.openlibrary.org/b/isbn/' + escapeHTML(primaryIsbn) + '-M.jpg?default=false" ' +
          'alt="Cover for ' + escapeHTML(book.title || '') + '" class="book-cover" loading="lazy" ' +
          'onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'flex\\';" />' +
          '<div class="cover-placeholder" style="display: none;">' +
          '<div class="placeholder-title">' + escapeHTML(book.title || '') + '</div>' +
          '<div class="placeholder-author">' + escapeHTML(book.author || '') + '</div>' +
          '</div></div>';
      } else {
        coverContainer.innerHTML = '<div class="book-cover-wrapper">' +
          '<div class="cover-placeholder" style="display: flex;">' +
          '<div class="placeholder-title">' + escapeHTML(book.title || '') + '</div>' +
          '<div class="placeholder-author">' + escapeHTML(book.author || '') + '</div>' +
          '</div></div>';
      }
    }

    // MARCXML download button
    const dlBtn = document.getElementById('download-marc-btn');
    if (dlBtn) {
      const shard = recordId.substring(0, 2).toLowerCase();
      dlBtn.href = 'https://raw.githubusercontent.com/aplikasi-perpustakaan/pustaka-terbuka/main/data/bib/' + shard + '/' + recordId + '.xml';
      dlBtn.download = recordId + '.xml';
    }

    // Metadata entries
    const metaEntries = [];
    if (book.author) metaEntries.push('<div class="meta-dt">Author</div><div class="meta-dd">' + escapeHTML(book.author) + '</div>');
    if (book.publisher) metaEntries.push('<div class="meta-dt">Publisher</div><div class="meta-dd">' + escapeHTML(book.publisher) + '</div>');
    if (book.year) metaEntries.push('<div class="meta-dt">Year</div><div class="meta-dd">' + escapeHTML(book.year) + '</div>');
    if (book.isbns && book.isbns.length > 0) metaEntries.push('<div class="meta-dt">ISBN</div><div class="meta-dd">' + escapeHTML(book.isbns.join(', ')) + '</div>');
    if (book.call_number) metaEntries.push('<div class="meta-dt">Call Number</div><div class="meta-dd"><span class="badge badge-call">' + escapeHTML(book.call_number) + '</span></div>');
    if (book.ddc) metaEntries.push('<div class="meta-dt">DDC (Dewey)</div><div class="meta-dd"><span class="badge badge-ddc">' + escapeHTML(book.ddc) + '</span></div>');
    if (book.lcc) metaEntries.push('<div class="meta-dt">LCC</div><div class="meta-dd"><span class="badge badge-lcc">' + escapeHTML(book.lcc) + '</span></div>');
    if (book.subjects && book.subjects.length > 0) {
      const subjectBadges = book.subjects.map(s => '<span class="badge badge-subject">' + escapeHTML(s) + '</span>').join(' ');
      metaEntries.push('<div class="meta-dt">Subjects</div><div class="meta-dd">' + subjectBadges + '</div>');
    }
    const metaContainer = document.getElementById('metadata-container');
    if (metaContainer) {
      if (metaEntries.length > 0) {
        metaContainer.innerHTML = '<div class="metadata-grid-card"><div class="meta-grid">' + metaEntries.join('') + '</div></div>';
      } else {
        metaContainer.innerHTML = '';
      }
    }

    // Summary
    const summaryContainer = document.getElementById('summary-section');
    if (summaryContainer) {
      if (book.summary) {
        summaryContainer.innerHTML = '<section class="card-section"><h2>Summary / Abstract</h2><p>' + escapeHTML(book.summary) + '</p></section>';
      } else {
        summaryContainer.innerHTML = '';
      }
    }

    // Notes
    const notesContainer = document.getElementById('notes-section');
    if (notesContainer) {
      if (book.note) {
        notesContainer.innerHTML = '<section class="card-section"><h2>Notes</h2><p>' + escapeHTML(book.note) + '</p></section>';
      } else {
        notesContainer.innerHTML = '';
      }
    }

    // Holdings
    const holdingsContainer = document.getElementById('holdings-section');
    if (holdingsContainer) {
      if (book.holdings && book.holdings.length > 0) {
        let hHtml = '<section class="card-section"><h2>Held By</h2><ul class="holdings-list">';
        for (const h of book.holdings) {
          const orgName = h.org_name || h.name || h.org;
          const callNum = h.call_number || '';
          const opacUrl = h.opac_url || '#';
          hHtml += '<li><div><strong>' + escapeHTML(orgName) + '</strong> &mdash; Call Number: <span class="badge badge-call">' + escapeHTML(callNum) + '</span></div> <a href="' + escapeHTML(opacUrl) + '" target="_blank" rel="noopener" class="opac-link-btn">View in OPAC &rarr;</a></li>';
        }
        hHtml += '</ul></section>';
        holdingsContainer.innerHTML = hHtml;
      } else {
        holdingsContainer.innerHTML = '';
      }
    }

    // Citations
    const apaAuthor = book.author ? escapeHTML(book.author) + '. ' : '';
    const apaYear = book.year ? '(' + escapeHTML(book.year) + '). ' : '(n.d.). ';
    const apaTitle = '<em>' + escapeHTML(book.title || 'Untitled') + '</em>. ';
    const apaPub = book.publisher ? escapeHTML(book.publisher) + '.' : 'Perpustakaan Negara Malaysia.';
    const apaFormatted = apaAuthor + apaYear + apaTitle + apaPub;

    const cleanTitleBib = (book.title || 'Untitled').replace(/[{}]/g, '');
    const cleanAuthorBib = (book.author || 'Perpustakaan Negara Malaysia').replace(/[{}]/g, '');
    const cleanPubBib = (book.publisher || '').replace(/[{}]/g, '');
    const bibtexLines = [
      '@book{pustaka_' + recordId + ',',
      '  title     = {' + cleanTitleBib + '},',
      '  author    = {' + cleanAuthorBib + '},',
      '  year      = {' + (book.year || '') + '},',
      '  publisher = {' + cleanPubBib + '},',
      '  isbn      = {' + primaryIsbn + '},',
      '  url       = {' + window.location.href + '}',
      '}'
    ];
    const bibtexEntry = bibtexLines.join('\\n');

    const apaEl = document.getElementById('cite-apa-text');
    if (apaEl) apaEl.innerHTML = apaFormatted;
    const bibEl = document.getElementById('cite-bibtex-text');
    if (bibEl) bibEl.textContent = bibtexEntry;

    updateBasketUI();
  }

  function renderError(message) {
    document.title = 'Buku Tidak Dijumpai — PustakaTerbuka';
    const titleEl = document.getElementById('book-title');
    if (titleEl) titleEl.textContent = 'Rekod Tidak Dijumpai / Record Not Found';
    const bcTitle = document.getElementById('breadcrumb-title');
    if (bcTitle) bcTitle.textContent = 'Tidak Dijumpai';
    const authorEl = document.getElementById('book-author');
    if (authorEl) authorEl.style.display = 'none';
    const metaContainer = document.getElementById('metadata-container');
    if (metaContainer) {
      metaContainer.innerHTML = '<div class="card-section" style="text-align: center; padding: 2rem;">' +
        '<p style="color: #6c757d; font-size: 1.1rem; margin-bottom: 1.5rem;">' + escapeHTML(message) + '</p>' +
        '<a href="' + baseUrl + '" class="nav-back-btn" style="display: inline-block;">Kembali ke Carian / Back to Search</a>' +
        '</div>';
    }
  }

  async function loadBook() {
    if (!recordId && bookAlias) {
      recordId = await resolveBookAlias(bookAlias);
      if (recordId) {
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('id', recordId);
        newUrl.searchParams.delete('book');
        window.history.replaceState({}, '', newUrl);
      }
    }

    if (!recordId) {
      renderError('Tiada pengecam buku disediakan / No book identifier specified.');
      return;
    }

    recordId = recordId.trim();
    const shard = recordId.substring(0, 2).toLowerCase();

    try {
      const res = await fetch(baseUrl + 'data/shard/' + shard + '.json');
      if (!res.ok) {
        renderError('Gagal memuatkan data katalog untuk shard ' + shard);
        return;
      }
      const shardData = await res.json();
      const book = Array.isArray(shardData) ? shardData.find(b => b.id.toUpperCase() === recordId.toUpperCase()) : null;
      if (!book) {
        renderError('Buku dengan pengecam "' + recordId + '" tidak dijumpai dalam shard ' + shard + '.');
        return;
      }
      renderBook(book);
    } catch(err) {
      renderError('Ralat berlaku semasa memuatkan rekod: ' + err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadBook);
  } else {
    loadBook();
  }
})();
</script>
</body>
</html>`;
}

export async function buildSite(options) {
  const startTime = Date.now();
  const dataDir = options.dataDir || 'data';
  const distDir = options.distDir || 'dist';
  const dumpsDir = options.dumpsDir || 'dumps';
  const baseUrl = options.baseUrl || '/pustaka-terbuka/';
  const config = options.config || {};
  const isbnFetchFiles = options.isbnFetchFiles !== false && options.config?.isbnFetchFiles !== false;
  const issnFetchFiles = options.issnFetchFiles !== false && options.config?.issnFetchFiles !== false;
  const maxStaticHtmlPages = options.maxStaticHtmlPages ?? options.config?.maxStaticHtmlPages ?? 100;
  const maxXmlEndpoints = options.maxXmlEndpoints ?? options.config?.maxXmlEndpoints ?? 100;
  const maxPagefindRecords = options.maxPagefindRecords ?? options.config?.maxPagefindRecords ?? 10000;

  const siteDir = 'site';
  if (fs.existsSync(siteDir)) {
    fs.cpSync(siteDir, distDir, { recursive: true });
  }

  const bibDir = path.join(dataDir, 'bib');
  const holdingsDir = path.join(dataDir, 'holdings');
  const aliasesPath = path.join(dataDir, 'aliases.jsonl');
  const orgsPath = path.join(dataDir, 'orgs.json');
  let manifestPath = path.join(bibDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    manifestPath = path.join(dataDir, 'manifest.json');
  }

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

  const individualHoldingFiles = new Set();
  if (fs.existsSync(holdingsDir)) {
    const hFiles = fs.readdirSync(holdingsDir).filter(f => f.endsWith('.json'));
    for (const hf of hFiles) {
      individualHoldingFiles.add(path.basename(hf, '.json'));
    }
  }

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

  const orgHoldings = {};
  const orgShelfBrowse = {};
  const isoDate = new Date().toISOString().substring(0, 10).replace(/-/g, '');

  // Setup streaming bulk dumps
  const allXmlPath = path.join(dumpsDir, `pustakaterbuka-all-${isoDate}.xml`);
  const allMrcPath = path.join(dumpsDir, `pustakaterbuka-all-${isoDate}.mrc`);
  const allXmlStream = fs.createWriteStream(allXmlPath);
  allXmlStream.write('<?xml version="1.0" encoding="UTF-8"?>\n<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">\n');
  const allMrcStream = fs.createWriteStream(allMrcPath);

  const orgXmlStreams = {};
  const orgMrcStreams = {};

  function writeToOrgStreams(org, xmlChunk, mrcBuffer) {
    if (!orgXmlStreams[org]) {
      const xmlPath = path.join(dumpsDir, `pustakaterbuka-${org}-${isoDate}.xml`);
      const stream = fs.createWriteStream(xmlPath);
      stream.write('<?xml version="1.0" encoding="UTF-8"?>\n<marc:collection xmlns:marc="http://www.loc.gov/MARC21/slim">\n');
      orgXmlStreams[org] = stream;

      const mrcPath = path.join(dumpsDir, `pustakaterbuka-${org}-${isoDate}.mrc`);
      orgMrcStreams[org] = fs.createWriteStream(mrcPath);
    }
    if (xmlChunk) orgXmlStreams[org].write(xmlChunk);
    if (mrcBuffer) orgMrcStreams[org].write(mrcBuffer);
  }

  const shardDataDir = path.join(distDir, 'data', 'shard');
  fs.mkdirSync(shardDataDir, { recursive: true });

  let shards = [];
  if (fs.existsSync(bibDir)) {
    shards = fs.readdirSync(bibDir).filter(f => fs.statSync(path.join(bibDir, f)).isDirectory());
  }

  let staticPagesWritten = 0;
  let pagefindRecordsIndexed = 0;

  for (const shard of shards) {
    const shardDir = path.join(bibDir, shard);
    const files = fs.readdirSync(shardDir).filter(f => f.endsWith('.xml'));
    const shardRecords = [];
    const shardXmlChunks = [];
    const shardMrcBuffers = [];
    const orgShardXmlChunks = {};
    const orgShardMrcBuffers = {};

    for (const file of files) {
      const recordId = path.basename(file, '.xml');
      const filePath = path.join(shardDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      let hash = manifest[recordId];
      if (!hash) {
        hash = computeHash(content);
      }
      newManifest[recordId] = hash;

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
      const isbns = record.dataFields?.filter(f => f.tag === '020').map(f => getSubfield(f, 'a').split(' ')[0].replace(/[^0-9X]/gi, '')).filter(Boolean) || [];
      const issns = record.dataFields?.filter(f => f.tag === '022').map(f => getSubfield(f, 'a').split(' ')[0].replace(/[^0-9X]/gi, '')).filter(Boolean) || [];
      
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
      const holdings = [];
      if (individualHoldingFiles.has(recordId)) {
        const holdingFile = path.join(holdingsDir, `${recordId}.json`);
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
      const primaryIsbn = isbns[0] || '';

      // Format holdings for client & org collections
      const formattedHoldings = [];
      let holdingsHtml = '';
      for (const h of holdings) {
        const orgInfo = orgs[h.org] || {};
        const orgName = orgInfo.name || h.org;
        const control001 = record.controlFields?.find(f => f.tag === '001')?.value;
        const pnmQuery = primaryIsbn || control001 || title;
        const opacUrl = (h.org === 'PNM') ? `https://opac.pnm.gov.my/search?query=${encodeURIComponent(pnmQuery)}` : (orgInfo.opac_url || '#');
        
        formattedHoldings.push({
          org: h.org,
          org_name: orgName,
          call_number: h.call_number,
          location: h.location,
          opac_url: opacUrl
        });

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

      // Add to shard records
      shardRecords.push({
        id: recordId,
        title,
        author,
        publisher,
        year,
        format,
        isbns,
        call_number: callNum852,
        ddc,
        lcc,
        subjects,
        summary,
        note,
        lang,
        holdings: formattedHoldings
      });

      // Pagefind index (limit records indexed to avoid Pagefind fragment file explosion on huge catalogs)
      if (pagefindRecordsIndexed < maxPagefindRecords) {
        const indexedSummary = summary ? summary.substring(0, 150) : '';
        const searchableText = [title, author, publisher, ...subjects, ...isbns, lcc, ddc, callNum852, indexedSummary, note].filter(Boolean).join(' ');
        
        const schemes = [];
        if (lcc) schemes.push('LCC');
        if (ddc) schemes.push('DDC');

        await pfIndex.addCustomRecord({
          url: `book/?id=${recordId}`,
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
        pagefindRecordsIndexed++;
      }

      // Write static pages and XML endpoints if under gate limit
      const bookDir = path.join(distDir, 'book', recordId);
      const bookHtmlPath = path.join(bookDir, 'index.html');
      const idXmlPath = path.join(distDir, 'id', `${recordId}.xml`);
      const isUnchanged = manifest[recordId] === hash && fs.existsSync(bookHtmlPath) && fs.existsSync(idXmlPath);

      if (staticPagesWritten < maxStaticHtmlPages) {
        if (!isUnchanged) {
          fs.mkdirSync(bookDir, { recursive: true });
          const staticHtml = generateStaticBookHtml({
            recordId, title, author, publisher, year, primaryIsbn, isbns,
            callNum852, ddc, lcc, subjects, summary, note, lang,
            holdingsHtml, baseUrl
          });
          fs.writeFileSync(bookHtmlPath, staticHtml, 'utf8');
        }
        report.bookPages++;

        if (staticPagesWritten < maxXmlEndpoints) {
          const enriched = enrichWithAttribution(record, recordId);
          const enrichedXml = marcxml.serialize([enriched]);

          const idDir = path.join(distDir, 'id');
          fs.mkdirSync(idDir, { recursive: true });
          fs.writeFileSync(idXmlPath, enrichedXml, 'utf8');
          report.fetchFiles++;

          if (isbnFetchFiles) {
            const isbnDir = path.join(distDir, 'isbn');
            fs.mkdirSync(isbnDir, { recursive: true });
            for (const isbn of isbns) {
              fs.writeFileSync(path.join(isbnDir, `${isbn}.xml`), enrichedXml, 'utf8');
              report.fetchFiles++;
            }
          }

          if (issnFetchFiles && issns.length > 0) {
            const issnDir = path.join(distDir, 'issn');
            fs.mkdirSync(issnDir, { recursive: true });
            for (const issn of issns) {
              fs.writeFileSync(path.join(issnDir, `${issn}.xml`), enrichedXml, 'utf8');
              report.fetchFiles++;
            }
          }

          const exportDir = path.join(distDir, 'export');
          fs.mkdirSync(exportDir, { recursive: true });
          const cleaned = cleanRecord(enriched);
          const cleanedXml = marcxml.serialize([cleaned]);
          fs.writeFileSync(path.join(exportDir, `${recordId}.xml`), cleanedXml, 'utf8');
        }
        staticPagesWritten++;
      }

      // Buffer cleaned record for dumps
      const has99x = record.dataFields && record.dataFields.some(df => df.tag.startsWith('99'));
      const cleaned = has99x ? cleanRecord(record) : record;

      let singleXml;
      if (has99x) {
        singleXml = marcxml.serializeSingleRecord(cleaned);
      } else {
        const s = content.indexOf('<marc:record>');
        const e = content.lastIndexOf('</marc:record>') + 14;
        singleXml = (s !== -1 && e !== -1) ? content.substring(s, e) : marcxml.serializeSingleRecord(cleaned);
      }

      if (singleXml) shardXmlChunks.push(singleXml);
      shardMrcBuffers.push(recordToIso2709(cleaned));

      for (const org of orgCodes) {
        if (!orgShardXmlChunks[org]) orgShardXmlChunks[org] = [];
        if (!orgShardMrcBuffers[org]) orgShardMrcBuffers[org] = [];
        if (singleXml) orgShardXmlChunks[org].push(singleXml);
        orgShardMrcBuffers[org].push(recordToIso2709(cleaned));
      }
    }

    // Flush dumps for this shard
    if (shardXmlChunks.length > 0) {
      allXmlStream.write(shardXmlChunks.join('\n') + '\n');
    }
    if (shardMrcBuffers.length > 0) {
      allMrcStream.write(Buffer.concat(shardMrcBuffers));
    }
    for (const org of Object.keys(orgShardXmlChunks)) {
      writeToOrgStreams(org, orgShardXmlChunks[org].join('\n') + '\n', Buffer.concat(orgShardMrcBuffers[org]));
    }

    // Write shard JSON
    if (shardRecords.length > 0) {
      fs.writeFileSync(path.join(shardDataDir, `${shard}.json`), JSON.stringify(shardRecords), 'utf8');
    }
  }

  // Finalize dumps
  allXmlStream.write('</marc:collection>\n');
  allXmlStream.end();
  allMrcStream.end();

  for (const org of Object.keys(orgXmlStreams)) {
    orgXmlStreams[org].write('</marc:collection>\n');
    orgXmlStreams[org].end();
    orgMrcStreams[org].end();
  }

  // Write Pagefind files
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

  // Aliases mapping & Universal dynamic viewer
  const aliasMap = {};
  for (const [key, val] of aliases.entries()) {
    try {
      aliasMap[key] = aliasesLib.resolveId(aliases, val.id);
    } catch (e) {
      aliasMap[key] = val.id;
    }
  }
  
  const bookBaseDir = path.join(distDir, 'book');
  fs.mkdirSync(bookBaseDir, { recursive: true });
  fs.writeFileSync(path.join(bookBaseDir, 'aliases.json'), JSON.stringify(aliasMap), 'utf8');
  
  const universalViewerHtml = generateUniversalViewerHtml(baseUrl);
  fs.writeFileSync(path.join(bookBaseDir, 'index.html'), universalViewerHtml, 'utf8');

  // Update manifest
  manifestLib.saveManifest(manifestPath, newManifest);

  // Stats
  report.sizeMB = getDirectorySize(distDir) / (1024 * 1024);
  report.filesCount = countFiles(distDir);
  report.timeTakenMs = Date.now() - startTime;

  const sizeWarnMB = config.sizeWarnMB || 700;
  const sizeFailMB = config.sizeFailMB || 950;
  const fileCountWarn = config.fileCountWarn || 80000;
  const fileCountFail = config.fileCountFail || 100000;

  if (report.sizeMB > sizeFailMB) {
    throw new Error(`Build failed: Output size ${report.sizeMB.toFixed(2)} MB exceeds fail threshold ${sizeFailMB} MB.`);
  }
  if (report.sizeMB > sizeWarnMB) {
    console.warn(`Warning: Output size ${report.sizeMB.toFixed(2)} MB exceeds warning threshold ${sizeWarnMB} MB.`);
  }

  if (report.filesCount > fileCountFail) {
    console.warn(`WARNING: Output file count ${report.filesCount} exceeds failure threshold ${fileCountFail}.`);
  } else if (report.filesCount > fileCountWarn) {
    console.warn(`WARNING: Output file count ${report.filesCount} exceeds GitHub Pages recommended threshold ${fileCountWarn}.`);
  }

  return report;
}
