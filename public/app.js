/* ============================================================
   DOCKER TOOL — app.js
   State management, API calls, DOM rendering, event handling
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const state = {
  services: [],          // Array of service objects from /api/status
  stats: {},             // { [serviceName]: { cpu, mem, mem_perc, net_io, block_io } }
  statsLoading: false,
  loading: true,         // Initial page load
  view: 'cards',         // 'cards' | 'yaml'
  search: '',            // Search filter string
  actionLoading: {},     // { "serviceName:action": true }
  logsModal: {
    open: false,
    serviceName: null,
    logs: '',
    loading: false,
  },
  editModal: {
    open: false,
    serviceName: null,
    loading: false,
  },
  addModal: {
    open: false,
    loading: false,
  },
  globalLoading: {
    up: false,
    down: false,
    refresh: false,
    yaml: false,
    saveYaml: false,
  },
};

// ── API Helpers ──────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

const api = {
  status:         ()         => apiFetch('/api/status'),
  start:          (name)     => apiFetch(`/api/services/${encodeURIComponent(name)}/start`, { method: 'POST' }),
  stop:           (name)     => apiFetch(`/api/services/${encodeURIComponent(name)}/stop`,  { method: 'POST' }),
  restart:        (name)     => apiFetch(`/api/services/${encodeURIComponent(name)}/restart`, { method: 'POST' }),
  logs:           (name, n)  => apiFetch(`/api/services/${encodeURIComponent(name)}/logs?lines=${n || 200}`),
  upAll:          ()         => apiFetch('/api/up',   { method: 'POST' }),
  downAll:        ()         => apiFetch('/api/down', { method: 'POST' }),
  getRawYaml:     ()         => apiFetch('/api/compose/raw'),
  putRawYaml:     (yaml)     => apiFetch('/api/compose/raw', { method: 'PUT', body: JSON.stringify({ yaml }) }),
  patchService:   (name, b)  => apiFetch(`/api/services/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(b) }),
  addService:     (body)     => apiFetch('/api/services', { method: 'POST', body: JSON.stringify(body) }),
  deleteService:  (name)     => apiFetch(`/api/services/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};

// ── Confirm Dialog ────────────────────────────────────────────
function showConfirm({ title, message, confirmLabel = 'CONFIRM', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-icon').textContent = danger ? '⚠' : 'ℹ';

    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = confirmLabel;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-success'}`;

    overlay.classList.remove('hidden');

    function finish(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const cancelBtn = document.getElementById('confirm-cancel');

    okBtn.addEventListener('click', onOk, { once: true });
    cancelBtn.addEventListener('click', onCancel, { once: true });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); }, { once: true });
  });
}

// ── Toast Notifications ──────────────────────────────────────
function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : '✕';
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  container.appendChild(el);

  const dismiss = () => {
    el.classList.add('toast-dismissing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  setTimeout(dismiss, 4000);
}

// ── Utility ──────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setActionLoading(serviceKey, actionKey, loading) {
  const key = `${serviceKey}:${actionKey}`;
  if (loading) {
    state.actionLoading[key] = true;
  } else {
    delete state.actionLoading[key];
  }
}

function isActionLoading(serviceKey, actionKey) {
  return !!state.actionLoading[`${serviceKey}:${actionKey}`];
}

function hasAnyActionLoading(serviceKey) {
  return Object.keys(state.actionLoading).some(k => k.startsWith(`${serviceKey}:`));
}

function spinnerHtml(extraClass = '') {
  return `<span class="spinner ${extraClass}"></span>`;
}

function stateClass(stateVal) {
  if (!stateVal || stateVal === 'stopped') return 'stopped';
  return stateVal; // running | exited | restarting
}

function formatPorts(ports) {
  if (!ports || ports.length === 0) return [];
  return ports.map(p => {
    if (typeof p === 'string') return p;
    if (typeof p === 'object') {
      if (p.published && p.target) return `${p.published}:${p.target}`;
      if (p.target) return String(p.target);
    }
    return String(p);
  });
}

function normalizeState(svc) {
  return stateClass(svc.state);
}

// ── Header Counters ──────────────────────────────────────────
function updateHeaderMeta() {
  const total = state.services.length;
  const running = state.services.filter(s => s.state === 'running').length;
  document.getElementById('service-count').textContent =
    `${total} service${total !== 1 ? 's' : ''}`;
  document.getElementById('running-count').textContent =
    `${running} / ${total} running`;
}

// ── Card Rendering ────────────────────────────────────────────
function renderCardBtn(serviceName, action, label, extraClass, disabled) {
  const loading = isActionLoading(serviceName, action);
  const isDisabled = disabled || loading;
  return `
    <button
      class="card-btn card-btn-${action} ${extraClass}"
      data-service="${escapeHtml(serviceName)}"
      data-action="${action}"
      ${isDisabled ? 'disabled' : ''}
      title="${label}"
    >
      ${loading ? spinnerHtml('spinner-sm') : label}
    </button>
  `;
}

function renderCard(svc) {
  const ns = normalizeState(svc);
  const anyLoading = hasAnyActionLoading(svc.name);
  const ports = formatPorts(svc.ports || []);
  const expose = (svc.expose || []).map(String);

  const badgeClass = `state-badge state-badge-${ns}`;
  const dotClass   = `status-dot status-dot-${ns}`;
  const badgeLabel = ns.toUpperCase();

  const isRunning  = ns === 'running';
  const isStopped  = ns === 'stopped' || ns === 'exited';

  let portsHtml;
  if (ports.length > 0) {
    portsHtml = ports.map(p => `<span class="port-tag">${escapeHtml(p)}</span>`).join('');
  } else if (expose.length > 0) {
    portsHtml = expose.map(p => `<span class="port-tag port-tag-expose">${escapeHtml(p)}</span>`).join('');
  } else {
    portsHtml = `<span class="card-no-ports">no ports exposed</span>`;
  }

  const statusText = svc.status || (isRunning ? 'Running' : 'Not running');

  return `
    <div class="card${anyLoading ? ' active-action' : ''}" data-service="${escapeHtml(svc.name)}">
      <div class="card-header">
        <div class="card-name-row">
          <span class="${dotClass}"></span>
          <span class="card-name">${escapeHtml(svc.name)}</span>
        </div>
        <span class="${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="card-body">
        <div class="card-meta-row">
          <span class="card-meta-icon" title="Image">&#9632;</span>
          <div class="card-meta-content">
            <span class="card-image">${escapeHtml(svc.image || '—')}</span>
          </div>
        </div>
        <div class="card-meta-row">
          <span class="card-meta-icon" title="Ports">&#9632;</span>
          <div class="card-meta-content">
            <div class="card-ports">${portsHtml}</div>
          </div>
        </div>
        <div class="card-divider"></div>
        <div class="card-status-text">${escapeHtml(statusText)}</div>
        ${renderStatsSection(svc.name, isRunning)}
      </div>
      <div class="card-footer">
        ${renderCardBtn(svc.name, 'start',   'START',   'card-btn-start',   isRunning)}
        ${renderCardBtn(svc.name, 'stop',    'STOP',    'card-btn-stop',    isStopped)}
        ${renderCardBtn(svc.name, 'restart', 'RESTART', 'card-btn-restart', false)}
        ${renderCardBtn(svc.name, 'logs',    'LOGS',    'card-btn-logs',    false)}
        ${renderCardBtn(svc.name, 'copy',    'COPY',    'card-btn-copy',    false)}
        ${renderCardBtn(svc.name, 'edit',    'EDIT',    'card-btn-edit',    isRunning)}
      </div>
    </div>
  `;
}

function renderStatsSection(serviceName, isRunning) {
  if (!isRunning) return '';
  const s = state.stats[serviceName];
  if (state.statsLoading && !s) {
    return `<div class="card-stats card-stats-loading">fetching stats...</div>`;
  }
  if (!s) {
    return `<div class="card-stats card-stats-empty">stats unavailable</div>`;
  }
  return `
    <div class="card-stats">
      <div class="stat-row">
        <span class="stat-label">CPU</span>
        <span class="stat-value">${escapeHtml(s.cpu)}</span>
        <span class="stat-label">MEM</span>
        <span class="stat-value">${escapeHtml(s.mem_perc)}</span>
      </div>
    </div>
  `;
}

async function fetchStats() {
  state.statsLoading = true;
  renderCards();
  try {
    const data = await apiFetch('/api/stats');
    state.stats = {};
    for (const s of (data.stats || [])) {
      state.stats[s.service] = s;
    }
  } catch (err) {
    toast(`Stats error: ${err.message}`, 'error');
  } finally {
    state.statsLoading = false;
    renderCards();
  }
}

function renderCards() {
  const grid = document.getElementById('cards-grid');

  if (state.loading) {
    grid.innerHTML = `
      <div class="card skeleton"></div>
      <div class="card skeleton"></div>
      <div class="card skeleton"></div>
      <div class="card skeleton"></div>
    `;
    document.getElementById('running-count').textContent = 'loading...';
    return;
  }

  if (state.services.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:40px 0;text-align:center;color:var(--text-dim);font-size:0.8rem;letter-spacing:0.1em;">
        NO SERVICES DEFINED — ADD ONE TO GET STARTED
      </div>
    `;
    updateHeaderMeta();
    return;
  }

  const q = state.search.toLowerCase();
  const filtered = q
    ? state.services.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.image || '').toLowerCase().includes(q)
      )
    : state.services;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:40px 0;text-align:center;color:var(--text-dim);font-size:0.8rem;letter-spacing:0.1em;">
        NO SERVICES MATCH "${escapeHtml(state.search.toUpperCase())}"
      </div>
    `;
    updateHeaderMeta();
    return;
  }

  grid.innerHTML = filtered.map(renderCard).join('');
  updateHeaderMeta();
}

// ── Fetch Status ─────────────────────────────────────────────
async function fetchStatus(silent = false) {
  if (!silent) {
    state.loading = true;
    renderCards();
  }
  try {
    const data = await api.status();
    state.services = data.services || [];
  } catch (err) {
    toast(`Failed to fetch status: ${err.message}`, 'error');
    state.services = state.services || [];
  } finally {
    state.loading = false;
    renderCards();
  }
}

// ── Card Action Handlers ──────────────────────────────────────
async function handleCardAction(serviceName, action) {
  const key = `${serviceName}:${action}`;
  if (state.actionLoading[key]) return;

  if (action === 'logs') {
    openLogsModal(serviceName);
    return;
  }
  if (action === 'edit') {
    openEditModal(serviceName);
    return;
  }
  if (action === 'copy') {
    openCopyModal(serviceName);
    return;
  }

  if (action === 'stop' || action === 'restart') {
    const confirmed = await showConfirm({
      title: `${action.toUpperCase()} "${serviceName}"`,
      message: action === 'stop'
        ? `Stop the "${serviceName}" container?`
        : `Restart the "${serviceName}" container?`,
      confirmLabel: action.toUpperCase(),
      danger: action === 'stop',
    });
    if (!confirmed) return;
  }

  setActionLoading(serviceName, action, true);
  renderCards();

  try {
    const apiCall = { start: api.start, stop: api.stop, restart: api.restart }[action];
    if (!apiCall) return;
    await apiCall(serviceName);
    toast(`${serviceName}: ${action} succeeded`, 'success');
    await fetchStatus(true);
  } catch (err) {
    toast(`${serviceName} ${action} failed: ${err.message}`, 'error');
  } finally {
    setActionLoading(serviceName, action, false);
    renderCards();
  }
}

// ── Delegate Card Click ───────────────────────────────────────
document.getElementById('cards-grid').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  handleCardAction(btn.dataset.service, btn.dataset.action);
});

// ── Header Buttons ────────────────────────────────────────────
function setGlobalBtn(id, loading) {
  const btn = document.getElementById(id);
  const label = btn.querySelector('.btn-label');
  if (loading) {
    btn.disabled = true;
    label.innerHTML = spinnerHtml();
  } else {
    btn.disabled = false;
    label.textContent = btn.dataset.label || label.dataset.original || label.textContent;
  }
}

// Store original labels
document.querySelectorAll('.btn .btn-label').forEach(el => {
  el.dataset.original = el.textContent.trim();
});

async function handleUpAll() {
  if (state.globalLoading.up) return;
  state.globalLoading.up = true;
  const btn = document.getElementById('btn-up-all');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.upAll();
    toast('docker compose up -d succeeded', 'success');
    await fetchStatus(true);
  } catch (err) {
    toast(`Up all failed: ${err.message}`, 'error');
  } finally {
    state.globalLoading.up = false;
    btn.disabled = false;
    label.textContent = 'UP ALL';
  }
}

async function handleDownAll() {
  if (state.globalLoading.down) return;
  const confirmed = await showConfirm({
    title: 'STOP ALL SERVICES',
    message: 'This will run "docker compose down" and stop and remove all containers. Are you sure?',
    confirmLabel: 'DOWN ALL',
    danger: true,
  });
  if (!confirmed) return;
  state.globalLoading.down = true;
  const btn = document.getElementById('btn-down-all');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.downAll();
    toast('docker compose down succeeded', 'success');
    await fetchStatus(true);
  } catch (err) {
    toast(`Down all failed: ${err.message}`, 'error');
  } finally {
    state.globalLoading.down = false;
    btn.disabled = false;
    label.textContent = 'DOWN ALL';
  }
}

async function handleRefresh() {
  if (state.globalLoading.refresh) return;
  state.globalLoading.refresh = true;
  const btn = document.getElementById('btn-refresh');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await fetchStatus(true);
    toast('Status refreshed', 'success');
  } finally {
    state.globalLoading.refresh = false;
    btn.disabled = false;
    label.textContent = 'REFRESH';
  }
}

async function handleRawYaml() {
  if (state.view === 'yaml') {
    switchView('cards');
    return;
  }
  const btn = document.getElementById('btn-raw-yaml');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    const data = await api.getRawYaml();
    document.getElementById('yaml-editor').value = data.yaml || '';
    switchView('yaml');
  } catch (err) {
    toast(`Failed to load YAML: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'RAW YAML';
  }
}

document.getElementById('btn-up-all').addEventListener('click', handleUpAll);
document.getElementById('btn-down-all').addEventListener('click', handleDownAll);
document.getElementById('btn-refresh').addEventListener('click', handleRefresh);
document.getElementById('btn-raw-yaml').addEventListener('click', handleRawYaml);

// ── View Switching ────────────────────────────────────────────
function switchView(view) {
  state.view = view;
  const cardsView = document.getElementById('cards-view');
  const yamlView  = document.getElementById('yaml-view');
  const rawBtn    = document.getElementById('btn-raw-yaml');

  if (view === 'yaml') {
    cardsView.classList.add('hidden');
    yamlView.classList.remove('hidden');
    rawBtn.classList.add('btn-amber');
    rawBtn.querySelector('.btn-label').textContent = 'CLOSE YAML';
  } else {
    yamlView.classList.add('hidden');
    cardsView.classList.remove('hidden');
    rawBtn.classList.remove('btn-amber');
    rawBtn.querySelector('.btn-label').textContent = 'RAW YAML';
  }
}

// ── YAML Save ─────────────────────────────────────────────────
document.getElementById('btn-save-yaml').addEventListener('click', async () => {
  const btn   = document.getElementById('btn-save-yaml');
  const label = btn.querySelector('.btn-label');
  const yaml  = document.getElementById('yaml-editor').value;
  if (!yaml.trim()) {
    toast('YAML content cannot be empty', 'error');
    return;
  }
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.putRawYaml(yaml);
    toast('compose.yml saved', 'success');
    switchView('cards');
    await fetchStatus(true);
  } catch (err) {
    toast(`Failed to save YAML: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'SAVE YAML';
  }
});

document.getElementById('btn-cancel-yaml').addEventListener('click', () => {
  switchView('cards');
});

// ── Logs Modal ────────────────────────────────────────────────
async function openLogsModal(serviceName) {
  state.logsModal.open       = true;
  state.logsModal.serviceName = serviceName;
  state.logsModal.logs        = '';

  document.getElementById('logs-service-name').textContent = serviceName;
  document.getElementById('logs-output').innerHTML = `<span class="logs-placeholder">Loading logs...</span>`;
  document.getElementById('logs-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  await loadLogs(serviceName);
}

async function loadLogs(serviceName) {
  const output = document.getElementById('logs-output');
  const refreshBtn = document.getElementById('btn-refresh-logs');
  refreshBtn.disabled = true;
  refreshBtn.querySelector('.btn-label').innerHTML = spinnerHtml('spinner-sm');

  try {
    const data = await api.logs(serviceName, 200);
    const logs = data.logs || '(no logs)';
    output.textContent = logs;
    output.scrollTop = output.scrollHeight;
  } catch (err) {
    output.innerHTML = `<span style="color:var(--red)">Failed to load logs: ${escapeHtml(err.message)}</span>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.querySelector('.btn-label').textContent = 'REFRESH LOGS';
  }
}

function closeLogsModal() {
  document.getElementById('logs-modal').classList.add('hidden');
  document.body.style.overflow = '';
  state.logsModal.open = false;
  state.logsModal.serviceName = null;
}

document.getElementById('logs-close').addEventListener('click', closeLogsModal);
document.getElementById('btn-refresh-logs').addEventListener('click', () => {
  if (state.logsModal.serviceName) loadLogs(state.logsModal.serviceName);
});
document.getElementById('logs-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLogsModal();
});

// ── Edit Modal ────────────────────────────────────────────────
async function openEditModal(serviceName) {
  const svc = state.services.find(s => s.name === serviceName);
  if (!svc) return;

  await refreshKnownNetworks();

  state.editModal.open        = true;
  state.editModal.serviceName = serviceName;

  document.getElementById('edit-service-name').textContent = serviceName;
  document.getElementById('edit-image').value          = svc.image   || '';
  document.getElementById('edit-platform').value       = svc.platform || '';
  // If value not in select options, add it
  const editPlatformEl = document.getElementById('edit-platform');
  if (svc.platform && !Array.from(editPlatformEl.options).some(o => o.value === svc.platform)) {
    const opt = document.createElement('option');
    opt.value = svc.platform;
    opt.textContent = svc.platform;
    editPlatformEl.appendChild(opt);
  }
  editPlatformEl.value = svc.platform || '';
  document.getElementById('edit-container-name').value = svc.container_name || '';
  document.getElementById('edit-working-dir').value    = svc.working_dir || '';
  document.getElementById('edit-command').value = Array.isArray(svc.command)
    ? svc.command.join(' ')
    : (svc.command || '');

  const restartEl = document.getElementById('edit-restart');
  restartEl.value = svc.restart || 'no';

  // Ports
  const ports = formatPorts(svc.ports || []);
  renderDynamicList('edit-ports-list', ports, 'port');

  // Expose
  renderDynamicList('edit-expose-list', (svc.expose || []).map(String), 'expose');

  // Env vars
  const env = normalizeEnv(svc.environment);
  renderDynamicList('edit-env-list', env, 'env');

  // Env files
  renderDynamicList('edit-envfile-list', (svc.env_file || []).map(String), 'envfile');

  // Volumes
  renderDynamicList('edit-volumes-list', (svc.volumes || []).map(String), 'volume');

  // Networks
  const nets = Array.isArray(svc.networks) ? svc.networks.map(String) : [];
  renderDynamicList('edit-networks-list', nets, 'network');

  // Depends on
  renderDynamicList('edit-depends-on-list', (svc.depends_on || []).map(String), 'dependson');

  document.getElementById('edit-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const deleteBtn = document.getElementById('btn-delete-service');
  const isRunning = svc.state === 'running';
  deleteBtn.disabled = isRunning;
  deleteBtn.title = isRunning ? `Stop "${serviceName}" before deleting` : '';
}

function normalizeEnv(environment) {
  if (!environment) return [];
  if (Array.isArray(environment)) return environment.map(String);
  if (typeof environment === 'object') {
    return Object.entries(environment).map(([k, v]) => v !== null && v !== undefined ? `${k}=${v}` : k);
  }
  return [];
}

function closeEditModal() {
  clearValidationErrors('edit-modal-body');
  document.getElementById('edit-modal').classList.add('hidden');
  document.body.style.overflow = '';
  state.editModal.open = false;
}

document.getElementById('edit-close').addEventListener('click', closeEditModal);
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeEditModal();
});

document.getElementById('btn-add-port').addEventListener('click', () => {
  addDynamicRow('edit-ports-list', 'port');
});
document.getElementById('btn-add-expose').addEventListener('click', () => {
  addDynamicRow('edit-expose-list', 'expose');
});
document.getElementById('btn-add-env').addEventListener('click', () => {
  addDynamicRow('edit-env-list', 'env');
});
document.getElementById('btn-add-volume-mount').addEventListener('click', () => {
  addDynamicRow('edit-volumes-list', 'volume');
});
document.getElementById('btn-add-envfile').addEventListener('click', () => {
  addDynamicRow('edit-envfile-list', 'envfile');
});
document.getElementById('btn-add-network-join').addEventListener('click', () => {
  addDynamicRow('edit-networks-list', 'network');
});
document.getElementById('btn-add-depends-on').addEventListener('click', () => {
  addDynamicRow('edit-depends-on-list', 'dependson');
});

// ── Validation ───────────────────────────────────────────────
const PORT_RE    = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:)?\d+:\d+$/;
const ENV_RE     = /^[A-Za-z_][A-Za-z0-9_]*(=.*)?$/;
const VOLUME_RE  = /^[^:]+:[^:]+([^:]+)?$/;
const NAME_RE    = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

async function validateServiceConfig({ name, image, containerName, ports, expose, envRaw, volumes, networks, isCreate, currentServiceName }) {
  const errors = [];

  if (isCreate) {
    if (!name) {
      errors.push('Service name is required');
    } else if (!NAME_RE.test(name)) {
      errors.push(`Service name "${name}" is invalid — use letters, numbers, underscores, hyphens, dots`);
    } else if (state.services.some(s => s.name === name)) {
      errors.push(`Service "${name}" already exists`);
    }
    if (!image) errors.push('Image is required');
  }

  ports.forEach((p, i) => {
    if (p && !PORT_RE.test(p)) {
      errors.push(`Port #${i + 1} "${p}" is invalid — use host:container format, e.g. 8080:80`);
    }
  });

  // ports and expose should not both be set
  if (ports.length && expose.length) {
    errors.push('Use either PORTS or EXPOSE, not both — PORTS already exposes the container port to the host');
  }

  envRaw.forEach((e, i) => {
    if (e && !ENV_RE.test(e)) {
      errors.push(`Env var #${i + 1} "${e}" is invalid — use KEY=value or KEY format`);
    }
  });

  volumes.forEach((v, i) => {
    if (v && !VOLUME_RE.test(v)) {
      errors.push(`Volume #${i + 1} "${v}" is invalid — use source:target or source:target:mode format`);
    }
  });

  networks.forEach((n, i) => {
    if (!n.trim()) errors.push(`Network #${i + 1} is empty`);
  });

  // Check host ports already in use (skip ports already assigned to this service)
  const currentPorts = currentServiceName
    ? (state.services.find(s => s.name === currentServiceName)?.ports || [])
    : [];
  const currentHostPorts = new Set(
    currentPorts.map(p => {
      const str = typeof p === 'string' ? p : `${p.published}:${p.target}`;
      const parts = str.split(':');
      return parseInt(parts[parts.length - 2], 10);
    }).filter(Boolean)
  );

  const validPorts = ports.filter(p => PORT_RE.test(p));
  const hostPorts = validPorts.map(p => {
    const parts = p.split(':');
    return parseInt(parts[parts.length - 2], 10);
  }).filter(p => p && !currentHostPorts.has(p));

  // Check host ports used by other services in the compose file
  for (const port of hostPorts) {
    const takenBy = state.services.find(s => {
      if (s.name === currentServiceName) return false;
      return (s.ports || []).some(p => {
        const str = typeof p === 'string' ? p : `${p.published}:${p.target}`;
        const parts = str.split(':');
        return parseInt(parts[parts.length - 2], 10) === port;
      });
    });
    if (takenBy) {
      errors.push(`Host port ${port} is already used by service "${takenBy.name}"`);
    }
  }

  // Check host ports in use on the OS (only those not already flagged above)
  const flaggedPorts = new Set(errors.filter(e => e.includes('Host port')).map(e => parseInt(e.match(/Host port (\d+)/)[1])));
  const portsToOsCheck = hostPorts.filter(p => !flaggedPorts.has(p));
  if (portsToOsCheck.length) {
    try {
      const qs = portsToOsCheck.map(p => `ports=${p}`).join('&');
      const data = await apiFetch(`/api/ports/check?${qs}`);
      for (const p of (data.inUse || [])) {
        errors.push(`Host port ${p} is already in use on this machine`);
      }
    } catch { /* skip port check on error */ }
  }

  // Check container_name is not already used by another service in the compose file
  // or by a running Docker container
  if (containerName) {
    const currentContainerName = currentServiceName
      ? state.services.find(s => s.name === currentServiceName)?.container_name
      : null;
    if (containerName !== currentContainerName) {
      // Check against other services in the compose file
      const takenByService = state.services.find(
        s => s.name !== currentServiceName && s.container_name === containerName
      );
      if (takenByService) {
        errors.push(`Container name "${containerName}" is already used by service "${takenByService.name}"`);
      } else {
        // Check against live Docker containers
        try {
          const data = await apiFetch(`/api/containers/check?name=${encodeURIComponent(containerName)}`);
          if (data.inUse) {
            errors.push(`Container name "${containerName}" is already in use by another Docker container`);
          }
        } catch { /* skip on error */ }
      }
    }
  }

  return errors;
}

