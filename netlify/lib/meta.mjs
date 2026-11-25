// Meta (Facebook and Instagram) ads, read-only, through the Marketing API.
//
// Netlify settings:
//   META_ACCESS_TOKEN   a system user token with ads_read only (Business settings > Users > System users)
//   META_APP_SECRET     the app's secret, used to sign every request (appsecret_proof)
//   META_API_VERSION    optional, default v23.0
//
// Each client can have meta_ad_account (act_123...) and meta_goals:
//   { focus: ['lead', 'offsite_conversion.fb_pixel_lead', ...], label: 'Leads', cost_per_result: 40 }
// Meta's results are kept separate from Google's everywhere: Meta and Google each count by their own rules.
import { createHmac } from 'node:crypto';
const DAY = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

const GRAPH = 'https://graph.facebook.com/';
export const metaConnected = (env = process.env) => !!env.META_ACCESS_TOKEN;
const act = (id) => { const d = String(id || '').replace(/^act_/i, '').replace(/\D/g, ''); return d ? 'act_' + d : ''; };

// Friendly names for Meta's action types
const NAMES = {
  lead: 'Leads (all)', 'onsite_conversion.lead_grouped': 'Leads on Facebook forms', 'offsite_conversion.fb_pixel_lead': 'Leads on the website',
  purchase: 'Purchases (all)', 'offsite_conversion.fb_pixel_purchase': 'Purchases on the website', omni_purchase: 'Purchases (all places)',
  complete_registration: 'Registrations', 'offsite_conversion.fb_pixel_complete_registration': 'Registrations on the website',
  schedule: 'Appointments scheduled', 'offsite_conversion.fb_pixel_schedule': 'Appointments on the website', contact: 'Contacts', 'offsite_conversion.fb_pixel_contact': 'Contacts on the website',
  submit_application: 'Applications', initiate_checkout: 'Checkouts started', add_to_cart: 'Added to cart', landing_page_view: 'Landing page views', link_click: 'Link clicks',
  'onsite_conversion.messaging_conversation_started_7d': 'Messages started', video_view: '3-second video views', post_engagement: 'Post engagement', page_engagement: 'Page engagement',
};
// Action types that are only engagement, never offered as a result
const NOT_RESULTS = /^(link_click|landing_page_view|video_view|post_engagement|page_engagement|post_reaction|comment|like|post|photo_view|onsite_conversion\.post_save|post_interaction_gross|post_net_like)$/;
export const actionName = (t, custom = {}) => {
  const m = String(t).match(/^offsite_conversion\.custom\.(\d+)$/);
  if (m) return (custom[m[1]] || 'Custom conversion ' + m[1]) + ' (custom)';
  return NAMES[t] || String(t).replace(/^offsite_conversion\.fb_pixel_/, '').replace(/^onsite_conversion\./, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

function client(env, fetchFn, timeoutMs = 12000) {
  const token = env.META_ACCESS_TOKEN;
  if (!token) throw Object.assign(new Error('Meta is not connected yet. Add META_ACCESS_TOKEN in Netlify.'), { status: 503 });
  const ver = env.META_API_VERSION || 'v23.0';
  const proof = env.META_APP_SECRET ? createHmac('sha256', env.META_APP_SECRET).update(token).digest('hex') : null;
  async function get(path, params = {}) {
    const q = new URLSearchParams({ ...params, access_token: token, ...(proof ? { appsecret_proof: proof } : {}) });
    let url = GRAPH + ver + '/' + path + '?' + q.toString(), out = [], pages = 0;
    while (url && pages < 20) {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
      let res, j;
      try { res = await fetchFn(url, { signal: ctl.signal }); j = await res.json().catch(() => ({})); } finally { clearTimeout(tm); }
      if (!res.ok || j.error) {
        const e = j.error || {};
        const msg = e.code === 190 ? 'The Meta token no longer works. Make a new one (README, Meta setup).' : e.code === 200 || e.code === 10 ? 'The Meta token cannot see this ad account. Assign it to the system user with View performance.' : e.code === 17 || e.code === 4 || e.code === 80004 ? 'Meta says too many requests right now. Try again in a few minutes.' : 'Meta: ' + (e.message || res.status);
        throw Object.assign(new Error(msg), { status: 502 });
      }
      if (!Array.isArray(j.data)) return j;
      out = out.concat(j.data); url = j.paging?.next || null; pages++;
    }
    return out;
  }
  return { get };
}

const num = (v) => Number(v) || 0;
const count = (arr, types) => { let n = 0; for (const a of arr || []) if (types.has(a.action_type)) n += num(a.value); return n; };
// When nothing is picked yet: leads if there are any, otherwise purchases
function defaultFocus(rows) {
  const seen = new Set(); for (const r of rows) for (const a of r.actions || []) seen.add(a.action_type);
  for (const t of ['lead', 'purchase', 'complete_registration', 'schedule', 'contact']) if (seen.has(t)) return [t];
  return [];
}

/* ---------- the conversion events in an account, for the picker in Clients and goals ---------- */
export async function listMetaConversions(account, { env = process.env, fetchFn = fetch } = {}) {
  const M = client(env, fetchFn);
  const id = act(account); if (!id) throw Object.assign(new Error('Add the Meta ad account ID first.'), { status: 400 });
  const [rows, customs] = await Promise.all([
    M.get(id + '/insights', { date_preset: 'last_30d', fields: 'actions', level: 'account' }),
    M.get(id + '/customconversions', { fields: 'id,name', limit: '200' }).catch(() => []),
  ]);
  const cmap = {}; for (const c of customs || []) cmap[c.id] = c.name;
  const tot = new Map();
  for (const r of rows || []) for (const a of r.actions || []) if (!NOT_RESULTS.test(a.action_type)) tot.set(a.action_type, (tot.get(a.action_type) || 0) + num(a.value));
  for (const c of customs || []) { const k = 'offsite_conversion.custom.' + c.id; if (!tot.has(k)) tot.set(k, 0); }
  return [...tot.entries()].map(([type, n]) => ({ type, name: actionName(type, cmap), count30: Math.round(n) })).sort((a, b) => b.count30 - a.count30);
}

/* ---------- one report's worth of Meta data ---------- */
export async function buildMeta({ client: c, from, to, env = process.env, fetchFn = fetch }) {
  const id = act(c.meta_ad_account);
  if (!id || !metaConnected(env) || c.platforms === 'google') return null;
  const M = client(env, fetchFn);
  const len = daysBetween(from, to) + 1, pfrom = addDays(from, -len), pto = addDays(from, -1);
  const tr = (a, b) => JSON.stringify({ since: a, until: b });
  const F = 'campaign_id,campaign_name,objective,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,video_thruplay_watched_actions';
  const [daily, totNow, totPrev, adRows, customs] = await Promise.all([
    M.get(id + '/insights', { level: 'campaign', time_increment: '1', time_range: tr(pfrom, to), fields: F, limit: '500' }),
    M.get(id + '/insights', { level: 'account', time_range: tr(from, to), fields: 'reach,frequency,impressions' }),
    M.get(id + '/insights', { level: 'account', time_range: tr(pfrom, pto), fields: 'reach,frequency,impressions' }),
    M.get(id + '/insights', { level: 'ad', time_range: tr(from, to), fields: 'ad_id,ad_name,campaign_id,spend,impressions,clicks,inline_link_clicks,actions,video_thruplay_watched_actions', limit: '200', sort: 'spend_descending' }),
    M.get(id + '/customconversions', { fields: 'id,name', limit: '200' }).catch(() => []),
  ]);
  const cmap = {}; for (const x of customs || []) cmap[x.id] = x.name;
  const mg = c.meta_goals || {};
  const focus = new Set((mg.focus && mg.focus.length ? mg.focus : defaultFocus(daily)));
  const label = mg.label || (focus.size === 1 ? actionName([...focus][0], cmap).replace(/ \(all\)$/, '').replace(/ on the website$| on Facebook forms$/, '') : 'Results');

  const rowsOf = (r) => ({ spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.inline_link_clicks || r.clicks), results: count(r.actions, focus), revenue: (r.action_values || []).filter((a) => focus.has(a.action_type)).reduce((s, a) => s + num(a.value), 0), thruplays: count(r.video_thruplay_watched_actions, new Set(['video_view'])) });
  const dailyRows = (daily || []).map((r) => ({ date: r.date_start, campaign_id: r.campaign_id, ...rowsOf(r) }));
  const campaigns = new Map();
  for (const r of daily || []) if (!campaigns.has(r.campaign_id)) campaigns.set(r.campaign_id, { id: r.campaign_id, name: r.campaign_name, objective: String(r.objective || '').replace(/^OUTCOME_/, '').toLowerCase() });

  // ad thumbnails and text, for the ads list
  const ads = (adRows || []).slice(0, 60).map((r) => ({ id: r.ad_id, name: r.ad_name, campaign_id: r.campaign_id, ...rowsOf(r) }));
  if (ads.length) {
    try {
      const det = await M.get('', { ids: ads.map((a) => a.id).join(','), fields: 'creative{thumbnail_url,image_url,title,body,object_type,video_id,effective_object_story_id}', thumbnail_width: '480', thumbnail_height: '480' });
      for (const a of ads) {
        const cr = det?.[a.id]?.creative || {};
        a.thumb = cr.image_url || cr.thumbnail_url || ''; a.title = cr.title || ''; a.body = cr.body || ''; a.video = !!cr.video_id;
        a.post = cr.effective_object_story_id ? 'https://www.facebook.com/' + cr.effective_object_story_id : '';
      }
    } catch { /* thumbnails are optional */ }
  }
  const t0 = (totNow && totNow[0]) || {}, t1 = (totPrev && totPrev[0]) || {};
  return {
    account: id, label, focus: [...focus], focus_names: [...focus].map((t) => actionName(t, cmap)),
    goal: { cost_per_result: Number(mg.cost_per_result) || null, monthly_spend: Number(mg.monthly_spend) || null },
    reach: { now: num(t0.reach), prev: num(t1.reach), frequency: num(t0.frequency), prev_frequency: num(t1.frequency) },
    campaigns: [...campaigns.values()], daily: dailyRows, ads, picked: !!(mg.focus && mg.focus.length),
  };
}

// The same shape with made-up numbers, for the preview and the sample report.
export function demoMeta(from, to, seed = 7) {
  const len = daysBetween(from, to) + 1, pfrom = addDays(from, -len);
  let s = seed; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const camps = [{ id: 'm1', name: 'VPM | Leads | Video testimonials', objective: 'leads' }, { id: 'm2', name: 'VPM | Retargeting | Website visitors', objective: 'leads' }, { id: 'm3', name: 'Awareness | Founder story (client run)', objective: 'awareness' }];
  const daily = [];
  for (let i = 0; i < len * 2; i++) {
    const date = addDays(pfrom, i), lift = i >= len ? 1.12 : 1;
    camps.forEach((c, k) => {
      const spend = (k === 0 ? 95 : k === 1 ? 40 : 30) * (0.8 + rnd() * 0.4) * lift;
      const impressions = Math.round(spend * (k === 2 ? 160 : 70));
      const clicks = Math.round(impressions * (k === 2 ? 0.006 : 0.012));
      daily.push({ date, campaign_id: c.id, spend: Math.round(spend * 100) / 100, impressions, clicks, results: k === 2 ? 0 : Math.round(clicks * (k === 1 ? 0.16 : 0.1) * (0.6 + rnd() * 0.8) * lift), revenue: 0, thruplays: Math.round(impressions * 0.08) });
    });
  }
  const sum = (cid) => daily.filter((d) => d.campaign_id === cid && d.date >= from).reduce((o, d) => ({ spend: o.spend + d.spend, impressions: o.impressions + d.impressions, clicks: o.clicks + d.clicks, results: o.results + d.results, thruplays: o.thruplays + d.thruplays }), { spend: 0, impressions: 0, clicks: 0, results: 0, thruplays: 0 });
  const ads = [
    ['Testimonial: Sarah, 6 weeks in', 'm1', 0.42], ['Founder story, 60s', 'm3', 0.5], ['Before and after carousel', 'm1', 0.3], ['Retargeting: book your call', 'm2', 1], ['Testimonial: Mike', 'm1', 0.28],
  ].map(([name, cid, share], i) => { const t = sum(cid); return { id: 'ad' + i, name, campaign_id: cid, spend: Math.round(t.spend * share), impressions: Math.round(t.impressions * share), clicks: Math.round(t.clicks * share), results: Math.round(t.results * share), revenue: 0, thruplays: Math.round(t.thruplays * share), thumb: '', title: name, body: '', video: i !== 2 }; });
  return { account: 'act_demo', label: 'Leads', focus: ['lead'], focus_names: ['Leads (all)'], goal: { cost_per_result: 45 }, reach: { now: Math.round(len * 1450), prev: Math.round(len * 1320), frequency: 2.4, prev_frequency: 2.2 }, campaigns: camps, daily, ads, picked: true };
}
