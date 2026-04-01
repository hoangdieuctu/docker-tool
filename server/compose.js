const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const history = require('./history');
const config = require('./config');

function getComposePath() {
  return config.load().composePath;
}

function read() {
  const raw = fs.readFileSync(getComposePath(), 'utf8');
  return { parsed: yaml.load(raw), raw };
}

function write(rawYaml, label = 'Manual YAML edit') {
  yaml.load(rawYaml); // validate
  const { raw: previous } = read();
  history.snapshot(previous, label);
  fs.writeFileSync(getComposePath(), rawYaml, 'utf8');
}

function getServices() {
  const { parsed } = read();
  const services = parsed.services || {};
  return Object.entries(services).map(([name, config]) => ({
    name,
    image: config.image || null,
    container_name: config.container_name || null,
    ports: config.ports || [],
    expose: config.expose ? (config.expose).map(String) : [],
    environment: config.environment || [],
    volumes: config.volumes || [],
    networks: config.networks
      ? (Array.isArray(config.networks) ? config.networks : Object.keys(config.networks))
      : [],
    env_file: config.env_file
      ? (Array.isArray(config.env_file) ? config.env_file : [config.env_file])
      : [],
    restart: config.restart || null,
    command: config.command || null,
    depends_on: config.depends_on
      ? (Array.isArray(config.depends_on) ? config.depends_on : Object.keys(config.depends_on))
      : [],
    working_dir: config.working_dir || null,
    platform: config.platform || null,
  }));
}

function updateService(serviceName, updates) {
  const { parsed } = read();
  if (!parsed.services || !parsed.services[serviceName]) {
    throw new Error(`Service "${serviceName}" not found`);
  }

  const allowedFields = ['image', 'container_name', 'ports', 'expose', 'environment', 'env_file', 'volumes', 'networks', 'restart', 'command', 'depends_on', 'working_dir', 'platform'];
  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) {
      throw new Error(`Field "${key}" is not editable`);
    }
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
      delete parsed.services[serviceName][key];
    } else {
      parsed.services[serviceName][key] = value;
    }
  }

  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Edit service: ${serviceName}`);
  return parsed.services[serviceName];
}

function addService(serviceName, config) {
  const { parsed } = read();
  if (parsed.services && parsed.services[serviceName]) {
    throw new Error(`Service "${serviceName}" already exists`);
  }
  const existing = parsed.services || {};
  parsed.services = { [serviceName]: config, ...existing };
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Add service: ${serviceName}`);
}

function removeService(serviceName) {
  const { parsed } = read();
  if (!parsed.services || !parsed.services[serviceName]) {
    throw new Error(`Service "${serviceName}" not found`);
  }
  delete parsed.services[serviceName];
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Delete service: ${serviceName}`);
}

// ── Top-level Volumes ─────────────────────────────────────────

function getVolumes() {
  const { parsed } = read();
  const vols = parsed.volumes || {};
  return Object.entries(vols).map(([name, config]) => ({
    name,
    driver: config?.driver || null,
    external: config?.external || false,
  }));
}

function addVolume(name, config = {}) {
  const { parsed } = read();
  parsed.volumes = parsed.volumes || {};
  if (parsed.volumes[name] !== undefined) {
    throw new Error(`Volume "${name}" already exists`);
  }
  parsed.volumes[name] = Object.keys(config).length ? config : null;
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Add volume: ${name}`);
}

function removeVolume(name) {
  const { parsed } = read();
  if (!parsed.volumes || !(name in parsed.volumes)) {
    throw new Error(`Volume "${name}" not found`);
  }
  const services = parsed.services || {};
  const inUse = Object.keys(services).filter(svc =>
    (services[svc].volumes || []).some(v => {
      const str = typeof v === 'string' ? v : String(v);
      return str.split(':')[0] === name;
    })
  );
  if (inUse.length) {
    throw new Error(`Volume "${name}" is used by service${inUse.length > 1 ? 's' : ''}: ${inUse.join(', ')}`);
  }
  delete parsed.volumes[name];
  if (!Object.keys(parsed.volumes).length) delete parsed.volumes;
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Delete volume: ${name}`);
}

// ── Top-level Networks ────────────────────────────────────────

function getNetworks() {
  const { parsed } = read();
  const nets = parsed.networks || {};
  return Object.entries(nets).map(([name, config]) => ({
    name,
    driver: config?.driver || null,
    external: config?.external || false,
  }));
}

function addNetwork(name, config = {}) {
  const { parsed } = read();
  parsed.networks = parsed.networks || {};
  if (parsed.networks[name] !== undefined) {
    throw new Error(`Network "${name}" already exists`);
  }
  parsed.networks[name] = Object.keys(config).length ? config : null;
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Add network: ${name}`);
}

function removeNetwork(name) {
  const { parsed } = read();
  if (!parsed.networks || !(name in parsed.networks)) {
    throw new Error(`Network "${name}" not found`);
  }
  const services = parsed.services || {};
  const inUse = Object.keys(services).filter(svc => {
    const nets = services[svc].networks;
    if (!nets) return false;
    const list = Array.isArray(nets) ? nets : Object.keys(nets);
    return list.includes(name);
  });
  if (inUse.length) {
    throw new Error(`Network "${name}" is used by service${inUse.length > 1 ? 's' : ''}: ${inUse.join(', ')}`);
  }
  delete parsed.networks[name];
  if (!Object.keys(parsed.networks).length) delete parsed.networks;
  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"' });
  write(newYaml, `Delete network: ${name}`);
}

module.exports = {
  read, write,
  getServices, updateService, addService, removeService,
  getVolumes, addVolume, removeVolume,
  getNetworks, addNetwork, removeNetwork,
};
