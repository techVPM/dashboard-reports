// GET /api/creative?days=30   (header x-admin-key)
// Every video running for every active client, from the saved daily reports, for the creative team.
import { getClients } from '../lib/store.mjs';
import { savedReport, PRE } from '../lib/saved.mjs';
import { cacheGet, cachePut } from '../lib/store.mjs';
import { cacheKey, resolveRange } from '../lib/range.mjs';
import { buildReport } from '../lib/ads.mjs';
import { demoReport } from '../lib/demo.mjs';
import { isCreative, jsonRes } from '../lib/auth.mjs';
import { applyGoals } from '../lib/goals.mjs';
import { scopePayload, resolveScope } from '../lib/team.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const TYPE_LBL = { video: 'Video', search: 'Search', pmax: 'Performance Max', shopping: 'Shopping', display: 'Display', other: 'Other' };

export function videoRows(client, payload) {
  const meta = payload.meta || {}, has = meta.has || {};
  const rk = has.calls ? 'calls' : has.leads ? 'leads' : has.deals ? 'deals' : 'conversions';
  const label = rk === 'conversions' ? 'Conversions' : (meta.labels?.[rk] || 'Results');
  const camps = new Map((payload.campaigns || []).map((c) => [c.id, c]));
  const by = new Map();
  for (const v of payload.items?.videos || []) {
    const k = v.video_id || v.name;
    let o = by.get(k);
    if (!o) {
      o = { client: client.name, client_token: client.token, video_id: v.video_id || '', title: v.name, duration: v.detail || '', campaigns: [], types: [], spend: 0, impressions: 0, clicks: 0, views: 0, conversions: 0, results: 0, _q: [0, 0, 0, 0] };
      by.set(k, o);
    }
    const c = camps.get(v.campaign_id);
    if (c && !o.campaigns.includes(c.name)) o.campaigns.push(c.name);
    const t = c ? TYPE_LBL[c.type] || 'Other' : '';
    if (t && !o.types.includes(t)) o.types.push(t);
    o.spend += v.spend || 0; o.impressions += v.impressions || 0; o.clicks += v.clicks || 0; o.views += v.views || 0;
    o.conversions += v.conversions || 0; o.results += v[rk] || 0;
    if (v.p25 != null) { const w = v.impressions || 0; o._q[0] += v.p25 * w; o._q[1] += v.p50 * w; o._q[2] += v.p100 * w; o._q[3] += w; }
  }
  return [...by.values()].map((o) => {
    const q = o._q; delete o._q;
    return {
      ...o, result_label: label,
      spend: r2(o.spend), conversions: r2(o.conversions), results: r2(o.results),
      ctr: o.impressions ? r4(o.clicks / o.impressions) : null,
      cvr: o.clicks ? r4(o.results / o.clicks) : null,
      cpa: o.results ? r2(o.spend / o.results) : null,
      view_rate: o.impressions && o.views ? r4(o.views / o.impressions) : null,
      cpv: o.views ? r4(o.spend / o.views) : null,
      p25: q[3] ? r4(q[0] / q[3]) : null, p50: q[3] ? r4(q[1] / q[3]) : null, p100: q[3] ? r4(q[2] / q[3]) : null,
      goal_cpa: applyGoals(client).goals.cost_per_conversion || null,
    };
  });
}

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
