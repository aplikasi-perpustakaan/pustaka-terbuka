const BASE_URL = window.location.pathname.includes('/pustaka-terbuka') ? '/pustaka-terbuka/' : '/';
let i18n = {};
let currentLang = 'en';
let pagefind = null;
let currentOrg = null;
let orgHoldingsMap = {}; // recordId -> { call_number }
let basket = new Set(); // Set of recordIds

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadI18n(lang) {
  try {
    const res = await fetch(`${BASE_URL}i18n/${lang}.json`);
    if (!res.ok) throw new Error('Network response was not ok');
    i18n = await res.json();
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18n[key]) {
        el.textContent = i18n[key];
      }
    });
    // Update placeholders
    const searchInput = document.querySelector('.pagefind-ui__search-input');
    if (searchInput && i18n['search_placeholder']) {
      searchInput.placeholder = i18n['search_placeholder'];
    }
    
    // Update basket download button
    const btn = document.getElementById('download-basket-btn');
    if (btn && i18n['download_basket']) {
      btn.textContent = i18n['download_basket'];
    }
  } catch (err) {
    console.error('Failed to load i18n', err);
  }
}

function updateLangSelect() {
  const select = document.getElementById('lang-select');
  if (select) {
    select.value = currentLang;
    select.addEventListener('change', (e) => {
      const newLang = e.target.value;
      const url = new URL(window.location);
      url.searchParams.set('lang', newLang);
      window.history.pushState({}, '', url);
      currentLang = newLang;
      document.documentElement.lang = currentLang;
      loadI18n(currentLang);
    });
  }
}

async function loadOrgs() {
  try {
    let orgsData = {};
    try {
      const orgsRes = await fetch(`${BASE_URL}orgs.json`);
      if (orgsRes.ok) orgsData = await orgsRes.json();
    } catch (e) {}

    if (!pagefind) return;
    const filters = await pagefind.filters();
    if (filters && filters.organization) {
      const select = document.getElementById('org-filter');
      
      // Preserve existing "All Organizations" option
      const currentVal = select.value;
      
      // Keep only first option
      while (select.options.length > 1) {
        select.remove(1);
      }
      
      for (const org in filters.organization) {
        const option = document.createElement('option');
        option.value = org;
        const orgName = orgsData[org]?.name ? `${orgsData[org].name} (${org})` : org;
        option.textContent = orgName;
        select.appendChild(option);
      }
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlOrg = urlParams.get('org');
      if (urlOrg && filters.organization[urlOrg]) {
        select.value = urlOrg;
      }
      
      select.addEventListener('change', async (e) => {
        const val = e.target.value;
        const url = new URL(window.location);
        if (val) {
          url.searchParams.set('org', val);
        } else {
          url.searchParams.delete('org');
        }
        window.history.pushState({}, '', url);
        await onOrgChange(val);
      });
      
      if (urlOrg) {
        await onOrgChange(urlOrg);
      }
    }
  } catch (err) {
    console.error('Failed to load orgs', err);
  }
}

