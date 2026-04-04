const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const compose = require('./compose');
const docker = require('./docker');
const history = require('./history');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'docker-tool-secret';

// Pre-hash the password at startup
const AUTH_PASS_HASH = bcrypt.hashSync(AUTH_PASS, 10);

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

// Serve login page without auth
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Allow static assets needed by the login page
app.use('/style.css',  express.static(path.join(__dirname, '../public/style.css')));
app.use('/favicon.svg', express.static(path.join(__dirname, '../public/favicon.svg')));

// Auth middleware — protects all other routes
function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === AUTH_USER && await bcrypt.compare(password, AUTH_PASS_HASH)) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, '../public')));

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Config ---

app.get('/api/config', (req, res) => {
  res.json(config.load());
});

app.put('/api/config', (req, res) => {
  try {
    const { composePath } = req.body;
    if (!composePath || typeof composePath !== 'string') {
      return res.status(400).json({ error: 'composePath is required' });
    }
    const fs = require('fs');
    if (!fs.existsSync(composePath)) {
      return res.status(400).json({ error: `File not found: ${composePath}` });
    }
    const updated = config.save({ composePath });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Status ---

app.get('/api/status', async (req, res) => {
  try {
    const [services, statuses] = await Promise.all([
      Promise.resolve(compose.getServices()),
      docker.getStatus().catch(() => []),
    ]);

    const statusMap = {};
    for (const s of statuses) {
      statusMap[s.name] = s;
    }

    const merged = services.map(svc => ({
      ...svc,
      container: statusMap[svc.name]?.container || null,
      state: statusMap[svc.name]?.state || 'stopped',
      status: statusMap[svc.name]?.status || 'Not running',
      runningPorts: statusMap[svc.name]?.ports || [],
    }));

    res.json({ services: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Service actions ---

app.post('/api/services/:name/start', async (req, res) => {
  try {
    await docker.startService(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services/:name/stop', async (req, res) => {
  try {
    await docker.stopService(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services/:name/restart', async (req, res) => {
  try {
    await docker.restartService(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/services/:name/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 100;
    const logs = await docker.getLogs(req.params.name, lines);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Global actions ---

app.post('/api/up', async (req, res) => {
  try {
    await docker.upAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/down', async (req, res) => {
  try {
    await docker.downAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Compose file ---

app.get('/api/compose/raw', (req, res) => {
  try {
    const { raw } = compose.read();
    res.json({ yaml: raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/compose/export', (req, res) => {
  try {
    const { raw } = compose.read();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${date}-docker-compose.yml"`);
    res.send(raw);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/compose/raw', (req, res) => {
  try {
    const { yaml: rawYaml } = req.body;
    if (!rawYaml || typeof rawYaml !== 'string') {
      return res.status(400).json({ error: 'yaml field required' });
    }
    compose.write(rawYaml);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/services/:name', (req, res) => {
  try {
    const updated = compose.updateService(req.params.name, req.body);
    res.json({ service: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/services', (req, res) => {
  try {
    const { name, ...config } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    compose.addService(name, config);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/services/:name', (req, res) => {
  try {
    compose.removeService(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Port Check ---

app.get('/api/ports/check', (req, res) => {
  const ports = [].concat(req.query.ports || []).map(Number).filter(Boolean);
  if (!ports.length) return res.json({ inUse: [] });

  const { execFile } = require('child_process');
  // lsof -iTCP:<port> -sTCP:LISTEN -P -n
  const args = ports.flatMap(p => ['-i', `TCP:${p}`]);
  execFile('lsof', ['-sTCP:LISTEN', '-P', '-n', ...args], (err, stdout) => {
    // lsof exits 1 when nothing found — not an error
    const inUse = [];
    for (const port of ports) {
      if (stdout && stdout.includes(`:${port} `)) inUse.push(port);
    }
    res.json({ inUse });
  });
});

// --- Container Name Check ---

app.get('/api/containers/check', (req, res) => {
  const name = req.query.name;
  if (!name) return res.json({ inUse: false });

  const { execFile } = require('child_process');
  execFile('docker', ['ps', '-a', '--format', '{{.Names}}'], (err, stdout) => {
    const names = stdout ? stdout.trim().split('\n').map(n => n.trim()).filter(Boolean) : [];
    const inUse = names.some(n => n === name);
    res.json({ inUse });
  });
});

// --- Volumes ---

app.get('/api/volumes', (req, res) => {
  try { res.json({ volumes: compose.getVolumes() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/volumes', (req, res) => {
  try {
    const { name, driver, external } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const config = {};
    if (driver) config.driver = driver;
    if (external) config.external = true;
    compose.addVolume(name, config);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/volumes/:name', (req, res) => {
  try { compose.removeVolume(req.params.name); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// --- Networks ---

app.get('/api/networks', (req, res) => {
  try { res.json({ networks: compose.getNetworks() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/networks', (req, res) => {
  try {
    const { name, driver, external } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const config = {};
    if (driver) config.driver = driver;
    if (external) config.external = true;
    compose.addNetwork(name, config);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/networks/:name', (req, res) => {
  try { compose.removeNetwork(req.params.name); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// --- Stats ---

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await docker.getStats();
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- History ---

app.get('/api/history', (req, res) => {
  try {
    res.json({ versions: history.list() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/history', (req, res) => {
  try {
    history.clear();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:id', (req, res) => {
  try {
    res.json({ version: history.get(req.params.id) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/history/:id/restore', (req, res) => {
  try {
    const v = history.get(req.params.id);
    const ts = new Date(v.timestamp).toLocaleString();
    compose.write(v.yaml, `Restored from: ${v.label} (${ts})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Docker Tool running at http://localhost:${PORT}`);
});
