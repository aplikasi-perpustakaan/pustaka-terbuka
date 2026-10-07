import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 100;
  let outdir = './fixtures';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count') count = parseInt(args[++i], 10);
    else if (args[i] === '--outdir') outdir = args[++i];
  }
  return { count, outdir };
}

function generateISBN13() {
  const prefix = "978";
  let core = "";
  for (let i = 0; i < 9; i++) core += Math.floor(Math.random() * 10).toString();
  const base = prefix + core;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + check.toString();
}

const langs = [
  { code: 'eng', titles: ['The Open Sea', 'Digital Horizons', 'Library Science'], authors: ['Smith, John', 'Doe, Jane'] },
  { code: 'may', titles: ['Sejarah Melayu', 'Seni Komputer', 'Panduan Pustaka'], authors: ['Ali, Ahmad', 'Bakar, Siti'] },
  { code: 'chi', titles: ['开源指南', '数字化未来', '图书馆管理'], authors: ['王明', '李华'] },
  { code: 'tam', titles: ['திறந்த கடல்', 'டிஜிட்டல் தொடுவானம்', 'நூலக அறிவியல்'], authors: ['ராஜா', 'கமலா'] },
  { code: 'may-Arab', titles: ['سجاره ملايو', 'ڤندوان ڤوستاک', 'سني کومڤوتر'], authors: ['علي', 'ابو'] } // Jawi
];

const hostileStrings = [
  "Robert'); DROP TABLE records;--",
  "<script>alert('XSS')</script>",
  "../../../etc/passwd",
  "Null\\0Byte",
  "👾 🧑‍💻 👨‍👩‍👧‍👦"
];

function escapeXML(str) {
  return str.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function generateRecord(id, duplicateIsbn = null, useHostile = false) {
  const lang = langs[Math.floor(Math.random() * langs.length)];
  let title = lang.titles[Math.floor(Math.random() * lang.titles.length)];
  let author = lang.authors[Math.floor(Math.random() * lang.authors.length)];
  if (useHostile) {
    title += " " + hostileStrings[Math.floor(Math.random() * hostileStrings.length)];
  }

  const isbn = duplicateIsbn || generateISBN13();
  const lcc = `Z${Math.floor(Math.random() * 1000)} .A${Math.floor(Math.random() * 100)}`;
  const ddc = `020.${Math.floor(Math.random() * 999)}`;

  const holdings = [
    `<datafield tag="852" ind1=" " ind2=" ">
      <subfield code="a">MY-KUL-01</subfield>
      <subfield code="b">Main Library</subfield>
      <subfield code="c">General Collection</subfield>
      <subfield code="h">${lcc}</subfield>
      <subfield code="p">B${Math.floor(Math.random() * 1000000)}</subfield>
    </datafield>`
  ];

  if (Math.random() > 0.5) {
    holdings.push(`
    <datafield tag="852" ind1=" " ind2=" ">
      <subfield code="a">MY-PEN-02</subfield>
      <subfield code="b">Branch</subfield>
      <subfield code="h">${ddc}</subfield>
      <subfield code="p">C${Math.floor(Math.random() * 1000000)}</subfield>
    </datafield>
    `);
  }

  return `
  <record>
    <leader>01142cam a2200301 a 4500</leader>
    <controlfield tag="001">${id}</controlfield>
    <datafield tag="020" ind1=" " ind2=" ">
      <subfield code="a">${isbn}</subfield>
    </datafield>
    <datafield tag="041" ind1="0" ind2=" ">
      <subfield code="a">${lang.code}</subfield>
    </datafield>
    <datafield tag="050" ind1=" " ind2="4">
      <subfield code="a">${escapeXML(lcc)}</subfield>
    </datafield>
    <datafield tag="082" ind1="0" ind2="4">
      <subfield code="a">${escapeXML(ddc)}</subfield>
    </datafield>
    <datafield tag="100" ind1="1" ind2=" ">
      <subfield code="a">${escapeXML(author)}</subfield>
    </datafield>
    <datafield tag="245" ind1="1" ind2="0">
      <subfield code="a">${escapeXML(title)}</subfield>
    </datafield>
    ${holdings.join('')}
  </record>`;
}

async function main() {
  const { count, outdir } = parseArgs();
  
  if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
  fs.mkdirSync(outdir, { recursive: true });
  const recordsDir = path.join(outdir, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });

  const provenance = [];
  const runId = path.basename(outdir);
  const sourceCode = path.basename(path.dirname(outdir)) === 'inbox' ? 'pilot-source' : path.basename(path.dirname(outdir));

  const manifest = {
    schema_version: "1.0",
    source_code: sourceCode,
    source_name: "Pilot Synthetic Source",
    source_base_url: "https://pustaka-terbuka.org/synthetic",
    terms_url: "https://pustaka-terbuka.org/terms",
    terms_verified_on: new Date().toISOString().split('T')[0],
    harvester_name: "gen-fixtures.js",
    harvester_version: "1.0.0",
    run_id: runId,
    mode: "full",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    record_count: count,
    error_count: 0,
    status: "complete",
    user_agent: "PustakaTerbuka/1.0"
  };

  const recordsPerFile = 1000;
  let currentFileCount = 0;
  let fileIndex = 0;
  let xmlBuffer = `<?xml version="1.0" encoding="UTF-8"?><collection xmlns="http://www.loc.gov/MARC21/slim">\n`;

  let lastIsbn = null;

  for (let i = 0; i < count; i++) {
    const isDuplicate = i > 0 && Math.random() < 0.1; // 10% chance of duplicate ISBN
    const useHostile = Math.random() < 0.05; // 5% chance of hostile string
    const id = `REC-${i.toString().padStart(6, '0')}`;
    
    let isbn = isDuplicate ? lastIsbn : generateISBN13();
    lastIsbn = isbn;

    const recordXml = generateRecord(id, isDuplicate ? isbn : null, useHostile);
    xmlBuffer += recordXml + "\n";
    
    const fileName = `batch_${fileIndex}.xml`;

    provenance.push(JSON.stringify({
      source_001: id,
      source_url: `https://pustaka-terbuka.org/synthetic/${id}`,
      harvested_at: new Date().toISOString(),
      file: fileName,
      index: currentFileCount
    }));

    currentFileCount++;
    if (currentFileCount >= recordsPerFile || i === count - 1) {
      xmlBuffer += `</collection>`;
      fs.writeFileSync(path.join(recordsDir, fileName), xmlBuffer);
      fileIndex++;
      currentFileCount = 0;
      xmlBuffer = `<?xml version="1.0" encoding="UTF-8"?><collection xmlns="http://www.loc.gov/MARC21/slim">\n`;
    }
  }

  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outdir, 'provenance.jsonl'), provenance.join('\n') + '\n');
  
  console.log(`Generated ${count} records in ${outdir}`);
}

main().catch(console.error);