async function onOrgChange(org) {
  currentOrg = org;
  orgHoldingsMap = {};
  
  const linksContainer = document.getElementById('shelf-browse-links');
  linksContainer.innerHTML = '';
  
  if (org) {
    try {
      // Fetch org holdings index
      const res = await fetch(`${BASE_URL}org/${org}/index.json`);
      if (res.ok) {
        const data = await res.json();
        for (const item of data) {
          orgHoldingsMap[item.id] = item;
        }
      }
      
      // Add browse links
      const lccLink = document.createElement('a');
      lccLink.href = `${BASE_URL}browse/${org}/LCC.json`;
      lccLink.textContent = `Browse LCC`;
      lccLink.style.marginRight = '10px';
      
      const ddcLink = document.createElement('a');
      ddcLink.href = `${BASE_URL}browse/${org}/DDC.json`;
      ddcLink.textContent = `Browse DDC`;
      
      linksContainer.appendChild(lccLink);
      linksContainer.appendChild(ddcLink);
    } catch (e) {
      console.warn('Could not load org index', e);
    }
  }
  
  // Trigger pagefind search with filter if there's a search term
  const input = document.querySelector('.pagefind-ui__search-input');
  if (input && input.value) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function getRecordIdFromUrl(url) {
  if (!url) return null;
  const idMatch = url.match(/[?&]id=([^&#]+)/);
  if (idMatch) return idMatch[1];
  const match = url.match(/(?:\/|^)book\/([^\/\?\#]+)\/?/);
  return match ? match[1] : null;
}

function toggleBasket(recordId) {
  if (basket.has(recordId)) {
    basket.delete(recordId);
  } else {
    basket.add(recordId);
  }
  saveBasket();
  renderBasket();
  renderResults(); // Update button states in results
}

function saveBasket() {
  localStorage.setItem('pustaka-basket', JSON.stringify(Array.from(basket)));
}

function loadBasket() {
  try {
    const saved = localStorage.getItem('pustaka-basket');
    if (saved) {
      basket = new Set(JSON.parse(saved));
    }
  } catch (e) {}
}

function renderBasket() {
  const ul = document.getElementById('basket-items');
  const emptyMsg = document.getElementById('basket-empty');
  const btn = document.getElementById('download-basket-btn');
  
  ul.innerHTML = '';
  if (basket.size === 0) {
    emptyMsg.style.display = 'block';
    btn.disabled = true;
  } else {
    emptyMsg.style.display = 'none';
    btn.disabled = false;
    
    basket.forEach(id => {
      const li = document.createElement('li');
      li.textContent = id;
      
      const removeBtn = document.createElement('button');
      removeBtn.textContent = i18n['remove_from_basket'] || 'Remove';
      removeBtn.onclick = () => toggleBasket(id);
      
      li.appendChild(removeBtn);
      ul.appendChild(li);
    });
  }
}

async function downloadBasket() {
  if (basket.size === 0) return;
  
  // Fetch each XML
  let xmls = [];
  for (const id of basket) {
    try {
      let res = await fetch(`${BASE_URL}id/${id}.xml`);
      if (!res.ok) {
        const shard = id.substring(0, 2).toLowerCase();
        res = await fetch(`https://raw.githubusercontent.com/aplikasi-perpustakaan/pustaka-terbuka/main/data/bib/${shard}/${id}.xml`);
      }
      if (res.ok) {
        const text = await res.text();
        // Remove XML declaration and collection root if present, or just string together records
        // A simple way is to match <record>...</record>
        const matches = text.match(/<record[^>]*>[\s\S]*?<\/record>/gi);
        if (matches) {
          xmls.push(...matches);
        }
      }
    } catch (e) {
      console.error(`Failed to fetch ${id}`, e);
    }
  }
  
  if (xmls.length > 0) {
    const collection = `<?xml version="1.0" encoding="UTF-8"?>\n<collection xmlns="http://www.loc.gov/MARC21/slim">\n${xmls.join('\n')}\n</collection>`;
    const blob = new Blob([collection], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'basket.xml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

function renderResults() {
  // We need to hook into Pagefind's rendering or mutate the DOM.
  // PagefindUI replaces the content. We can observe mutations to the search results.
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains('pagefind-ui__result')) {
            processResultNode(node);
          } else if (node.nodeType === 1) {
            const results = node.querySelectorAll('.pagefind-ui__result');
            results.forEach(processResultNode);
          }
        });
      }
    });
  });
  
  const resultsContainer = document.querySelector('.pagefind-ui__drawer');
  if (resultsContainer) {
    observer.observe(resultsContainer, { childList: true, subtree: true });
  }
}

function processResultNode(node) {
  if (node.hasAttribute('data-processed')) return;
  node.setAttribute('data-processed', 'true');
  
  // Cleanly hide any broken thumbnails
  node.querySelectorAll('img').forEach(img => {
    img.onerror = () => { img.style.display = 'none'; };
  });
  
  const link = node.querySelector('.pagefind-ui__result-link');
  if (!link) return;
  
  const url = link.href;
  const recordId = getRecordIdFromUrl(url);
  if (!recordId) return;
  
  link.href = `${BASE_URL}book/?id=${recordId}`;
  
  const excerpt = node.querySelector('.pagefind-ui__result-excerpt');
  
  // Add basket button
  const inBasket = basket.has(recordId);
  const btn = document.createElement('button');
  btn.className = 'basket-btn';
  btn.textContent = inBasket ? (i18n['remove_from_basket'] || 'Remove') : (i18n['add_to_basket'] || 'Add to Basket');
  btn.onclick = (e) => {
    e.preventDefault(); // don't navigate
    toggleBasket(recordId);
  };
  
  // Add download button
  const shard = recordId.substring(0, 2).toLowerCase();
  const dlBtn = document.createElement('a');
  dlBtn.href = `https://raw.githubusercontent.com/aplikasi-perpustakaan/pustaka-terbuka/main/data/bib/${shard}/${recordId}.xml`;
  dlBtn.download = `${recordId}.xml`;
  dlBtn.className = 'download-btn';
  dlBtn.textContent = i18n['download_record'] || 'Download MARCXML';
  dlBtn.style.marginLeft = '10px';
  dlBtn.style.display = 'inline-block';
  dlBtn.style.padding = '0.5rem 1rem';
  dlBtn.style.background = '#28a745';
  dlBtn.style.color = '#fff';
  dlBtn.style.textDecoration = 'none';
  dlBtn.style.borderRadius = '4px';
  
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'actions';
  actionsDiv.appendChild(btn);
  actionsDiv.appendChild(dlBtn);
  
  node.appendChild(actionsDiv);
  
  // Show local call number if org is selected
  if (currentOrg && orgHoldingsMap[recordId]) {
    const callNum = orgHoldingsMap[recordId].call_number;
    const holdingsDiv = document.createElement('div');
    holdingsDiv.className = 'holdings-info';
    holdingsDiv.innerHTML = `<strong>${escapeHTML(i18n['held_by'] || 'Held by: ')}${escapeHTML(currentOrg)}</strong><br>
      Call Number: ${escapeHTML(callNum)}
      <div class="availability-note">${escapeHTML(i18n['availability_note'] || 'Please check availability in the organization catalog.')}</div>`;
    
    node.insertBefore(holdingsDiv, actionsDiv);
  }
}

async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  currentLang = urlParams.get('lang') || 'en';
  document.documentElement.lang = currentLang;
  
  updateLangSelect();
  await loadI18n(currentLang);
  
  loadBasket();
  renderBasket();
  
  window.addEventListener('pageshow', () => {
    loadBasket();
    renderBasket();
  });
  window.addEventListener('focus', () => {
    loadBasket();
    renderBasket();
  });
  
  document.getElementById('download-basket-btn').addEventListener('click', downloadBasket);
  
  try {
    // Load Pagefind
    pagefind = await import(`${BASE_URL}pagefind/pagefind.js`);
    await pagefind.init();
    
    // We can't use PagefindUI directly if we want to filter by org from JS and pass it in dynamically unless we do it via search term or create a custom UI.
    // Actually, PagefindUI handles filters if we use the default UI! But we have a custom dropdown for org.
    // Let's implement our own simple search to have full control, or use PagefindUI and hook into it.
    // PagefindUI is an external script, usually loaded via <link> and <script>.
    // Since we don't have PagefindUI script included in index.html, we'll build a custom UI using the pagefind API.
    
    buildCustomSearchUI();
    loadOrgs();
    
  } catch (err) {
    console.error('Pagefind not found or failed to load. Are you running a built site?', err);
    document.getElementById('search-ui').textContent = 'Search index not available.';
  }
}

function buildCustomSearchUI() {
  const container = document.getElementById('search-ui');
  container.innerHTML = `
    <form id="search-form" style="display:flex; gap:10px;">
      <input type="text" id="search-input" placeholder="${escapeHTML(i18n['search_placeholder'] || 'Search...')}" style="flex:1; padding:0.5rem; font-size:1rem;" />
      <button type="submit" id="search-btn">${escapeHTML(i18n['search_button'] || 'Search')}</button>
    </form>
  `;
  
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await performSearch(input.value, resultsContainer, false);
  });
  
  // Also hook into org changes
  const oldOnOrgChange = window.onOrgChange;
  window.onOrgChange = async (org) => {
    if (oldOnOrgChange) await oldOnOrgChange(org);
    await performSearch(input.value, resultsContainer, false);
  };

  // Perform initial search on load so catalog books appear immediately
  performSearch('', resultsContainer, true);
}