function showValidationErrors(containerId, errors) {
  clearValidationErrors(containerId);
  if (!errors.length) return;
  const container = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = 'validation-errors';
  div.id = `${containerId}-errors`;
  div.innerHTML = `<ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  container.insertBefore(div, container.firstChild);
}

function clearValidationErrors(containerId) {
  const existing = document.getElementById(`${containerId}-errors`);
  if (existing) existing.remove();
}

document.getElementById('btn-save-edit').addEventListener('click', async () => {
  const btn   = document.getElementById('btn-save-edit');
  const label = btn.querySelector('.btn-label');
  const name  = state.editModal.serviceName;
  if (!name) return;

  const image          = document.getElementById('edit-image').value.trim();
  const platform       = document.getElementById('edit-platform').value.trim();
  const containerName  = document.getElementById('edit-container-name').value.trim();
  const workingDir     = document.getElementById('edit-working-dir').value.trim();
  const command  = document.getElementById('edit-command').value.trim();
  const restart  = document.getElementById('edit-restart').value;
  const ports    = getDynamicListValues('edit-ports-list');
  const expose   = getDynamicListValues('edit-expose-list');
  const envRaw   = getDynamicListValues('edit-env-list');
  const envFiles = getDynamicListValues('edit-envfile-list');
  const volumes  = getDynamicListValues('edit-volumes-list');
  const networks = getDynamicListValues('edit-networks-list');
  const dependsOn = getDynamicListValues('edit-depends-on-list');

  const body = {};
  if (image)         body.image          = image;
  if (platform)      body.platform       = platform;
  else               body.platform       = null;
  if (containerName) body.container_name = containerName;
  else               body.container_name = null;
  if (command)  body.command  = command;
  if (restart)  body.restart  = restart;
  if (ports.length)     body.ports       = ports;
  else                  body.ports       = null;
  if (expose.length)    body.expose      = expose;
  else                  body.expose      = null;
  if (envRaw.length)    body.environment = envRaw;
  else                  body.environment = null;
  if (envFiles.length)  body.env_file    = envFiles;
  else                  body.env_file    = null;
  if (volumes.length)   body.volumes     = volumes;
  else                  body.volumes     = null;
  if (networks.length)  body.networks    = networks;
  else                  body.networks    = null;
  if (dependsOn.length) body.depends_on  = dependsOn;
  else                  body.depends_on  = null;
  if (workingDir)       body.working_dir = workingDir;
  else                  body.working_dir = null;

  const errors = await validateServiceConfig({ name, image, containerName, ports, expose, envRaw, volumes, networks, isCreate: false, currentServiceName: name });
  showValidationErrors('edit-modal-body', errors);
  if (errors.length) return;

  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.patchService(name, body);
    toast(`${name}: service updated`, 'success');
    closeEditModal();
    await fetchStatus(true);
  } catch (err) {
    toast(`Failed to update ${name}: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'SAVE CHANGES';
  }
});

