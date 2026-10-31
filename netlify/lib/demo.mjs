// Synthetic report data in exactly the same shape the live Google Ads builder returns.
// Used for ?k=demo and ?k=demo-calls so the page can be previewed before any credentials exist.
import { addDays, daysBetween } from './ads.mjs';

function rnd(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const r2 = (v) => Math.round(v * 100) / 100;

function alloc(total, weights) {
  const s = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / s);
  const fl = raw.map(Math.floor);
  let rem = Math.round(total) - fl.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(0, rem)).forEach(([, i]) => fl[i]++);
  return fl;
}

const CAMPS = [
  { id: '1001', name: 'YouTube Demand Gen | Story Videos', channel: 'DEMAND_GEN', type: 'video', spend: 245, cpm: 17, ctr: 0.008, lead: 0.08, call: 0.28, close: 0.23, trend: 0.25 },
  { id: '1002', name: 'YouTube In-Stream | Client Stories', channel: 'VIDEO', type: 'video', spend: 172, cpm: 17, ctr: 0.007, lead: 0.08, call: 0.24, close: 0.22, trend: 0.1 },
  { id: '1003', name: 'Search | Non-Brand', channel: 'SEARCH', type: 'search', spend: 142, cpm: 70, ctr: 0.025, lead: 0.065, call: 0.24, close: 0.2, trend: 0.05 },
  { id: '1004', name: 'Search | Brand', channel: 'SEARCH', type: 'search', spend: 22, cpm: 125, ctr: 0.11, lead: 0.07, call: 0.46, close: 0.21, trend: 0.04 },
  { id: '1005', name: 'Demand Gen | Retargeting', channel: 'DEMAND_GEN', type: 'video', spend: 45, cpm: 15, ctr: 0.0085, lead: 0.07, call: 0.27, close: 0.21, trend: 0.18 },
  { id: '1006', name: 'Performance Max | Leads', channel: 'PERFORMANCE_MAX', type: 'pmax', spend: 104, cpm: 25, ctr: 0.0035, lead: 0.065, call: 0.13, close: 0.12, trend: -0.15 },
];

