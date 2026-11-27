// Settings persistence (audit H3). The provider choice and flags are not secret and persist in
// localStorage. The API key is a secret: it lives in sessionStorage only, so it is dropped when the
// tab closes and is not left on disk in the browser profile.
const KEY = 'qafg.settings';
const DEFAULTS = { provider: 'claude-local', apiKey: '' };

const read = (store) => {
  try { const raw = store.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const write = (store, value) => { try { store.setItem(KEY, JSON.stringify(value)); } catch { /* storage blocked or full */ } };
const remove = (store) => { try { store.removeItem(KEY); } catch { /* ignore */ } };

export function loadSettings(local, session) {
  const persisted = read(local) || {};
  const sessionPart = read(session) || {};
  // Migration: earlier versions kept the key in localStorage. Move it to sessionStorage and rewrite
  // the persisted copy without it.
  let apiKey = typeof sessionPart.apiKey === 'string' ? sessionPart.apiKey : '';
  if (typeof persisted.apiKey === 'string' && persisted.apiKey) {
    if (!apiKey) apiKey = persisted.apiKey;
    const { apiKey: _dropped, ...rest } = persisted;
    write(local, rest);
    write(session, { apiKey });
  }
  const { apiKey: _ignored, ...safe } = persisted;
  return { ...DEFAULTS, ...safe, apiKey };
}

export function saveSettings(next, local, session) {
  const { apiKey, ...rest } = next;
  write(local, rest);
  if (apiKey) write(session, { apiKey }); else remove(session);
}

// A key typed on a page that is not served from this machine can be read by whoever controls the
// page's origin or the network path to it, so the settings dialog warns about it.
export function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
