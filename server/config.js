const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.resolve(__dirname, '../app-config.json');
const DEFAULTS = {
  composePath: path.resolve(__dirname, '../docker-compose.yml'),
};

function load() {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(updates) {
  const current = load();
  const next = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { load, save };
