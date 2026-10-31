// Turns a saved 30-day report into one row of the team dashboard, judged against the client's goals.
import { applyGoals, cleanGoals } from './goals.mjs';
import { normName, digits } from './ads.mjs';

const r2 = (v) => Math.round(v * 100) / 100;
const RANK = { bad: 3, warn: 2, good: 1, none: 0 };
const TYPE_LBL = { video: 'Video', search: 'Search', pmax: 'Performance Max', shopping: 'Shopping', display: 'Display', other: 'Other' };

export function adsLink(client) {
  if (client.ads_url && /^https:\/\//.test(client.ads_url)) return client.ads_url;
  return 'https://ads.google.com/aw/overview?__c=' + digits(client.customer_id);
}

function grade(kind, actual, goal, extra) {
  if (actual == null) return 'bad';
  if (kind === 'cost') return actual <= goal ? 'good' : actual <= goal * 1.15 ? 'warn' : 'bad';
  if (kind === 'volume') return actual >= goal ? 'good' : actual >= goal * 0.85 ? 'warn' : 'bad';
  if (kind === 'spend') return actual > goal * 1.2 || actual < goal * 0.6 ? 'bad' : actual > goal * 1.05 || actual < goal * 0.85 ? 'warn' : 'good';
  if (kind === 'roas') return actual >= goal ? 'good' : actual >= goal * 0.85 ? 'warn' : 'bad';
  return 'none';
}

export function summarize(client, payload, savedAt) {
  const { goals } = applyGoals(client);
  const meta = payload.meta || {};
  const from = meta.range?.from, days = meta.range?.days || 30, scale = 30 / days;
  const has = meta.has || {};
  const rk = has.calls ? 'calls' : has.leads ? 'leads' : has.deals ? 'deals' : 'conversions';
  const label = rk === 'conversions' ? 'Conversions' : (meta.labels?.[rk] || 'Results');
  const typeOf = new Map((payload.campaigns || []).map((c) => [c.id, c.type]));
  const cur = { spend: 0, res: 0, rev: 0 }, prev = { spend: 0, res: 0, rev: 0 }, byType = {}, byCamp = new Map();
  for (const d of payload.daily || []) {
    const t = d.date >= from ? cur : prev;
    t.spend += d.spend; t.res += d[rk] || 0; t.rev += d.revenue || 0;
    if (d.date >= from) {
      const ty = typeOf.get(d.campaign_id) || 'other';
      byType[ty] = (byType[ty] || 0) + d.spend;
      const c = byCamp.get(d.campaign_id) || { spend: 0, res: 0 };
      c.spend += d.spend; c.res += d[rk] || 0; byCamp.set(d.campaign_id, c);
    }
  }
  const cpa = cur.res ? cur.spend / cur.res : null, pcpa = prev.res ? prev.spend / prev.res : null;
  const checks = [];
  if (goals.cost_per_conversion) {
    const g = goals.cost_per_conversion;
    checks.push({ key: 'cpa', label: 'Cost per ' + label.toLowerCase().replace(/s$/, ''), actual: cpa == null ? null : r2(cpa), goal: g, low: goals.cpa_low, unit: 'money2', status: cur.spend < 50 ? 'none' : grade('cost', cpa, g) });
  }
  if (goals.monthly_spend) checks.push({ key: 'spend', label: 'Spend per 30 days', actual: r2(cur.spend * scale), goal: goals.monthly_spend, unit: 'money', status: grade('spend', cur.spend * scale, goals.monthly_spend) });
  for (const s of goals.spend_by_type) {
    const act = s.types.reduce((a, t) => a + (byType[t] || 0), 0) * scale;
    checks.push({ key: 'spend-' + s.types.join('+'), label: s.types.map((t) => TYPE_LBL[t]).join(' + ') + ' spend per 30 days', actual: r2(act), goal: s.amount, unit: 'money', status: grade('spend', act, s.amount) });
  }
  if (goals.monthly_conversions) checks.push({ key: 'vol', label: label + ' per 30 days', actual: r2(cur.res * scale), goal: goals.monthly_conversions, unit: 'int', status: grade('volume', cur.res * scale, goals.monthly_conversions) });
  if (goals.weekly_conversions) checks.push({ key: 'volw', label: label + ' per week', actual: r2(cur.res * 7 / days), goal: goals.weekly_conversions, unit: 'int', status: grade('volume', cur.res * 7 / days, goals.weekly_conversions) });
  if (goals.roas && has.revenue) { const ro = cur.spend ? cur.rev / cur.spend : null; checks.push({ key: 'roas', label: 'Return on ad spend', actual: ro == null ? null : r2(ro), goal: goals.roas, unit: 'x', status: grade('roas', ro, goals.roas) }); }
  const overall = checks.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'none');

  const focus = new Set(goals.focus_conversions.map(normName));
  const watch = new Set(goals.secondary_conversions.map(normName));
  const actions = (meta.conversion_actions || []).map((a) => ({ ...a, focus: focus.has(normName(a.name)) || !!a.role, watch: watch.has(normName(a.name)) }));
  const missing = [...goals.focus_conversions, ...goals.secondary_conversions].filter((n) => !actions.some((a) => normName(a.name) === normName(n)));
  const camps = (payload.campaigns || []).map((c) => { const x = byCamp.get(c.id) || { spend: 0, res: 0 }; return { name: c.name, type: TYPE_LBL[c.type] || 'Other', spend: r2(x.spend), res: r2(x.res), cpa: x.res ? r2(x.spend / x.res) : null }; })
    .filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);

  return {
    token: client.token, name: client.name, customer_id: client.customer_id,
    report_url: '/' + client.token, ads_url: adsLink(client),
    updated: meta.refreshed_at || (savedAt ? new Date(savedAt).toISOString() : null),
    range: meta.range, label,
    spend: r2(cur.spend), results: r2(cur.res), cpa: cpa == null ? null : r2(cpa),
    prev: { spend: r2(prev.spend), results: r2(prev.res), cpa: pcpa == null ? null : r2(pcpa) },
    by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [TYPE_LBL[k] || k, r2(v)])),
    checks, overall, goal_note: goals.note, actions, missing_conversions: missing, campaigns: camps.slice(0, 12),
    has_goals: goals.any,
  };
}

export function emptyRow(client, why) {
  return { token: client.token, name: client.name, customer_id: client.customer_id, report_url: '/' + client.token, ads_url: adsLink(client), missing: true, why, has_goals: cleanGoals(client.goals).any, checks: [], overall: 'none' };
}