const ITEM_DEFS = {
  audiences: {
    1001: [['Custom: searched "how to quit drinking"', 'Custom segment', 0.34, 1.3], ['Custom: recovery channel viewers', 'Custom segment', 0.26, 1.1], ['Affinity: Health and Fitness Buffs', 'Affinity', 0.22, 0.8], ['Optimized targeting', 'Optimized', 0.18, 0.9]],
    1002: [['Custom: competitor channel viewers', 'Custom segment', 0.4, 1.1], ['Affinity: Health and Fitness Buffs', 'Affinity', 0.3, 0.9], ['Optimized targeting', 'Optimized', 0.3, 1.0]],
    1003: [['All visitors', 'Observation', 0.6, 1.0], ['Site visitors, 30 days', 'Remarketing', 0.25, 1.4], ['In-market: Wellness', 'In-market', 0.15, 0.8]],
    1004: [['All visitors', 'Observation', 0.8, 1.0], ['Past site visitors', 'Remarketing', 0.2, 1.3]],
    1005: [['Video viewers, 50%+', 'Remarketing', 0.5, 1.2], ['Site visitors, 30 days', 'Remarketing', 0.3, 1.0], ['Customer match: email list', 'Customer match', 0.2, 0.8]],
  },
  videos: {
    1001: [['Day 1 Sober: My Story', '1m 0s', 0.38, 1.25], ['Why I Quit Drinking at 38', '45s', 0.27, 1.1], ['The Gray Area Drinker', '30s', 0.2, 0.9], ['What Quitting Actually Cost Me', '15s', 0.15, 0.7]],
    1002: [['90 Days Alcohol Free', '1m 30s', 0.4, 1.2], ['Quit Without AA', '1m 15s', 0.35, 1.0], ['The SHIFT Method Explained', '2m 0s', 0.25, 0.8]],
    1005: [['Still Thinking About It?', '30s', 0.6, 1.1], ['Book Your Free Call', '20s', 0.4, 0.9]],
  },
  ads: {
    1003: [['Quit Drinking Without Willpower | Book a Free Call', 'Non-Brand | Core', 0.4, 1.1], ['Stop Drinking Coach | Free Strategy Call', 'Non-Brand | Coach', 0.35, 1.0], ['Cut Back or Quit Alcohol | The SHIFT Method', 'Non-Brand | Cut back', 0.25, 0.8], ['Is Alcohol Running Your Evenings? | Free Call', 'Non-Brand | Test 1', 0.20, 0.50], ['Quit Drinking, Keep Your Social Life', 'Non-Brand | Test 2', 0.18, 0.57], ['A Guide for Grey Area Drinkers | Book a Call', 'Non-Brand | Test 3', 0.17, 0.64], ['Stop Overthinking Drinking | Coach by Chris', 'Non-Brand | Test 4', 0.16, 0.71], ['90 Days Without Alcohol | See How', 'Non-Brand | Test 5', 0.14, 0.78], ['Sober Curious? Start Here | Free Call', 'Non-Brand | Test 6', 0.12, 0.85], ['Tired of Hangovers? | Talk to a Coach', 'Non-Brand | Test 7', 0.11, 0.92], ['Drink Less, Live More | The SHIFT Method', 'Non-Brand | Test 8', 0.10, 0.99]],
    1004: [['Official Site | Quit drinking, keep your life', 'Brand | Exact', 0.65, 1.0], ['Book a Call | Free strategy call', 'Brand | Phrase', 0.35, 1.1]],
  },
  keywords: {
    1003: [['alcohol coach', 'Exact', 0.28, 1.4], ['quit drinking coach', 'Phrase', 0.22, 1.1], ['help me stop drinking', 'Broad', 0.18, 0.9], ['alcohol therapist near me', 'Phrase', 0.17, 0.35], ['sober coach', 'Exact', 0.15, 1.2], ['alcohol coaching program', 'Phrase', 0.100, 0.40], ['stop drinking app', 'Phrase', 0.096, 0.47], ['quit alcohol for good', 'Phrase', 0.092, 0.54], ['sober curious coach', 'Phrase', 0.088, 0.61], ['how to quit drinking', 'Phrase', 0.084, 0.68], ['alcohol free lifestyle coach', 'Phrase', 0.080, 0.75], ['cut down on drinking', 'Phrase', 0.076, 0.82], ['drinking less coach', 'Phrase', 0.072, 0.89], ['online sobriety coach', 'Phrase', 0.068, 0.96], ['moderate drinking help', 'Phrase', 0.064, 0.40], ['grey area drinking', 'Phrase', 0.060, 0.47], ['alcohol coach near me', 'Phrase', 0.056, 0.54], ['1 on 1 sober coach', 'Phrase', 0.052, 0.61], ['quit drinking course', 'Phrase', 0.048, 0.68]],
    1004: [['coach by chris', 'Exact', 0.6, 1.2], ['chris shatek', 'Phrase', 0.4, 1.0]],
  },
  terms: {
    1003: [['alcohol coach', '', 0.18, 1.4], ['quit drinking coach online', '', 0.14, 1.2], ['how to stop drinking alcohol', '', 0.16, 0.5], ['alcoholics anonymous meetings', '', 0.1, 0.4], ['alcohol treatment near me', '', 0.1, 0.1], ['sober coach', '', 0.12, 1.1], ['stop drinking wine at night', '', 0.1, 0.9], ['alcohol hotline', '', 0.1, 0.05], ['how do i stop drinking every night', '', 0.080, 0.40], ['sober coach cost', '', 0.077, 0.47], ['quit drinking program online', '', 0.074, 0.54], ['alcohol coach reviews', '', 0.070, 0.61], ['am i an alcoholic quiz', '', 0.067, 0.68], ['how to stop nightly wine', '', 0.064, 0.75], ['drinking too much what to do', '', 0.061, 0.82], ['alcohol recovery coach', '', 0.058, 0.89], ['stop binge drinking', '', 0.054, 0.96], ['gray area drinking coach', '', 0.051, 0.40], ['how to cut back on alcohol', '', 0.048, 0.47], ['alcohol free january', '', 0.045, 0.54], ['sober living coach', '', 0.042, 0.61], ['dry month challenge', '', 0.038, 0.68], ['habit change coach alcohol', '', 0.035, 0.75], ['can i drink moderately', '', 0.032, 0.82], ['stop drinking at night tips', '', 0.029, 0.89], ['quit alcohol without aa', '', 0.026, 0.96]],
    1004: [['coach by chris', '', 0.5, 1.2], ['chris shatek reviews', '', 0.25, 0.1], ['chris shatek', '', 0.25, 1.0]],
  },
  landing: {
    1003: [['coachbychris.com', '', 0.82, 1.0], ['coachbychris.com/book', '', 0.18, 1.5]],
    1004: [['coachbychris.com', '', 1.0, 1.0]],
    1006: [['coachbychris.com', '', 0.7, 0.9], ['coachbychris.com/shift-method', '', 0.3, 1.2]],
  },
};
const AGE_DEFS = [['18-24', 0.04, 0.5], ['25-34', 0.14, 0.7], ['35-44', 0.28, 1.0], ['45-54', 0.27, 1.1], ['55-64', 0.19, 1.3], ['65+', 0.08, 1.0]];
const GENDER_DEFS = [['Female', 0.56, 1.15], ['Male', 0.4, 0.85], ['Unknown', 0.04, 0.4]];
const DEVICE_DEFS = [['Mobile', 0.62, 0.9], ['Desktop', 0.22, 1.2], ['TV screens', 0.12, 0.9], ['Tablet', 0.04, 1.0]];
const HOUR_W = [1, 1, 1, 1, 1, 2, 3, 5, 6, 7, 7, 6, 6, 6, 6, 6, 6, 6, 7, 8, 9, 8, 5, 2];

