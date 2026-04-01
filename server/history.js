const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.resolve(__dirname, '../compose-history.json');
const MAX_VERSIONS = 50;

function load() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(versions) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(versions, null, 2), 'utf8');
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

module.exports = { snapshot, list, get };