document.getElementById('btn-delete-service').addEventListener('click', async () => {
  const name = state.editModal.serviceName;
  if (!name) return;

  const svc = state.services.find(s => s.name === name);
  if (svc && svc.state === 'running') {
    toast(`Stop "${name}" before deleting it`, 'error');
    return;
  }

  const confirmed = await showConfirm({
    title: `DELETE "${name}"`,
    message: `This will permanently remove the "${name}" service from the compose file. The action cannot be undone.`,
    confirmLabel: 'DELETE',
    danger: true,
  });
  if (!confirmed) return;

  const btn   = document.getElementById('btn-delete-service');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.deleteService(name);
    toast(`${name}: service deleted`, 'success');
    closeEditModal();
    await fetchStatus(true);
  } catch (err) {
    toast(`Failed to delete ${name}: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'DELETE SERVICE';
  }
});

// ── Copy Service ──────────────────────────────────────────────
async function openCopyModal(serviceName) {
  const svc = state.services.find(s => s.name === serviceName);
  if (!svc) return;

  await refreshKnownNetworks();

  document.getElementById('add-name').value           = `copy-of-${serviceName}`;
  document.getElementById('add-image').value          = svc.image || '';
  document.getElementById('add-container-name').value = ''; // don't copy container_name — must be unique
  document.getElementById('add-working-dir').value = svc.working_dir || '';
  document.getElementById('add-platform').value    = svc.platform || '';
  document.getElementById('add-command').value = Array.isArray(svc.command)
    ? svc.command.join(' ')
    : (svc.command || '');
  document.getElementById('add-restart').value = svc.restart || 'no';
  renderDynamicList('add-ports-list', formatPorts(svc.ports || []), 'port');
  renderDynamicList('add-expose-list', (svc.expose || []).map(String), 'expose');
  renderDynamicList('add-env-list', normalizeEnv(svc.environment), 'env');
  renderDynamicList('add-envfile-list', (svc.env_file || []).map(String), 'envfile');
  renderDynamicList('add-volumes-list', (svc.volumes || []).map(String), 'volume');
  renderDynamicList('add-networks-list', (svc.networks || []).map(String), 'network');
  renderDynamicList('add-depends-on-list', (svc.depends_on || []).map(String), 'dependson');

  document.getElementById('add-modal-title').textContent = `COPY SERVICE — ${serviceName}`;
  document.getElementById('add-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('add-name').focus();
  document.getElementById('add-name').select();
}


document.getElementById('btn-add-service').addEventListener('click', async () => {
  await refreshKnownNetworks();
  document.getElementById('add-name').value    = '';
  document.getElementById('add-image').value          = '';
  document.getElementById('add-container-name').value = '';
  document.getElementById('add-working-dir').value    = '';
  document.getElementById('add-platform').value       = '';
  document.getElementById('add-command').value = '';
  document.getElementById('add-restart').value = 'no';
  renderDynamicList('add-ports-list', [], 'port');
  renderDynamicList('add-expose-list', [], 'expose');
  renderDynamicList('add-env-list', [], 'env');
  renderDynamicList('add-envfile-list', [], 'envfile');
  renderDynamicList('add-volumes-list', [], 'volume');
  renderDynamicList('add-networks-list', [], 'network');
  renderDynamicList('add-depends-on-list', [], 'dependson');
  document.getElementById('add-modal-title').textContent = 'ADD NEW SERVICE';
  document.getElementById('add-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('add-name').focus();
});

// Auto-fill container_name from service name while user hasn't manually edited it
let containerNameManuallyEdited = false;
document.getElementById('add-container-name').addEventListener('input', () => {
  containerNameManuallyEdited = true;
});
document.getElementById('add-name').addEventListener('input', () => {
  if (!containerNameManuallyEdited) {
    document.getElementById('add-container-name').value =
      document.getElementById('add-name').value;
  }
});
// Reset the manual-edit flag each time the modal opens
document.getElementById('btn-add-service').addEventListener('click', () => {
  containerNameManuallyEdited = false;
}, true); // capture phase so it runs before the main handler clears the field

document.getElementById('add-close').addEventListener('click', () => {
  clearValidationErrors('add-modal-body');
  document.getElementById('add-modal').classList.add('hidden');
  document.body.style.overflow = '';
});
document.getElementById('add-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('add-modal').classList.add('hidden');
    document.body.style.overflow = '';
  }
});

document.getElementById('btn-add-port-new').addEventListener('click', () => {
  addDynamicRow('add-ports-list', 'port');
});
document.getElementById('btn-add-expose-new').addEventListener('click', () => {
  addDynamicRow('add-expose-list', 'expose');
});
document.getElementById('btn-add-env-new').addEventListener('click', () => {
  addDynamicRow('add-env-list', 'env');
});
document.getElementById('btn-add-volume-new').addEventListener('click', () => {
  addDynamicRow('add-volumes-list', 'volume');
});
document.getElementById('btn-add-network-new').addEventListener('click', () => {
  addDynamicRow('add-networks-list', 'network');
});
document.getElementById('btn-add-depends-on-new').addEventListener('click', () => {
  addDynamicRow('add-depends-on-list', 'dependson');
});
document.getElementById('btn-add-envfile-new').addEventListener('click', () => {
  addDynamicRow('add-envfile-list', 'envfile');
});

document.getElementById('btn-create-service').addEventListener('click', async () => {
  const btn   = document.getElementById('btn-create-service');
  const label = btn.querySelector('.btn-label');

  const name          = document.getElementById('add-name').value.trim();
  const image         = document.getElementById('add-image').value.trim();
  const containerName = document.getElementById('add-container-name').value.trim();
  const workingDir    = document.getElementById('add-working-dir').value.trim();
  const platform      = document.getElementById('add-platform').value.trim();
  const command  = document.getElementById('add-command').value.trim();
  const restart  = document.getElementById('add-restart').value;
  const ports    = getDynamicListValues('add-ports-list');
  const expose   = getDynamicListValues('add-expose-list');
  const envRaw   = getDynamicListValues('add-env-list');
  const envFiles = getDynamicListValues('add-envfile-list');
  const volumes  = getDynamicListValues('add-volumes-list');
  const networks = getDynamicListValues('add-networks-list');
  const dependsOn = getDynamicListValues('add-depends-on-list');

  if (!name) { toast('Service name is required', 'error'); return; }
  if (!image) { toast('Image is required', 'error'); return; }

  const errors = await validateServiceConfig({ name, image, containerName, ports, expose, envRaw, volumes, networks, isCreate: true });
  showValidationErrors('add-modal-body', errors);
  if (errors.length) return;

  const body = { name, image };
  if (containerName)                body.container_name = containerName;
  if (platform)                     body.platform       = platform;
  if (command)                      body.command        = command;
  if (restart && restart !== 'no')  body.restart        = restart;
  if (ports.length)    body.ports       = ports;
  if (expose.length)   body.expose      = expose;
  if (envRaw.length)   body.environment = envRaw;
  if (envFiles.length) body.env_file    = envFiles;
  if (volumes.length)  body.volumes     = volumes;
  if (networks.length) body.networks    = networks;
  if (dependsOn.length) body.depends_on = dependsOn;
  if (workingDir)       body.working_dir = workingDir;

  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await api.addService(body);
    toast(`${name}: service created`, 'success');
    document.getElementById('add-modal').classList.add('hidden');
    document.body.style.overflow = '';
    await fetchStatus(true);
  } catch (err) {
    toast(`Failed to create service: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'CREATE SERVICE';
  }
});

