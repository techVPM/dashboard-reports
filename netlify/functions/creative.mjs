// GET /api/creative?days=30   (header x-admin-key)
// Every video running for every active client, from the saved daily reports, for the creative team.
import { getClients } from '../lib/store.mjs';
import { savedReport, PRE } from '../lib/saved.mjs';
import { cacheGet, cachePut } from '../lib/store.mjs';
import { cacheKey, resolveRange } from '../lib/range.mjs';
import { buildReport } from '../lib/ads.mjs';
import { demoReport } from '../lib/demo.mjs';
import { isCreative, jsonRes } from '../lib/auth.mjs';
import { videoRows } from '../lib/videos.mjs';
import { scopePayload, resolveScope } from '../lib/team.mjs';

export { videoRows };

export default async (req) => {
  if (!isCreative(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  const url = new URL(req.url);
  const days = PRE.includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const scope = url.searchParams.get('scope') || 'default';
  const active = (await getClients()).filter((c) => c.token && c.customer_id && !c.disabled);

  // Custom dates: one client at a time (the page asks for each client in turn), fetched live if not saved.
  const token = url.searchParams.get('token');
  if (token) {
    const c = active.find((x) => x.token === token);
    if (!c) return jsonRes({ error: 'Client not found.' }, 404);
    const r = resolveRange(url.searchParams, c.timezone);
    if (r.error) return jsonRes({ error: r.error }, 400);
    try {
      const key = cacheKey(c, r.from, r.to);
      let hit = await cacheGet(key);
      if (!hit) {
        const payload = process.env.VPM_DEV ? demoReport('demo', r.from, r.to) : await buildReport({ client: c, from: r.from, to: r.to });
        hit = { saved_at: Date.now(), payload };
        await cachePut(key, hit);
      }
      return jsonRes({ range: hit.payload.meta?.range || null, videos: videoRows(c, scopePayload(hit.payload, resolveScope(c, scope)).payload) });
    } catch (e) {
      return jsonRes({ error: c.name + ': ' + e.message, videos: [] }, 502);
    }
  }

  const missing = [], videos = [], ranges = [];
  await Promise.all(active.map(async (c) => {
    try {
      const hit = await savedReport(c, days);
      if (!hit) { missing.push(c.name); return; }
      if (hit.payload.meta?.range) ranges.push(hit.payload.meta.range);
      videos.push(...videoRows(c, scopePayload(hit.payload, resolveScope(c, scope)).payload));
    } catch { missing.push(c.name); }
  }));
  videos.sort((a, b) => b.impressions - a.impressions);
  return jsonRes({ days, range: ranges[0] || null, clients: active.map((c) => c.name).sort(), tokens: active.map((c) => ({ name: c.name, token: c.token })), missing: missing.sort(), videos });
};

export const config = { path: '/api/creative' };
