import fs from 'fs';
import path from 'path';

export function loadManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error loading manifest ${filePath}:`, err.message);
    return {};
  }
}

export function saveManifest(filePath, manifest) {
  // Sort keys
  const sortedKeys = Object.keys(manifest).sort();
  const sortedManifest = {};
  for (const key of sortedKeys) {
    sortedManifest[key] = manifest[key];
  }
  
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(sortedManifest, null, 2) + '\n', 'utf8');
}

export function hasChanged(manifest, recordId, hash) {
  return manifest[recordId] !== hash;
}
