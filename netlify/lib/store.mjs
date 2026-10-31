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
  return match(loadClients(env), token);
}

// ---- Client list saved from the admin page (/admin). Once saved there, it is used instead of clients.json. ----
const CFG_KEY = 'clients';
let memList = null, memAt = 0;
function cfgStore() {
  try { return getStore({ name: 'vpm-config', consistency: 'strong' }); } catch { return null; }
}
export const RESERVED = ['team', 'admin', 'api', 'demo', 'demo-calls', 'index', '404'];

export async function getClientsWithSource(env = process.env) {
  if (memList && Date.now() - memAt < 10000) return { clients: memList, source: 'admin' };
  const s = cfgStore();
  if (s) {
    try {
      const v = await s.get(CFG_KEY, { type: 'json' });
      if (v && Array.isArray(v.clients)) { memList = v.clients; memAt = Date.now(); return { clients: memList, source: 'admin', saved_at: v.saved_at }; }
    } catch { /* fall back to file */ }
  }
  return { clients: loadClients(env), source: env.CLIENTS_JSON ? 'CLIENTS_JSON' : 'clients.json' };
}
export async function getClients(env = process.env) { return (await getClientsWithSource(env)).clients; }

export async function saveClients(list) {
  const s = cfgStore();
  if (s) {
    try { await s.setJSON(CFG_KEY, { clients: list, saved_at: Date.now() }); memList = list; memAt = Date.now(); return; }
    catch (e) { if (!process.env.VPM_DEV) throw new Error('Could not save to Netlify storage: ' + e.message); }
  } else if (!process.env.VPM_DEV) throw new Error('Netlify storage is not available here.');
  memList = list; memAt = Date.now() + 1e12; // local preview only: keep in memory
}

function match(list, token) {
  if (!token || !/^[A-Za-z0-9_-]{4,200}$/.test(token)) return null;
  const lower = token.toLowerCase();
  return list.find((c) => !c.disabled && c.token && (c.token === token || (c.token === c.token.toLowerCase() && c.token === lower))) || null;
}
export async function findClientAsync(token, env = process.env) { return match(await getClients(env), token); }

// Latest 7, 30 and 90 day report per client, for the team dashboard.
export const latestKey = (token, days = 30) => 'latest' + days + '/' + token;
