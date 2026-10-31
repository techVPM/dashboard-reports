// GET /api/team  (header x-admin-key) - one row per client for the team dashboard.
import { getClients, cacheGet, latestKey } from '../lib/store.mjs';
import { presetRange, cacheKey } from '../lib/range.mjs';
import { summarize, emptyRow } from '../lib/team.mjs';
import { isAdmin, jsonRes } from '../lib/auth.mjs';

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  const clients = (await getClients()).filter((c) => c.token && c.customer_id && !c.disabled);
  const rows = await Promise.all(clients.map(async (c) => {
    try {
      let hit = await cacheGet(latestKey(c.token));
      if (!hit) { const { from, to } = presetRange(30, c.timezone); hit = await cacheGet(cacheKey(c, from, to)); }
      if (!hit || !hit.payload) return emptyRow(c, 'Not loaded yet');
      return summarize(c, hit.payload, hit.saved_at);
    } catch (e) {
      return emptyRow(c, 'Could not read: ' + e.message);
    }
  }));
  return jsonRes({ generated_at: new Date().toISOString(), clients: rows });
};

export const config = { path: '/api/team' };
