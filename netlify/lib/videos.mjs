// One row per video per client, from a saved report: totals, rates, watch curve, running or paused, share of campaign spend.
import { applyGoals } from './goals.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const TYPE_LBL = { video: 'Video', search: 'Search', pmax: 'Performance Max', shopping: 'Shopping', display: 'Display', other: 'Other' };

export function videoRows(client, payload) {
  const meta = payload.meta || {}, has = meta.has || {};
  const rk = has.calls ? 'calls' : has.leads ? 'leads' : has.deals ? 'deals' : 'conversions';
  const label = rk === 'conversions' ? 'Conversions' : (meta.labels?.[rk] || 'Results');
  const camps = new Map((payload.campaigns || []).map((c) => [c.id, c]));
  const range = meta.range || {};
  const campSpend = new Map();
  for (const d of payload.daily || []) {
    if (range.from && (d.date < range.from || d.date > range.to)) continue;
    campSpend.set(d.campaign_id, (campSpend.get(d.campaign_id) || 0) + (d.spend || 0));
  }
  const by = new Map();
  for (const v of payload.items?.videos || []) {
    const k = v.video_id || v.name;
    let o = by.get(k);
    if (!o) {
      o = { client: client.name, client_token: client.token, video_id: v.video_id || '', title: v.name, duration: v.detail || '', campaigns: [], types: [], spend: 0, impressions: 0, clicks: 0, views: 0, conversions: 0, results: 0, _q: [0, 0, 0, 0, 0], _camps: new Set(), first_day: null, last_day: null };
      by.set(k, o);
    }
    const c = camps.get(v.campaign_id);
    if (c && !o.campaigns.includes(c.name)) o.campaigns.push(c.name);
    if (v.campaign_id) o._camps.add(v.campaign_id);
    if (v.first_day && (!o.first_day || v.first_day < o.first_day)) o.first_day = v.first_day;
    if (v.last_day && (!o.last_day || v.last_day > o.last_day)) o.last_day = v.last_day;
    const t = c ? TYPE_LBL[c.type] || 'Other' : '';
    if (t && !o.types.includes(t)) o.types.push(t);
    o.spend += v.spend || 0; o.impressions += v.impressions || 0; o.clicks += v.clicks || 0; o.views += v.views || 0;
    o.conversions += v.conversions || 0; o.results += v[rk] || 0;
    if (v.p25 != null) { const w = v.impressions || 0; o._q[0] += v.p25 * w; o._q[1] += (v.p50 || 0) * w; o._q[2] += (v.p100 || 0) * w; o._q[3] += w; o._q[4] += (v.p75 != null ? v.p75 : ((v.p50 || 0) + (v.p100 || 0)) / 2) * w; }
  }
  return [...by.values()].map((o) => {
    const q = o._q; delete o._q;
    let cs = 0; for (const id of o._camps) cs += campSpend.get(id) || 0; delete o._camps;
    // Running: served on the last day or the day before. New: first served in the last 7 days of the range.
    const to = range.to || null;
    const running = to && o.last_day ? o.last_day >= addDays(to, -1) : null;
    const is_new = to && o.first_day && range.from ? o.first_day > range.from && o.first_day >= addDays(to, -6) : false;
    return {
      ...o, result_label: label,
      spend: r2(o.spend), conversions: r2(o.conversions), results: r2(o.results),
      ctr: o.impressions ? r4(o.clicks / o.impressions) : null,
      cvr: o.clicks ? r4(o.results / o.clicks) : null,
      cpa: o.results ? r2(o.spend / o.results) : null,
      view_rate: o.impressions && o.views ? r4(o.views / o.impressions) : null,
      cpv: o.views ? r4(o.spend / o.views) : null,
      p25: q[3] ? r4(q[0] / q[3]) : null, p50: q[3] ? r4(q[1] / q[3]) : null, p75: q[3] ? r4(q[4] / q[3]) : null, p100: q[3] ? r4(q[2] / q[3]) : null,
      campaign_spend: r2(cs), spend_share: cs > 0 ? r4(Math.min(1, o.spend / cs)) : null,
      running, is_new, range_from: range.from || null, range_to: to,
      goal_cpa: applyGoals(client).goals.cost_per_conversion || null,
    };
  });
}

