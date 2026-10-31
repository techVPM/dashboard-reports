// Google Ads REST client + report builder.
// Talks to the Google Ads API directly through the VPM manager account (MCC).
// No connector, no per-account limit: any client account under the MCC can be reported on.

import { applyGoals } from './goals.mjs';

const DAY = 864e5;
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
export const digits = (s) => String(s || '').replace(/\D/g, '');

export function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export class AdsError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Google retired developer tokens on 2026-09-09. Access is now decided by the Google Cloud project
// that owns the OAuth client, so GOOGLE_ADS_DEVELOPER_TOKEN is optional and ignored by Google.
// It is only sent if you still have one set (Google has said future versions will reject it, so leave it empty).
export const DEFAULT_VERSION = 'v25';

// Pasted values often carry spaces, line breaks or quote marks. Strip them.
const clean = (v) => String(v == null ? '' : v).trim().replace(/^["']+|["']+$/g, '').trim();

export function envConfig(input = process.env) {
  const env = Object.fromEntries(Object.keys(input).filter((k) => k.startsWith('GOOGLE_ADS_')).map((k) => [k, clean(input[k])]));
  const need = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new AdsError('Missing settings: ' + missing.join(', '), 500);
  return {
    devToken: String(env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
    clientId: env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    version: env.GOOGLE_ADS_API_VERSION || DEFAULT_VERSION,
  };
}

// Plain-language hints for the errors Google returns now that access is tied to the Cloud project.
export function explainError(status, text) {
  const t = String(text || '');
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION/.test(t)) return 'The Google Cloud project behind these credentials only has Test access. Apply for Explorer or Basic access on its Google Ads API page in Cloud Console (README Part 3).';
  if (/DEVELOPER_TOKEN|developer.token/i.test(t) && status === 401) return 'Google rejected the developer token. Delete GOOGLE_ADS_DEVELOPER_TOKEN from the Netlify settings, it is no longer used.';
  if (/RESOURCE_EXHAUSTED|RATE_EXCEEDED|QUOTA/.test(t) || status === 429) return 'The daily operations limit for the Cloud project was reached. Check the access level (Explorer allows 2,880 a day) or reduce the refresh load (README Part 3).';
  if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND|login-customer-id/i.test(t)) return 'This Google login cannot see that client account under the MCC. Check the customer_id in clients.json and that the account is linked to the MCC.';
  if (/AUTHORIZATION_ERROR/.test(t)) return 'Google refused production access for this Cloud project. This is a known issue for some freshly upgraded projects, so try again later, or re-check the access level in Cloud Console.';
  if (/is not a valid|UNSUPPORTED_VERSION|sunset|deprecated/i.test(t) && /version|v\d+/i.test(t)) return 'This Google Ads API version may be retired. Set GOOGLE_ADS_API_VERSION to a newer one (README Part 3).';
  return '';
}

let tokenCache = { value: null, exp: 0 };
export async function getAccessToken(env = process.env, fetchFn = fetch) {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const c = envConfig(env);
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    const why = j.error === 'invalid_client' ? 'Google rejected the client ID or client secret. Re-paste both with no spaces or quote marks, and check they belong to the same OAuth client.'
      : j.error === 'invalid_grant' ? 'Google rejected the refresh token. It may have expired or been made with a different OAuth client, so create a new one.'
      : 'Check the Google settings in Netlify.';
    throw new AdsError('Google sign-in failed (' + (j.error || res.status) + '). ' + why, 502, j);
  }
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.value;
}
export function resetTokenCache() { tokenCache = { value: null, exp: 0 }; }

// One GAQL query -> flat array of result rows (camelCase JSON as the REST API returns it).
// Fields that are nice to have. If a newer API version drops or renames one, the query is retried without it.
const OPTIONAL_FIELDS = ['metrics.video_views'];
const dropField = (q, f) => q.replace(new RegExp(',\\s*' + f.replace(/\./g, '\\.')), '');