function buildItems(rows, camps, mode) {
  const items = { ads: [], videos: [], audiences: [], age: [], gender: [], device: [], keywords: [], terms: [], landing: [], hours: [] };
  const tot = {};
  for (const r of rows) {
    const t = (tot[r.campaign_id] ||= { spend: 0, impressions: 0, clicks: 0, views: 0, conversions: 0, leads: 0, calls: 0, deals: 0, revenue: 0 });
    for (const k of Object.keys(t)) t[k] += r[k];
  }
  const place = (kind, c, defs, extra = {}) => {
    const T = tot[c.id];
    if (!T) return;
    const sw = defs.map((d) => d[2]);
    const q = defs.map((d) => d[3]);
    const out = ['impressions', 'clicks', 'views', 'conversions', 'leads', 'calls', 'deals'].reduce((o, k, i) => {
      const w = sw.map((s, j) => s * (k === 'impressions' || k === 'views' ? 1 + 0.1 * Math.sin(j + i) : k === 'clicks' ? 0.6 + 0.4 * q[j] : q[j] ** (k === 'conversions' || k === 'leads' ? 1 : k === 'calls' ? 2 : 3)));
      o[k] = alloc(T[k], w);
      return o;
    }, {});
    const ssum = sw.reduce((a, b) => a + b, 0);
    defs.forEach((d, j) => {
      const dealsJ = out.deals[j];
      items[kind].push({
        campaign_id: c.id, name: d[0], detail: d[1] || '', ...(kind === 'ads' ? { url: 'https://example.com/free-call' } : {}), ...extra,
        spend: r2((T.spend * d[2]) / ssum), impressions: out.impressions[j], clicks: out.clicks[j], views: out.views[j],
        conversions: out.conversions[j], leads: out.leads[j], calls: out.calls[j], deals: dealsJ, revenue: dealsJ * 2400,
      });
    });
  };
  for (const c of camps) {
    for (const kind of ['audiences', 'videos', 'ads', 'keywords', 'terms', 'landing']) {
      const defs = ITEM_DEFS[kind][c.id];
      if (defs) place(kind, c, defs);
    }
    place('age', c, AGE_DEFS.map((d) => [d[0], '', d[1], d[2]]));
    place('gender', c, GENDER_DEFS.map((d) => [d[0], '', d[1], d[2]]));
    place('device', c, DEVICE_DEFS.map((d) => [d[0], '', d[1], d[2]]));
  }
  // hours: whole account
  const A = Object.values(tot).reduce((a, t) => { for (const k of Object.keys(t)) a[k] = (a[k] || 0) + t[k]; return a; }, {});
  const hw = HOUR_W;
  const al = ['impressions', 'clicks', 'conversions', 'leads', 'calls', 'deals'].reduce((o, k) => { o[k] = alloc(A[k] || 0, hw); return o; }, {});
  const hs = hw.reduce((a, b) => a + b, 0);
  hw.forEach((w, h) => items.hours.push({
    campaign_id: '', name: String(h), detail: '', spend: r2(((A.spend || 0) * w) / hs), impressions: al.impressions[h], clicks: al.clicks[h], views: 0,
    conversions: al.conversions[h], leads: al.leads[h], calls: al.calls[h], deals: al.deals[h], revenue: al.deals[h] * 2400,
  }));
  if (mode === 'calls') {
    for (const list of Object.values(items)) for (const it of list) { it.leads = 0; it.deals = 0; it.revenue = 0; }
  }
  for (const k of Object.keys(items)) items[k].sort((a, b) => b.spend - a.spend);
  return items;
}

