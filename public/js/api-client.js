export const KIOSK_TOKEN_STORAGE_KEY = 'colorAquarium:kioskToken';
export const RESET_TOKEN_STORAGE_KEY = 'colorAquarium:resetToken';

export function readSessionValue(key) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}

export function writeSessionValue(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function kioskHeaders(headers = {}) {
  const token = readSessionValue(KIOSK_TOKEN_STORAGE_KEY);
  return token ? { ...headers, 'X-Kiosk-Token': token } : headers;
}

export async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: kioskHeaders(options.headers || {}),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
