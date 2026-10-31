// GET /api/team?days=30                          (header x-admin-key) one row per active client, from saved reports
// GET /api/team?token=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD   one client for any range, fetched live if needed
// GET /api/team?token=<key>&days=7                one client for a preset, fetched live if not saved yet
import { getClients, cacheGet, cachePut, latestKey } from '../lib/store.mjs';
import { presetRange, cacheKey, resolveRange } from '../lib/range.mjs';
import { buildReport } from '../lib/ads.mjs';
import { summarize, emptyRow } from '../lib/team.mjs';
import { demoReport } from '../lib/demo.mjs';
import { isAdmin, jsonRes } from '../lib/auth.mjs';

const PRE = [7, 30, 90];

async function saved(c, days) {
  let hit = await cacheGet(latestKey(c.token, days));
  if (!hit) { const { from, to } = presetRange(days, c.timezone); hit = await cacheGet(cacheKey(c, from, to)); }
  return hit && hit.payload ? hit : null;
}

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  const url = new URL(req.url);
  const all = await getClients();
  const days = Number(url.searchParams.get('days')) || 30;
  const token = url.searchParams.get('token');

  if (token) {
    const c = all.find((x) => x.token === token);
    if (!c) return jsonRes({ error: 'Client not found.' }, 404);
    const custom = url.searchParams.get('from') && url.searchParams.get('to');
    try {
      if (!custom && PRE.includes(days)) {
        const hit = await saved(c, days);
        if (hit) return jsonRes({ row: summarize(c, hit.payload, hit.saved_at) });
      }
      const r = resolveRange(url.searchParams, c.timezone);
      if (r.error) return jsonRes({ error: r.error }, 400);
      const key = cacheKey(c, r.from, r.to);
      let hit = await cacheGet(key);
      if (!hit) {
        const payload = process.env.VPM_DEV ? demoReport('demo', r.from, r.to) : await buildReport({ client: c, from: r.from, to: r.to });
        hit = { saved_at: Date.now(), payload };
        await cachePut(key, hit);
        if (!custom && PRE.includes(payload.meta.range.days) && r.to < r.today) await cachePut(latestKey(c.token, payload.meta.range.days), hit);
      }
      return jsonRes({ row: summarize(c, hit.payload, hit.saved_at) });
    } catch (e) {
      return jsonRes({ row: emptyRow(c, 'Could not load: ' + e.message) });
    }
  }

  const active = all.filter((c) => c.token && c.customer_id && !c.disabled);
  const rows = await Promise.all(active.map(async (c) => {
    try {
      const hit = PRE.includes(days) ? await saved(c, days) : null;
      return hit ? summarize(c, hit.payload, hit.saved_at) : emptyRow(c, 'Not loaded yet');
    } catch (e) {
      return emptyRow(c, 'Could not read: ' + e.message);
    }
  }));
  return jsonRes({ generated_at: new Date().toISOString(), days, inactive: all.length - active.length, clients: rows });
};

export const config = { path: '/api/team' };