async function performSearch(query, resultsContainer, isInitial = false) {
  if (!pagefind) return;
  
  resultsContainer.innerHTML = 'Searching...';
  
  const searchOpts = {};
  if (currentOrg) {
    searchOpts.filters = { organization: [currentOrg] };
  }
  
  const searchTerm = (query && query.trim()) ? query.trim() : (isInitial ? 'a' : '');
  if (!searchTerm) {
    resultsContainer.innerHTML = `<p>${escapeHTML(i18n['no_results'] || 'No results found.')}</p>`;
    return;
  }

  const search = await pagefind.search(searchTerm, searchOpts);
  
  if (!search || !search.results || search.results.length === 0) {
    resultsContainer.innerHTML = `<p>${escapeHTML(i18n['no_results'] || 'No results found.')}</p>`;
    return;
  }
  
  if (isInitial) {
    resultsContainer.innerHTML = `<p style="color:#555; margin-bottom:1rem;">📚 <strong>Catalog Highlights:</strong> Showing recent titles. Use the search bar above to search across all cataloged records.</p>`;
  } else {
    let msg = i18n['results_count'] || '{0} results found.';
    msg = msg.replace('{0}', search.results.length);
    resultsContainer.innerHTML = `<p>${escapeHTML(msg)}</p>`;
  }
  
  const list = document.createElement('div');
  list.className = 'results-list';
  
  // Load first 10 results
  const resultsToLoad = search.results.slice(0, 10);
  for (const res of resultsToLoad) {
    const data = await res.data();
    
    const node = document.createElement('div');
    node.className = 'result-item';
    
    const url = data.url;
    const recordId = getRecordIdFromUrl(url) || 'unknown';
    const bookUrl = (recordId !== 'unknown') ? `${BASE_URL}book/?id=${recordId}` : url;
    
    const isbn = data.meta?.isbn || '';
    let thumbHtml = '';
    if (isbn) {
      thumbHtml = `<div class="result-thumb-wrapper">
        <img src="https://covers.openlibrary.org/b/isbn/${escapeHTML(isbn)}-S.jpg?default=false" 
             alt="Cover" 
             class="result-thumb-img" 
             loading="lazy" 
             onerror="this.parentElement.style.display='none';" />
      </div>`;
    }
    
    let titleHtml = `<h3><a href="${escapeHTML(bookUrl)}">${escapeHTML(data.meta.title || 'Untitled')}</a></h3>`;
    let metaHtml = data.meta.author ? `<p><strong>Author:</strong> ${escapeHTML(data.meta.author)}</p>` : '';
    let excerptHtml = data.excerpt ? `<p>${data.excerpt}</p>` : '';
    
    node.innerHTML = `
      <div class="result-card-inner">
        ${thumbHtml}
        <div class="result-body">
          ${titleHtml}
          ${metaHtml}
          ${excerptHtml}
        </div>
      </div>`;
    
    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';
    
    const inBasket = basket.has(recordId);
    const btn = document.createElement('button');
    btn.className = 'basket-btn';
    btn.textContent = inBasket ? (i18n['remove_from_basket'] || 'Remove') : (i18n['add_to_basket'] || 'Add to Basket');
    btn.onclick = (e) => {
      e.preventDefault();
      toggleBasket(recordId);
      btn.textContent = basket.has(recordId) ? (i18n['remove_from_basket'] || 'Remove') : (i18n['add_to_basket'] || 'Add to Basket');
    };
    
    const dlBtn = document.createElement('a');
    dlBtn.href = `${BASE_URL}id/${recordId}.xml`;
    dlBtn.download = '';
    dlBtn.className = 'download-btn';
    dlBtn.textContent = i18n['download_record'] || 'Download MARCXML';
    dlBtn.style.display = 'inline-block';
    dlBtn.style.padding = '0.5rem 1rem';
    dlBtn.style.background = '#28a745';
    dlBtn.style.color = '#fff';
    dlBtn.style.textDecoration = 'none';
    dlBtn.style.borderRadius = '4px';
    
    actionsDiv.appendChild(btn);
    actionsDiv.appendChild(dlBtn);
    
    if (currentOrg && orgHoldingsMap[recordId]) {
      const callNum = orgHoldingsMap[recordId].call_number;
      const holdingsDiv = document.createElement('div');
      holdingsDiv.className = 'holdings-info';
      holdingsDiv.innerHTML = `<strong>${escapeHTML(i18n['held_by'] || 'Held by: ')}${escapeHTML(currentOrg)}</strong><br>
        Call Number: ${escapeHTML(callNum)}
        <div class="availability-note">${escapeHTML(i18n['availability_note'] || 'Please check availability in the organization catalog.')}</div>`;
      
      node.appendChild(holdingsDiv);
    }
    
    node.appendChild(actionsDiv);
    list.appendChild(node);
  }
  
  resultsContainer.appendChild(list);
}

document.addEventListener('DOMContentLoaded', init);