// ── Known networks cache (populated when modals open) ────────
let knownNetworks = [];

async function refreshKnownNetworks() {
  try {
    const data = await apiFetch('/api/networks');
    knownNetworks = (data.networks || []).map(n => n.name);
  } catch { /* keep stale cache */ }
}

// ── Dynamic List Helpers ─────────────────────────────────────
function renderDynamicList(containerId, values, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  values.forEach(val => {
    container.appendChild(createDynamicRow(val, type));
  });
}

function addDynamicRow(containerId, type) {
  const container = document.getElementById(containerId);
  container.appendChild(createDynamicRow('', type));
  if (type !== 'network' && type !== 'dependson') {
    const inputs = container.querySelectorAll('input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }
}

function createDynamicRow(value, type) {
  const row = document.createElement('div');
  row.className = 'dynamic-row';

  if (type === 'network') {
    return createNetworkRow(value, row);
  }

  if (type === 'dependson') {
    return createDependsOnRow(value, row);
  }

  const placeholder = type === 'port' ? '8080:80' : type === 'expose' ? '8080' : type === 'dependson' ? 'service-name' : 'KEY=value';

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'form-input';
  input.value       = value;
  input.placeholder = placeholder;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-row';
  removeBtn.type      = 'button';
  removeBtn.innerHTML = '&times;';
  removeBtn.title     = 'Remove';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(input);
  row.appendChild(removeBtn);
  return row;
}

function createNetworkRow(value, row) {
  const select = document.createElement('select');
  select.className = 'form-select network-select';

  knownNetworks.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    if (n === value) opt.selected = true;
    select.appendChild(opt);
  });

  // If value is set but not in known list, add it
  if (value && !knownNetworks.includes(value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    opt.selected = true;
    select.appendChild(opt);
  }

  // If no known networks, show a plain text input instead
  if (knownNetworks.length === 0) {
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'form-input';
    input.value       = value;
    input.placeholder = 'network-name';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-row';
    removeBtn.type      = 'button';
    removeBtn.innerHTML = '&times;';
    removeBtn.title     = 'Remove';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-row';
  removeBtn.type      = 'button';
  removeBtn.innerHTML = '&times;';
  removeBtn.title     = 'Remove';
  removeBtn.addEventListener('click', () => row.remove());

  // Hidden input as canonical value for getDynamicListValues
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.className = 'network-value';
  hidden.value = select.value;
  select.addEventListener('change', () => { hidden.value = select.value; });

  row.appendChild(select);
  row.appendChild(hidden);
  row.appendChild(removeBtn);
  return row;
}

function createDependsOnRow(value, row) {
  const currentName = state.editModal.serviceName || null;
  const services = state.services.map(s => s.name).filter(n => n !== currentName);

  const select = document.createElement('select');
  select.className = 'form-select network-select';

  services.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    if (n === value) opt.selected = true;
    select.appendChild(opt);
  });

  // If value set but not in current list, add it
  if (value && !services.includes(value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    opt.selected = true;
    select.appendChild(opt);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-row';
  removeBtn.type      = 'button';
  removeBtn.innerHTML = '&times;';
  removeBtn.title     = 'Remove';
  removeBtn.addEventListener('click', () => row.remove());

  const hidden = document.createElement('input');
  hidden.type      = 'hidden';
  hidden.className = 'network-value';
  hidden.value     = select.value;
  select.addEventListener('change', () => { hidden.value = select.value; });

  row.appendChild(select);
  row.appendChild(hidden);
  row.appendChild(removeBtn);
  return row;
}

function getDynamicListValues(containerId) {
  const container = document.getElementById(containerId);
  // Network rows use a hidden .network-value input as canonical value
  const networkValues = Array.from(container.querySelectorAll('.network-value'))
    .map(i => i.value.trim())
    .filter(Boolean);
  if (networkValues.length || container.querySelector('.network-select')) {
    return networkValues;
  }
  return Array.from(container.querySelectorAll('input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

// ── Volumes & Networks Modal ──────────────────────────────────
document.getElementById('btn-vol-net').addEventListener('click', openVolNetModal);
document.getElementById('volnet-close').addEventListener('click', closeVolNetModal);
document.getElementById('volnet-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeVolNetModal();
});

document.querySelectorAll('.volnet-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.volnet-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.volnet-panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`volnet-panel-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

async function openVolNetModal() {
  document.getElementById('volnet-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // Reset to volumes tab
  document.querySelectorAll('.volnet-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.volnet-panel').forEach(p => p.classList.add('hidden'));
  document.querySelector('.volnet-tab[data-tab="volumes"]').classList.add('active');
  document.getElementById('volnet-panel-volumes').classList.remove('hidden');
  await Promise.all([loadVolumes(), loadNetworks()]);
}

function closeVolNetModal() {
  document.getElementById('volnet-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function loadVolumes() {
  const list = document.getElementById('volnet-volumes-list');
  list.innerHTML = '<div class="volnet-loading">Loading...</div>';
  try {
    const data = await apiFetch('/api/volumes');
    renderVolNetList(list, data.volumes || [], 'volume');
  } catch (err) {
    list.innerHTML = `<div class="volnet-empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadNetworks() {
  const list = document.getElementById('volnet-networks-list');
  list.innerHTML = '<div class="volnet-loading">Loading...</div>';
  try {
    const data = await apiFetch('/api/networks');
    renderVolNetList(list, data.networks || [], 'network');
  } catch (err) {
    list.innerHTML = `<div class="volnet-empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderVolNetList(container, items, type) {
  if (!items.length) {
    container.innerHTML = `<div class="volnet-empty">No ${type}s defined</div>`;
    return;
  }
  container.innerHTML = items.map(item => {
    const meta = [
      item.driver ? `driver: ${escapeHtml(item.driver)}` : '',
      item.external ? 'external' : '',
    ].filter(Boolean).join(' · ');

    // Find services using this volume/network
    const usedBy = state.services.filter(svc => {
      if (type === 'volume') {
        return (svc.volumes || []).some(v => String(v).split(':')[0] === item.name);
      } else {
        return (svc.networks || []).includes(item.name);
      }
    }).map(svc => svc.name);

    const inUse = usedBy.length > 0;
    const usedByHint = inUse ? `Used by (${usedBy.length}): ${usedBy.join(', ')}` : '';

    return `
      <div class="volnet-item">
        <div class="volnet-item-info">
          <span class="volnet-item-name">${escapeHtml(item.name)}</span>
          ${meta ? `<span class="volnet-item-meta">${meta}</span>` : ''}
          ${inUse ? `<span class="volnet-item-inuse">${escapeHtml(usedByHint)}</span>` : ''}
        </div>
        <button class="btn btn-danger btn-sm volnet-delete-btn"
          data-type="${type}" data-name="${escapeHtml(item.name)}"
          ${inUse ? 'disabled title="' + escapeHtml(usedByHint) + '"' : ''}>
          <span class="btn-label">DELETE</span>
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.volnet-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { name, type: t } = btn.dataset;
      const confirmed = await showConfirm({
        title: `DELETE ${t.toUpperCase()}`,
        message: `Remove "${name}" from the compose file?`,
        confirmLabel: 'DELETE',
        danger: true,
      });
      if (!confirmed) return;
      const label = btn.querySelector('.btn-label');
      btn.disabled = true;
      label.innerHTML = spinnerHtml('spinner-sm');
      try {
        await apiFetch(`/api/${t}s/${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast(`${t} "${name}" deleted`, 'success');
        t === 'volume' ? loadVolumes() : loadNetworks();
      } catch (err) {
        toast(`Failed: ${err.message}`, 'error');
        btn.disabled = false;
        label.textContent = 'DELETE';
      }
    });
  });
}

document.getElementById('btn-add-volume').addEventListener('click', async () => {
  const name     = document.getElementById('volnet-vol-name').value.trim();
  const driver   = document.getElementById('volnet-vol-driver').value.trim();
  const external = document.getElementById('volnet-vol-external').checked;
  if (!name) { toast('Volume name is required', 'error'); return; }
  const btn = document.getElementById('btn-add-volume');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true; label.innerHTML = spinnerHtml('spinner-sm');
  try {
    await apiFetch('/api/volumes', { method: 'POST', body: JSON.stringify({ name, driver, external }) });
    toast(`Volume "${name}" added`, 'success');
    document.getElementById('volnet-vol-name').value = '';
    document.getElementById('volnet-vol-driver').value = '';
    document.getElementById('volnet-vol-external').checked = false;
    loadVolumes();
  } catch (err) {
    toast(`Failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; label.textContent = 'ADD';
  }
});

document.getElementById('btn-add-network').addEventListener('click', async () => {
  const name     = document.getElementById('volnet-net-name').value.trim();
  const driver   = document.getElementById('volnet-net-driver').value.trim();
  const external = document.getElementById('volnet-net-external').checked;
  if (!name) { toast('Network name is required', 'error'); return; }
  const btn = document.getElementById('btn-add-network');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true; label.innerHTML = spinnerHtml('spinner-sm');
  try {
    await apiFetch('/api/networks', { method: 'POST', body: JSON.stringify({ name, driver, external }) });
    toast(`Network "${name}" added`, 'success');
    document.getElementById('volnet-net-name').value = '';
    document.getElementById('volnet-net-driver').value = '';
    document.getElementById('volnet-net-external').checked = false;
    loadNetworks();
  } catch (err) {
    toast(`Failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; label.textContent = 'ADD';
  }
});

// ── Settings Modal ────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
document.getElementById('settings-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSettingsModal();
});

async function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    const data = await apiFetch('/api/config');
    document.getElementById('settings-compose-path').value = data.composePath || '';
  } catch {
    document.getElementById('settings-compose-path').value = '';
  }
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-settings');
  const label = btn.querySelector('.btn-label');
  const composePath = document.getElementById('settings-compose-path').value.trim();
  if (!composePath) { toast('Path is required', 'error'); return; }

  btn.disabled = true;
  label.innerHTML = spinnerHtml();
  try {
    await apiFetch('/api/config', { method: 'PUT', body: JSON.stringify({ composePath }) });
    toast('Settings saved', 'success');
    closeSettingsModal();
    await fetchStatus(true);
  } catch (err) {
    toast(`Failed to save settings: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'SAVE SETTINGS';
  }
});

// ── History Modal ─────────────────────────────────────────────
document.getElementById('btn-history').addEventListener('click', openHistoryModal);
document.getElementById('history-close').addEventListener('click', closeHistoryModal);
document.getElementById('history-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeHistoryModal();
});

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  const confirmed = await showConfirm({
    title: 'CLEAR ALL HISTORY',
    message: 'This will permanently delete all saved versions. This cannot be undone.',
    confirmLabel: 'CLEAR ALL',
    danger: true,
  });
  if (!confirmed) return;
  const btn = document.getElementById('btn-clear-history');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml('spinner-sm');
  try {
    await apiFetch('/api/history', { method: 'DELETE' });
    toast('History cleared', 'success');
    renderHistoryList([]);
    document.getElementById('history-preview').innerHTML = '<div class="history-preview-empty">Select a version to preview</div>';
  } catch (err) {
    toast(`Failed to clear history: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    label.textContent = 'CLEAR ALL';
  }
});

async function openHistoryModal() {
  document.getElementById('history-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('history-list').innerHTML = '<div class="history-placeholder">Loading...</div>';
  document.getElementById('history-preview').innerHTML = '<div class="history-preview-empty">Select a version to preview</div>';

  try {
    const data = await apiFetch('/api/history');
    renderHistoryList(data.versions || []);
  } catch (err) {
    document.getElementById('history-list').innerHTML = `<div class="history-empty">Failed to load history: ${escapeHtml(err.message)}</div>`;
  }
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderHistoryList(versions) {
  const list = document.getElementById('history-list');
  if (!versions.length) {
    list.innerHTML = '<div class="history-empty">No versions yet.<br>Edits will appear here.</div>';
    return;
  }
  list.innerHTML = versions.map(v => `
    <div class="history-item" data-id="${escapeHtml(v.id)}">
      <div class="history-item-label" title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</div>
      <div class="history-item-time">${formatHistoryTime(v.timestamp)}</div>
    </div>
  `).join('');

  list.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => loadHistoryVersion(el.dataset.id, el, versions));
  });
}

async function loadHistoryVersion(id, itemEl, versions) {
  document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
  itemEl.classList.add('active');

  const preview = document.getElementById('history-preview');
  preview.innerHTML = '<div class="history-preview-empty">Loading...</div>';

  try {
    const data = await apiFetch(`/api/history/${id}`);
    const v = data.version;
    preview.innerHTML = `
      <div class="history-preview-header">
        <span class="history-preview-meta">${escapeHtml(v.label)} &mdash; ${formatHistoryTime(v.timestamp)}</span>
        <button class="btn btn-success btn-sm" id="btn-restore-version">
          <span class="btn-label">RESTORE THIS VERSION</span>
        </button>
      </div>
      <pre class="history-preview-yaml">${escapeHtml(v.yaml)}</pre>
    `;
    document.getElementById('btn-restore-version').addEventListener('click', () => restoreVersion(v));
  } catch (err) {
    preview.innerHTML = `<div class="history-preview-empty">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

async function restoreVersion(v) {
  const ts = new Date(v.timestamp).toLocaleString();
  const confirmed = await showConfirm({
    title: 'RESTORE VERSION',
    message: `Restore "${v.label}" from ${ts}? The current compose file will be saved as a new version before restoring.`,
    confirmLabel: 'RESTORE',
    danger: false,
  });
  if (!confirmed) return;

  const btn = document.getElementById('btn-restore-version');
  const label = btn.querySelector('.btn-label');
  btn.disabled = true;
  label.innerHTML = spinnerHtml('spinner-sm');

  try {
    await apiFetch(`/api/history/${v.id}/restore`, { method: 'POST' });
    toast(`Restored: ${v.label}`, 'success');
    closeHistoryModal();
    await fetchStatus(true);
  } catch (err) {
    toast(`Restore failed: ${err.message}`, 'error');
    btn.disabled = false;
    label.textContent = 'RESTORE THIS VERSION';
  }
}

function formatHistoryTime(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} ${time}`;
}

// ── Keyboard Handlers ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!document.getElementById('logs-modal').classList.contains('hidden')) {
      closeLogsModal();
    } else if (!document.getElementById('edit-modal').classList.contains('hidden')) {
      closeEditModal();
    } else if (!document.getElementById('add-modal').classList.contains('hidden')) {
      document.getElementById('add-modal').classList.add('hidden');
      document.body.style.overflow = '';
    } else if (!document.getElementById('history-modal').classList.contains('hidden')) {
      closeHistoryModal();
    } else if (!document.getElementById('volnet-modal').classList.contains('hidden')) {
      closeVolNetModal();
    } else if (!document.getElementById('settings-modal').classList.contains('hidden')) {
      closeSettingsModal();
    } else if (state.view === 'yaml') {
      switchView('cards');
    }
  }
});

