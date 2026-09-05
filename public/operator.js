import {
  KIOSK_TOKEN_STORAGE_KEY,
  RESET_TOKEN_STORAGE_KEY,
  readSessionValue,
  writeSessionValue,
} from './js/api-client.js';

const byId = (id) => document.getElementById(id);
const kioskInput = byId('kioskToken');
const resetInput = byId('resetToken');
const message = byId('operatorMessage');
const badge = byId('connectionBadge');

kioskInput.value = readSessionValue(KIOSK_TOKEN_STORAGE_KEY);
resetInput.value = readSessionValue(RESET_TOKEN_STORAGE_KEY);

function announce(text, tone = '') {
  message.textContent = text;
  message.dataset.tone = tone;
}

function saveCodes() {
  writeSessionValue(KIOSK_TOKEN_STORAGE_KEY, kioskInput.value.trim());
  writeSessionValue(RESET_TOKEN_STORAGE_KEY, resetInput.value.trim());
  announce('Codes saved for this browser session.', 'success');
}

function resetHeaders() {
  const token = resetInput.value.trim() || readSessionValue(RESET_TOKEN_STORAGE_KEY);
  return token ? { 'X-Reset-Token': token } : {};
}

async function readPayload(response) {
  try { return await response.json(); } catch { return {}; }
}

async function refreshStatus() {
  badge.textContent = 'Checking…';
  badge.dataset.state = 'checking';
  byId('statusNetwork').textContent = navigator.onLine ? 'Online' : 'Offline';
  try {
    const response = await fetch('/api/status', { cache: 'no-store', headers: resetHeaders() });
    const data = await readPayload(response);
    if (!response.ok) throw new Error(data.error || `Status failed (${response.status})`);
    const usedMb = (data.usage.bytes / 1024 / 1024).toFixed(1);
    const maxMb = (data.limits.bytes / 1024 / 1024).toFixed(0);
    byId('statusDay').textContent = data.day;
    byId('statusTimezone').textContent = data.timezone;
    byId('statusFish').textContent = `${data.usage.count} of ${data.limits.submissions}`;
    byId('statusStorage').textContent = `${usedMb} MB of ${maxMb} MB`;
    byId('statusKiosk').textContent = data.kioskProtection ? 'Enabled' : 'Not configured';
    byId('statusAi').textContent = data.aiDescriptions ? 'Enabled' : 'Local fallback only';
    byId('statusChecked').textContent = new Date(data.checkedAt).toLocaleTimeString();
    badge.textContent = 'Healthy';
    badge.dataset.state = 'healthy';
    announce('Live status updated.', 'success');
    saveCodes();
  } catch (error) {
    badge.textContent = navigator.onLine ? 'Needs attention' : 'Offline';
    badge.dataset.state = 'error';
    announce(error.message, 'error');
  }
}

byId('saveCodes').addEventListener('click', saveCodes);
byId('refreshStatus').addEventListener('click', refreshStatus);
byId('clearCodes').addEventListener('click', () => {
  kioskInput.value = '';
  resetInput.value = '';
  writeSessionValue(KIOSK_TOKEN_STORAGE_KEY, '');
  writeSessionValue(RESET_TOKEN_STORAGE_KEY, '');
  announce('Codes removed from this browser session.');
});
byId('resetAquarium').addEventListener('click', async () => {
  if (!confirm('Remove every fish submitted today? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/reset', { method: 'POST', headers: resetHeaders() });
    const data = await readPayload(response);
    if (!response.ok) throw new Error(data.error || `Reset failed (${response.status})`);
    announce('The aquarium was reset successfully.', 'success');
    await refreshStatus();
  } catch (error) {
    announce(error.message, 'error');
  }
});

window.addEventListener('online', refreshStatus);
window.addEventListener('offline', () => refreshStatus());
if (resetInput.value) refreshStatus();
