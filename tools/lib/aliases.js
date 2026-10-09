import fs from 'fs';
import path from 'path';

export function loadAliases(filePath) {
  const aliasMap = new Map();
  if (!fs.existsSync(filePath)) return aliasMap;
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      aliasMap.set(entry.key, {
        id: entry.id,
        type: entry.type,
        ts: entry.ts
      });
    } catch (err) {
      console.error(`Invalid JSON in alias file ${filePath}: ${line}`);
    }
  }
  return aliasMap;
}

export function saveAliases(filePath, aliasMap) {
  const entries = [];
  for (const [key, value] of aliasMap.entries()) {
    entries.push({ key, ...value });
  }
  
  // Sort by key for diff-friendliness
  entries.sort((a, b) => a.key.localeCompare(b.key));
  
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Always end with a newline
  const contentToWrite = lines + (lines.length > 0 ? '\n' : '');
  let retries = 5;
  while (retries > 0) {
    try {
      fs.writeFileSync(filePath, contentToWrite, 'utf8');
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      const start = Date.now();
      while (Date.now() - start < 100) {}
    }
  }
}

export function lookupId(aliasMap, key) {
  const entry = aliasMap.get(key);
  if (!entry) return null;
  return resolveId(aliasMap, entry.id);
}

export function addAlias(aliasMap, key, type, id) {
  if (aliasMap.has(key)) {
    const existing = aliasMap.get(key);
    // Don't overwrite if it's identical
    if (existing.id === id && existing.type === type) {
      return;
    }
  }
  aliasMap.set(key, {
    id,
    type,
    ts: new Date().toISOString()
  });
}

export function retireId(aliasMap, oldId, newId) {
  // A retired ID becomes an alias pointing to the new ID
  addAlias(aliasMap, oldId, 'retired', newId);
}

export function resolveId(aliasMap, id) {
  let currentId = id;
  const visited = new Set();
  
  while (true) {
    if (visited.has(currentId)) {
      throw new Error(`Circular reference detected in alias table for ID: ${currentId}`);
    }
    visited.add(currentId);
    
    const entry = aliasMap.get(currentId);
    if (entry && entry.type === 'retired') {
      currentId = entry.id;
    } else {
      break;
    }
  }
  
  return currentId;
}

export function validateAliasTable(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: 'File does not exist' };
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const aliasMap = new Map();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.key || !entry.id || !entry.type || !entry.ts) {
        return { valid: false, error: `Missing fields on line ${i + 1}: ${line}` };
      }
      aliasMap.set(entry.key, entry);
    } catch (err) {
      return { valid: false, error: `Invalid JSON on line ${i + 1}: ${line}` };
    }
  }
  
  // Check for orphan retired IDs
  for (const [key, entry] of aliasMap.entries()) {
    if (entry.type === 'retired') {
      try {
        const resolved = resolveId(aliasMap, key);
        if (resolved === key) {
          return { valid: false, error: `Retired ID ${key} points to nowhere or self` };
        }
      } catch (err) {
        return { valid: false, error: err.message };
      }
    }
  }
  
  return { valid: true };
}