// ── Auto-refresh ──────────────────────────────────────────────
let autoRefreshTimer = null;
let autoStatsTimer = null;

function isAnyModalOpen() {
  return !document.getElementById('logs-modal').classList.contains('hidden')
    || !document.getElementById('edit-modal').classList.contains('hidden')
    || !document.getElementById('add-modal').classList.contains('hidden')
    || !document.getElementById('history-modal').classList.contains('hidden')
    || !document.getElementById('volnet-modal').classList.contains('hidden')
    || !document.getElementById('settings-modal').classList.contains('hidden');
}

function startAutoRefresh(intervalMs = 10000) {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    const busy = Object.keys(state.actionLoading).length > 0
      || Object.values(state.globalLoading).some(Boolean);
    if (!isAnyModalOpen() && !busy && state.view === 'cards') {
      fetchStatus(true);
    }
  }, intervalMs);
}

function startStatsAutoRefresh(intervalMs = 5000) {
  if (autoStatsTimer) clearInterval(autoStatsTimer);
  autoStatsTimer = setInterval(() => {
    const hasRunning = state.services.some(s => s.state === 'running');
    if (!isAnyModalOpen() && hasRunning && state.view === 'cards' && !state.statsLoading) {
      fetchStats();
    }
  }, intervalMs);
}

// ── Search ────────────────────────────────────────────────────
document.getElementById('service-search').addEventListener('input', e => {
  state.search = e.target.value.trim();
  renderCards();
});

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  await fetchStatus(false);
  fetchStats();
  startAutoRefresh(10000);
  startStatsAutoRefresh(5000);
})();