export function demoReport(token, from, to) {
  const mode = token === 'demo-calls' ? 'calls' : 'full';
  const len = daysBetween(from, to) + 1;
  const pfrom = addDays(from, -len);
  const camps = CAMPS.map((c) => ({ id: c.id, name: c.name, status: 'ENABLED', channel: c.channel, type: c.type }));
  const rows = [];
  const total = daysBetween(pfrom, to) + 1;
  for (let i = 0; i < total; i++) {
    const date = addDays(pfrom, i);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const wk = dow === 0 || dow === 6 ? 0.82 : 1.06;
    for (const c of CAMPS) {
      const grow = 1 + c.trend * ((i - total / 2) / total);
      const spend = c.spend * wk * grow * (0.8 + 0.4 * rnd(c.id + date + 's'));
      const impressions = Math.round((spend / c.cpm) * 1000 * (0.9 + 0.2 * rnd(c.id + date + 'i')));
      const clicks = Math.round(impressions * c.ctr * (0.85 + 0.3 * rnd(c.id + date + 'k')));
      const leadsF = clicks * c.lead * (0.6 + 0.8 * rnd(c.id + date + 'l'));
      const leads = Math.floor(leadsF + rnd(c.id + date + 'lr'));
      const calls = Math.floor(leads * c.call * 1.3 + rnd(c.id + date + 'c'));
      const deals = Math.floor(calls * c.close * 1.2 + rnd(c.id + date + 'd'));
      const views = c.type === 'video' ? Math.round(impressions * 0.28) : 0;
      const conversions = mode === 'calls' ? calls + (c.channel === 'PERFORMANCE_MAX' ? Math.floor(leads * 0.6) : 0) : leads;
      rows.push({
        date, campaign_id: c.id, spend: r2(spend), impressions, clicks, views, conversions,
        leads: mode === 'calls' ? 0 : leads, calls, deals: mode === 'calls' ? 0 : deals, revenue: mode === 'calls' ? 0 : deals * 2400,
      });
    }
  }
  const cur = rows.filter((r) => r.date >= from);
  const info = {
    1003: { budget: 150, impression_share: 0.082, lost_budget: 0.31, lost_rank: 0.58 },
    1004: { budget: 25, impression_share: 0.74, lost_budget: 0.04, lost_rank: 0.22 },
  };
  for (const c of camps) Object.assign(c, info[c.id] || {});
  const full = mode === 'full';
  return {
    meta: {
      client_name: full ? 'Sample Client' : 'Sample Coaching Co',
      refreshed_at: new Date().toISOString(),
      range: { from, to, days: len },
      previous: { from: pfrom, to: addDays(from, -1) },
      currency: 'USD', timezone: 'America/Denver', demo: true,
      has: full ? { leads: true, calls: true, deals: true, revenue: true } : { leads: false, calls: true, deals: false, revenue: false },
      labels: { leads: 'Leads', calls: 'Booked calls', deals: 'Sales' },
      targets: full ? { cpl: 35, cpc: 140, roas: 3, breakeven: 2 } : { cpl: null, cpc: null, roas: null, breakeven: null },
      notes: [{ title: 'A note from your VPM team', body: 'This is sample data so you can see the layout. Real reports show your own account.' }],
      actions: [],
      term_groups: { 'Brand searches': 'chris|shatek|coach by chris', 'AA and treatment seekers': 'anonymous|treatment|hotline|rehab' },
      last_change_date: addDays(to, -6),
      warnings: [],
    },
    campaigns: camps,
    daily: rows,
    items: buildItems(cur, CAMPS, mode),
  };
}
