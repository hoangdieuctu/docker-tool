const { execFile } = require('child_process');
const path = require('path');

const COMPOSE_DIR = path.resolve(__dirname, '..');

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('docker', ['compose', ...args], {
      cwd: COMPOSE_DIR,
      timeout: options.timeout || 30000,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

function runDocker(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, {
      timeout: options.timeout || 30000,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function getStatus() {
  const stdout = await run(['ps', '--format', 'json']);
  const lines = stdout.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const obj = JSON.parse(line);
      return {
        name: obj.Service || obj.Name,
        container: obj.Name,
        status: obj.Status,
        state: obj.State,
        ports: obj.Publishers || [],
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function getStats() {
  // Get running containers first
  const statusList = await getStatus().catch(() => []);
  const running = statusList.filter(s => s.state === 'running' && s.container);
  if (!running.length) return [];

  const containerNames = running.map(s => s.container);

  // docker stats --no-stream --format json <container...>
  const stdout = await runDocker([
    'stats', '--no-stream', '--format',
    '{"container":"{{.Container}}","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","mem_perc":"{{.MemPerc}}","net_io":"{{.NetIO}}","block_io":"{{.BlockIO}}"}',
    ...containerNames,
  ]);

  const lines = stdout.trim().split('\n').filter(Boolean);
  const statsMap = {};
  for (const line of lines) {
    try {
      const s = JSON.parse(line);
      // Map by container name; also try to match service name
      statsMap[s.name] = s;
      statsMap[s.container] = s;
    } catch { /* skip malformed lines */ }
  }

  return running.map(svc => {
    const s = statsMap[svc.container] || statsMap[svc.name] || null;
    return {
      service: svc.name,
      container: svc.container,
      cpu: s ? s.cpu : '--',
      mem: s ? s.mem : '--',
      mem_perc: s ? s.mem_perc : '--',
      net_io: s ? s.net_io : '--',
      block_io: s ? s.block_io : '--',
    };
  });
}

async function startService(serviceName) {
  return run(['up', '-d', serviceName]);
}

async function stopService(serviceName) {
  return run(['stop', serviceName]);
}

async function restartService(serviceName) {
  return run(['restart', serviceName]);
}

async function upAll() {
  return run(['up', '-d'], { timeout: 120000 });
}

async function downAll() {
  return run(['down'], { timeout: 60000 });
}

async function getLogs(serviceName, lines = 100) {
  return run(['logs', '--no-color', `--tail=${lines}`, serviceName]);
}

module.exports = { getStatus, getStats, startService, stopService, restartService, upAll, downAll, getLogs };
