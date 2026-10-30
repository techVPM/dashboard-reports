// Cache (Netlify Blobs, with an in-memory fallback for local tests) and the client list.
import { getStore } from '@netlify/blobs';
import fileClients from '../../clients.json' with { type: 'json' };

const mem = new Map();
function store() {
  try { return getStore({ name: 'vpm-reports', consistency: 'strong' }); } catch { return null; }
}

export async function cacheGet(key) {
  const s = store();
  if (s) {
    try { const v = await s.get(key, { type: 'json' }); if (v) return v; } catch { /* fall through */ }
  }
  return mem.get(key) || null;
}

export async function cachePut(key, value) {
  mem.set(key, value);
  const s = store();
  if (s) { try { await s.setJSON(key, value); } catch { /* memory copy is enough for this instance */ } }
}

// Clients live in clients.json (private repo) or in the CLIENTS_JSON setting on Netlify.
export function loadClients(env = process.env) {
  if (env.CLIENTS_JSON) {
    try { const j = JSON.parse(env.CLIENTS_JSON); if (Array.isArray(j)) return j; } catch { /* use file */ }
  }
  return Array.isArray(fileClients) ? fileClients : [];
}

export function findClient(token, env = process.env) {
  if (!token || !/^[A-Za-z0-9_-]{4,200}$/.test(token)) return null;
  // Readable keys (all lowercase, like coach-by-chris-1613) match without regard to capital letters.
  const lower = token.toLowerCase();
  return loadClients(env).find((c) => !c.disabled && c.token && (c.token === token || (c.token === c.token.toLowerCase() && c.token === lower))) || null;
}