export async function runQuery(customerId, query, { env = process.env, fetchFn = fetch, timeoutMs = 9000, retried = false } = {}) {
  const c = envConfig(env);
  const token = await getAccessToken(env, fetchFn);
  const url = `https://googleads.googleapis.com/${c.version}/customers/${digits(customerId)}/googleAds:searchStream`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          ...(c.devToken ? { 'developer-token': c.devToken } : {}),
          'login-customer-id': c.loginCustomerId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = 'Google Ads error ' + res.status;
        try {
          const e = JSON.parse(text);
          const x = Array.isArray(e) ? e[0] : e;
          msg += ': ' + (x?.error?.details?.[0]?.errors?.[0]?.message || x?.error?.message || '');
        } catch { /* ignore */ }
        const bad = res.status === 400 && !retried ? (text.match(/Unrecognized field in the query: '([^']+)'/) || [])[1] : null;
        if (bad && OPTIONAL_FIELDS.includes(bad)) return runQuery(customerId, dropField(query, bad), { env, fetchFn, timeoutMs, retried: true });
        const hint = explainError(res.status, text);
        if (hint) msg += ' ' + hint;
        const err = new AdsError(msg, res.status, text.slice(0, 500));
        if ((res.status === 429 || res.status === 503) && attempt === 0) { lastErr = err; await new Promise((r) => setTimeout(r, 800)); continue; }
        throw err;
      }
      const parsed = JSON.parse(text);
      const batches = Array.isArray(parsed) ? parsed : [parsed];
      return batches.flatMap((b) => b.results || []);
    } catch (e) {
      if (e instanceof AdsError) throw e;
      lastErr = new AdsError('Request to Google Ads failed: ' + (e.name === 'TimeoutError' ? 'timed out' : e.message), 504);
      if (attempt === 1) throw lastErr;
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ */
/* Query definitions                                                    */
/* ------------------------------------------------------------------ */

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const r2 = (v) => Math.round(v * 100) / 100;
const MX = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions';
const MV = MX + ', metrics.video_views';

const CHANNEL_TYPE = { SEARCH: 'search', VIDEO: 'video', DEMAND_GEN: 'video', PERFORMANCE_MAX: 'pmax', SHOPPING: 'shopping', DISPLAY: 'display' };

function adName(r) {
  const ad = r.adGroupAd?.ad || {};
  const h = ad.responsiveSearchAd?.headlines;
  if (Array.isArray(h) && h.length) return h.slice(0, 2).map((x) => x.text).filter(Boolean).join(' | ');
  if (ad.name) return ad.name;
  const t = String(ad.type || 'AD').replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1) + ' ' + String(ad.id || '').slice(-4);
}
const pretty = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const AGE = { AGE_RANGE_18_24: '18-24', AGE_RANGE_25_34: '25-34', AGE_RANGE_35_44: '35-44', AGE_RANGE_45_54: '45-54', AGE_RANGE_55_64: '55-64', AGE_RANGE_65_UP: '65+', AGE_RANGE_UNDETERMINED: 'Unknown' };
const GENDER = { MALE: 'Male', FEMALE: 'Female', UNDETERMINED: 'Unknown' };
const DEVICE = { MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'TV screens', OTHER: 'Other' };

