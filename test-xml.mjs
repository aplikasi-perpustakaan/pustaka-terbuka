import fs from 'fs';
import { parse } from './tools/lib/marcxml.js';
const xml = fs.readFileSync('tests/fixtures/inbox/bad-xml-source/run-001/records/batch1.xml', 'utf8');
try {
  const res = parse(xml);
  console.log(JSON.stringify(res, null, 2));
} catch(e) {
  console.log('Error:', e.message);
}
