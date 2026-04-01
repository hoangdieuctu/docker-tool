const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const appConfig = require('./config');

const MAX_VERSIONS = 50;

function historyFile() {
  const composePath = appConfig.load().composePath;
  const hash = crypto.createHash('md5').update(composePath).digest('hex').slice(0, 8);
  return path.resolve(__dirname, `../compose-history-${hash}.json`);
}

function load() {
  const file = historyFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function save(versions) {
  fs.writeFileSync(historyFile(), JSON.stringify(versions, null, 2), 'utf8');
}

function snapshot(yaml, label) {
  const versions = load();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  versions.unshift({ id, timestamp: new Date().toISOString(), label, yaml });
  if (versions.length > MAX_VERSIONS) versions.splice(MAX_VERSIONS);
  save(versions);
  return id;
}

function list() {
  return load().map(({ id, timestamp, label }) => ({ id, timestamp, label }));
}

function get(id) {
  const v = load().find(v => v.id === id);
  if (!v) throw new Error(`Version "${id}" not found`);
  return v;
}

function clear() {
  save([]);
}

module.exports = { snapshot, list, get, clear };