// Each item query: a base query (spend and clicks), plus an optional conversion-action split query
// that is joined on `key`. The split is only run when the client maps conversion actions to outcomes.
export const ITEM_SPECS = [
  {
    kind: 'ads', from: 'ad_group_ad', video: true, order: true, limit: 100,
    fields: ['campaign.id', 'ad_group.id', 'ad_group.name', 'ad_group_ad.ad.id', 'ad_group_ad.ad.name', 'ad_group_ad.ad.type', 'ad_group_ad.ad.final_urls', 'ad_group_ad.ad.responsive_search_ad.headlines'],
    keyFields: ['ad_group.id', 'ad_group_ad.ad.id'],
    key: (r) => r.adGroup?.id + '|' + r.adGroupAd?.ad?.id,
    item: (r) => ({ campaign_id: r.campaign.id, name: adName(r), detail: r.adGroup?.name || '', url: String(r.adGroupAd?.ad?.finalUrls?.[0] || '') }),
  },
  {
    kind: 'videos', from: 'video', video: true, order: true, limit: 60,
    fields: ['campaign.id', 'video.id', 'video.title', 'video.duration_millis'],
    keyFields: ['campaign.id', 'video.id'],
    key: (r) => r.campaign?.id + '|' + r.video?.id,
    item: (r) => {
      const s = Math.round(num(r.video?.durationMillis) / 1000);
      return { campaign_id: r.campaign.id, name: r.video?.title || 'Video ' + String(r.video?.id || ''), detail: s ? (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's') : '', video_id: r.video?.id };
    },
  },
  {
    kind: 'audiences', from: 'ad_group_audience_view', order: true, limit: 120,
    fields: ['campaign.id', 'ad_group.id', 'ad_group_criterion.criterion_id', 'ad_group_criterion.display_name', 'ad_group_criterion.type'],
    keyFields: ['ad_group.id', 'ad_group_criterion.criterion_id'],
    key: (r) => r.adGroup?.id + '|' + r.adGroupCriterion?.criterionId,
    item: (r) => ({ campaign_id: r.campaign.id, name: r.adGroupCriterion?.displayName || pretty(r.adGroupCriterion?.type), detail: pretty(r.adGroupCriterion?.type) }),
  },
  {
    kind: 'audiences', from: 'campaign_audience_view', order: true, limit: 120,
    fields: ['campaign.id', 'campaign_criterion.criterion_id', 'campaign_criterion.display_name', 'campaign_criterion.type'],
    keyFields: ['campaign.id', 'campaign_criterion.criterion_id'],
    key: (r) => r.campaign?.id + '|' + r.campaignCriterion?.criterionId,
    item: (r) => ({ campaign_id: r.campaign.id, name: r.campaignCriterion?.displayName || pretty(r.campaignCriterion?.type), detail: pretty(r.campaignCriterion?.type) }),
  },
  {
    kind: 'age', from: 'age_range_view',
    fields: ['campaign.id', 'ad_group_criterion.age_range.type'],
    keyFields: ['campaign.id', 'ad_group_criterion.age_range.type'],
    key: (r) => r.campaign?.id + '|' + r.adGroupCriterion?.ageRange?.type,
    item: (r) => ({ campaign_id: r.campaign.id, name: AGE[r.adGroupCriterion?.ageRange?.type] || pretty(r.adGroupCriterion?.ageRange?.type), detail: '' }),
  },
  {
    kind: 'gender', from: 'gender_view',
    fields: ['campaign.id', 'ad_group_criterion.gender.type'],
    keyFields: ['campaign.id', 'ad_group_criterion.gender.type'],
    key: (r) => r.campaign?.id + '|' + r.adGroupCriterion?.gender?.type,
    item: (r) => ({ campaign_id: r.campaign.id, name: GENDER[r.adGroupCriterion?.gender?.type] || pretty(r.adGroupCriterion?.gender?.type), detail: '' }),
  },
  {
    kind: 'device', from: 'campaign',
    fields: ['campaign.id', 'segments.device'],
    keyFields: ['campaign.id', 'segments.device'],
    key: (r) => r.campaign?.id + '|' + r.segments?.device,
    item: (r) => ({ campaign_id: r.campaign.id, name: DEVICE[r.segments?.device] || pretty(r.segments?.device), detail: '' }),
  },
  {
    kind: 'keywords', from: 'keyword_view', order: true, limit: 100, extraWhere: 'ad_group_criterion.negative = FALSE',
    fields: ['campaign.id', 'ad_group.id', 'ad_group.name', 'ad_group_criterion.criterion_id', 'ad_group_criterion.keyword.text', 'ad_group_criterion.keyword.match_type'],
    keyFields: ['ad_group.id', 'ad_group_criterion.criterion_id'],
    key: (r) => r.adGroup?.id + '|' + r.adGroupCriterion?.criterionId,
    item: (r) => ({ campaign_id: r.campaign.id, name: r.adGroupCriterion?.keyword?.text || '', detail: pretty(r.adGroupCriterion?.keyword?.matchType) }),
  },
  {
    kind: 'terms', from: 'search_term_view', order: true, limit: 300,
    fields: ['campaign.id', 'search_term_view.search_term'],
    keyFields: ['campaign.id', 'search_term_view.search_term'],
    key: (r) => r.campaign?.id + '|' + r.searchTermView?.searchTerm,
    item: (r) => ({ campaign_id: r.campaign.id, name: r.searchTermView?.searchTerm || '', detail: '' }),
  },
  {
    kind: 'landing', from: 'landing_page_view', order: true, limit: 30,
    fields: ['campaign.id', 'landing_page_view.unexpanded_final_url'],
    keyFields: ['campaign.id', 'landing_page_view.unexpanded_final_url'],
    key: (r) => r.campaign?.id + '|' + r.landingPageView?.unexpandedFinalUrl,
    item: (r) => ({ campaign_id: r.campaign.id, name: String(r.landingPageView?.unexpandedFinalUrl || '').replace(/^https?:\/\//, ''), detail: '' }),
  },
  {
    kind: 'hours', from: 'campaign',
    fields: ['segments.hour'],
    keyFields: ['segments.hour'],
    key: (r) => String(r.segments?.hour),
    item: (r) => ({ campaign_id: '', name: String(r.segments?.hour), detail: '' }),
  },
];

const dateWhere = (a, b) => `segments.date BETWEEN '${a}' AND '${b}'`;

// Paused (and removed) campaigns are left out unless the client has include_paused set.
export const statusWhere = (client) => (client && client.include_paused ? '' : "campaign.status = 'ENABLED'");

export function baseQuery(spec, from, to, statusClause = '') {
  const where = [dateWhere(from, to), 'metrics.impressions > 0'];
  if (statusClause) where.push(statusClause);
  if (spec.extraWhere) where.push(spec.extraWhere);
  return `SELECT ${spec.fields.join(', ')}, ${spec.video ? MV : MX} FROM ${spec.from} WHERE ${where.join(' AND ')}` +
    (spec.order ? ` ORDER BY metrics.cost_micros DESC LIMIT ${spec.limit}` : '');
}
export function splitQuery(spec, from, to, convField, statusClause = '') {
  const where = [dateWhere(from, to), `metrics.${convField} > 0`];
  if (statusClause) where.push(statusClause);
  if (spec.extraWhere) where.push(spec.extraWhere);
  return `SELECT ${spec.keyFields.join(', ')}, segments.conversion_action_name, metrics.${convField}, metrics.${convField}_value FROM ${spec.from} WHERE ${where.join(' AND ')}`;
}

/* ------------------------------------------------------------------ */
/* Report builder                                                       */
/* ------------------------------------------------------------------ */

// Conversion names match without regard to capitals, extra spaces or the kind of dash used.
export const normName = (n) => String(n || '').toLowerCase().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();

// Which outcome does a Google conversion action name count as?
export function makeClassifier(outcomes) {
  const map = new Map();
  for (const role of ['leads', 'calls', 'deals']) {
    for (const n of outcomes?.[role] || []) map.set(normName(n), role);
  }
  return { configured: map.size > 0, roles: (n) => map.get(normName(n)) || null };
}

function emptyAgg() {
  return { spend: 0, impressions: 0, clicks: 0, views: 0, conversions: 0, leads: 0, calls: 0, deals: 0, revenue: 0, _v: { leads: 0, calls: 0, deals: 0 } };
}
function addMetrics(o, r) {
  const m = r.metrics || {};
  o.spend += num(m.costMicros) / 1e6;
  o.impressions += num(m.impressions);
  o.clicks += num(m.clicks);
  o.views += num(m.videoViews);
  o.conversions += num(m.conversions);
}
function addSplit(o, role, conv, value) {
  if (!role) return;
  o[role] += conv;
  o._v[role] += value;
}
function finish(o, classifier, dealValue) {
  if (!classifier.configured) {
    o.leads = o.conversions; o.calls = 0; o.deals = 0; o.revenue = 0;
  } else {
    o.revenue = o._v.deals > 0 ? o._v.deals : o.deals * (dealValue || 0);
  }
  delete o._v;
  for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = r2(o[k]);
  return o;
}

async function settle(label, promise, warnings) {
  try { return await promise; } catch (e) { warnings.push(label + ': ' + e.message); return null; }
}

export async function buildReport({ client: rawClient, from, to, env = process.env, fetchFn = fetch, now = new Date() }) {
  const { client, goals } = applyGoals(rawClient);
  const customerId = digits(client.customer_id);
  const opts = { env, fetchFn };
  const classifier = makeClassifier(client.outcomes);
  const convField = client.conversion_field === 'all_conversions' ? 'all_conversions' : 'conversions';
  const len = daysBetween(from, to) + 1;
  const pfrom = addDays(from, -len);
  const pto = addDays(from, -1);
  const warnings = [];
  const sw = statusWhere(client);
  const andSw = sw ? ' AND ' + sw : '';

  // Core: daily campaign rows for the previous and current period.
  const coreP = runQuery(customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, ${MV}, metrics.conversions_value ` +
    `FROM campaign WHERE ${dateWhere(pfrom, to)} AND metrics.impressions > 0${andSw}`, opts);
  const convP = classifier.configured
    ? runQuery(customerId,
        `SELECT campaign.id, segments.date, segments.conversion_action_name, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM campaign ` +
        `WHERE ${dateWhere(pfrom, to)} AND metrics.all_conversions > 0${andSw}`, opts)
    : Promise.resolve([]);
  const infoP = settle('impression share',
    runQuery(customerId,
      `SELECT campaign.id, campaign_budget.amount_micros, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share ` +
      `FROM campaign WHERE ${dateWhere(from, to)} AND campaign.advertising_channel_type = 'SEARCH' AND metrics.impressions > 0${andSw}`, opts), warnings);

  const itemPs = ITEM_SPECS.map((spec) => ({
    spec,
    base: settle(spec.kind, runQuery(customerId, baseQuery(spec, from, to, sw), opts), warnings),
    split: classifier.configured
      ? settle(spec.kind + ' (conversion split)', runQuery(customerId, splitQuery(spec, from, to, convField, sw), opts), warnings)
      : Promise.resolve(null),
  }));

  const [core, conv, info] = await Promise.all([coreP, convP, infoP]);

  // ----- campaigns + daily
  const campaigns = new Map();
  const daily = new Map();
  for (const r of core) {
    const cid = r.campaign.id;
    if (!campaigns.has(cid)) {
      campaigns.set(cid, {
        id: cid, name: r.campaign.name, status: r.campaign.status,
        channel: r.campaign.advertisingChannelType, type: CHANNEL_TYPE[r.campaign.advertisingChannelType] || 'other',
      });
    }
    const k = cid + '|' + r.segments.date;
    if (!daily.has(k)) daily.set(k, { date: r.segments.date, campaign_id: cid, ...emptyAgg() });
    addMetrics(daily.get(k), r);
  }
  const actions = new Map();
  for (const r of conv) {
    const m = r.metrics || {};
    const name = r.segments.conversionActionName || '';
    const role = classifier.roles(name);
    const c = num(m[convField]);
    const v = num(m[convField + 'Value']);
    // per-action totals (primary or not) for the conversion breakdown
    const a = actions.get(name) || { name, role, cur: 0, prev: 0 };
    const cnt = Math.max(num(m.conversions), num(m.allConversions), c);
    if (r.segments.date >= from) a.cur += cnt; else a.prev += cnt;
    actions.set(name, a);
    const d = daily.get(r.campaign.id + '|' + r.segments.date);
    if (!d) continue;
    addSplit(d, role, c, v);
  }
  const conversionActions = [...actions.values()].map((a) => ({ ...a, cur: r2(a.cur), prev: r2(a.prev) }))
    .sort((a, b) => b.cur - a.cur).slice(0, 25);
  const dailyRows = [...daily.values()]
    .map((d) => finish(d, classifier, client.deal_value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const r of info || []) {
    const c = campaigns.get(r.campaign.id);
    if (!c) continue;
    const m = r.metrics || {};
    c.budget = r2(num(r.campaignBudget?.amountMicros) / 1e6);
    c.impression_share = m.searchImpressionShare != null ? r2(num(m.searchImpressionShare)) : null;
    c.lost_budget = m.searchBudgetLostImpressionShare != null ? r2(num(m.searchBudgetLostImpressionShare)) : null;
    c.lost_rank = m.searchRankLostImpressionShare != null ? r2(num(m.searchRankLostImpressionShare)) : null;
  }

  // ----- items
  const items = {};
  for (const { spec, base, split } of itemPs) {
    const baseRows = await base;
    if (!baseRows) continue;
    const splitRows = await split;
    const map = new Map();
    for (const r of baseRows) {
      const k = spec.key(r);
      if (!map.has(k)) map.set(k, { ...spec.item(r), ...emptyAgg() });
      addMetrics(map.get(k), r);
    }
    if (splitRows) {
      for (const r of splitRows) {
        const it = map.get(spec.key(r));
        if (!it) continue;
        const m = r.metrics || {};
        addSplit(it, classifier.roles(r.segments.conversionActionName), num(m[convField]), num(m[convField + 'Value']));
      }
    }
    const list = [...map.values()].map((it) => finish(it, classifier, client.deal_value));
    items[spec.kind] = (items[spec.kind] || []).concat(list);
  }
  if (items.hours) {
    // fold any duplicate hours across campaigns
    const byHour = new Map();
    for (const h of items.hours) {
      const cur = byHour.get(h.name);
      if (!cur) byHour.set(h.name, { ...h });
      else for (const k of ['spend', 'impressions', 'clicks', 'views', 'conversions', 'leads', 'calls', 'deals', 'revenue']) cur[k] = r2(cur[k] + h[k]);
    }
    items.hours = [...byHour.values()].sort((a, b) => Number(a.name) - Number(b.name));
  }
  for (const k of Object.keys(items)) items[k].sort((a, b) => b.spend - a.spend);

  const has = classifier.configured
    ? {
        leads: !!(client.outcomes.leads || []).length,
        calls: !!(client.outcomes.calls || []).length,
        deals: !!(client.outcomes.deals || []).length,
        revenue: !!(client.outcomes.deals || []).length && dailyRows.some((d) => d.revenue > 0),
      }
    : { leads: true, calls: false, deals: false, revenue: false };

  return {
    meta: {
      client_name: client.name,
      refreshed_at: now.toISOString(),
      range: { from, to, days: len },
      previous: { from: pfrom, to: pto },
      currency: client.currency || 'USD',
      timezone: client.timezone || 'America/Denver',
      has,
      labels: {
        leads: client.labels?.leads || (classifier.configured ? 'Leads' : 'Conversions'),
        calls: client.labels?.calls || 'Booked calls',
        deals: client.labels?.deals || 'Sales',
      },
      targets: { cpl: client.targets?.cpl ?? null, cpc: client.targets?.cpc ?? null, roas: client.targets?.roas ?? null, breakeven: client.targets?.breakeven ?? null },
      goals,
      conversion_actions: conversionActions,
      include_paused: !!client.include_paused,
      notes: client.notes || [],
      actions: client.actions || [],
      term_groups: client.term_groups || {},
      last_change_date: client.last_change_date || '',
      warnings,
    },
    campaigns: [...campaigns.values()],
    daily: dailyRows,
    items,
  };
}
