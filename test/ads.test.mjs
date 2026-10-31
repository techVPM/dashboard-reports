import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, resetTokenCache, makeClassifier, baseQuery, splitQuery, ITEM_SPECS, runQuery, envConfig, explainError, DEFAULT_VERSION } from '../netlify/lib/ads.mjs';
import { resolveRange, cacheKey } from '../netlify/lib/range.mjs';
import { demoReport } from '../netlify/lib/demo.mjs';
import { findClient, loadClients } from '../netlify/lib/store.mjs';

const ENV = { GOOGLE_ADS_CLIENT_ID: 'id', GOOGLE_ADS_CLIENT_SECRET: 'sec', GOOGLE_ADS_REFRESH_TOKEN: 'rt', GOOGLE_ADS_LOGIN_CUSTOMER_ID: '550-628-3927' };
const CLIENT = { name: 'Test Co', customer_id: '683-045-1613', timezone: 'America/New_York', outcomes: { calls: ['Booked Call'] } };

function mockFetch({ failKinds = [], failCore = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    url = String(url);
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    const q = JSON.parse(init.body).query;
    calls.push({ url, q, headers: init.headers });
    const from = /FROM (\w+)/.exec(q)[1];
    const split = q.includes('conversion_action_name');
    const respond = (rows) => new Response(JSON.stringify([{ results: rows }]), { status: 200 });
    if (failCore && q.includes('segments.date, metrics.cost_micros')) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
    for (const k of failKinds) if (from === k) return new Response(JSON.stringify([{ error: { message: 'bad view' } }]), { status: 400 });
    const m = (c, i, k, cv) => ({ costMicros: String(c * 1e6), impressions: String(i), clicks: String(k), conversions: cv });
    if (from === 'campaign' && q.includes('segments.date,') && !split && q.includes('advertising_channel_type, segments.date')) {
      return respond([
        { campaign: { id: '1', name: 'Brand', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, segments: { date: '2026-10-01' }, metrics: m(10, 100, 10, 2) },
        { campaign: { id: '1', name: 'Brand', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, segments: { date: '2026-10-20' }, metrics: m(20, 200, 20, 5) },
        { campaign: { id: '2', name: 'Video', status: 'ENABLED', advertisingChannelType: 'DEMAND_GEN' }, segments: { date: '2026-10-20' }, metrics: { ...m(30, 1000, 15, 3), videoViews: '300' } },
      ]);
    }
    if (from === 'campaign' && split && q.includes('segments.date')) {
      return respond([
        { campaign: { id: '1' }, segments: { date: '2026-10-20', conversionActionName: 'Booked Call' }, metrics: { conversions: 4, conversionsValue: 4 } },
        { campaign: { id: '1' }, segments: { date: '2026-10-20', conversionActionName: 'Membership login' }, metrics: { conversions: 1, conversionsValue: 1 } },
        { campaign: { id: '2' }, segments: { date: '2026-10-20', conversionActionName: 'Booked Call' }, metrics: { conversions: 2, conversionsValue: 2 } },
      ]);
    }
    if (q.includes('search_impression_share')) return respond([{ campaign: { id: '1' }, campaignBudget: { amountMicros: '25000000' }, metrics: { searchImpressionShare: 0.4, searchBudgetLostImpressionShare: 0.3, searchRankLostImpressionShare: 0.2 } }]);
    if (from === 'ad_group_ad' && !split) return respond([{ campaign: { id: '1' }, adGroup: { id: '9', name: 'AG' }, adGroupAd: { ad: { id: '77', type: 'RESPONSIVE_SEARCH_AD', responsiveSearchAd: { headlines: [{ text: 'Quit drinking' }, { text: 'Book a call' }] } } }, metrics: m(15, 150, 12, 3) }]);
    if (from === 'ad_group_ad' && split) return respond([{ campaign: { id: '1' }, adGroup: { id: '9' }, adGroupAd: { ad: { id: '77' } }, segments: { conversionActionName: 'Booked Call' }, metrics: { conversions: 2, conversionsValue: 2 } }]);
    if (from === 'campaign' && q.includes('segments.hour') && !split) return respond([
      { segments: { hour: 9 }, metrics: m(5, 50, 5, 1) }, { segments: { hour: 9 }, metrics: m(7, 70, 6, 1) }, { segments: { hour: 10 }, metrics: m(1, 10, 1, 0) }]);
    if (from === 'campaign' && q.includes('segments.device') && !split) return respond([{ campaign: { id: '1' }, segments: { device: 'MOBILE' }, metrics: m(20, 200, 20, 4) }]);
    if (from === 'search_term_view' && !split) return respond([{ campaign: { id: '1' }, searchTermView: { searchTerm: 'quit drinking coach' }, metrics: m(8, 80, 8, 2) }]);
    return respond([]);
  };
  fn.calls = calls;
  return fn;
}

test('buildReport maps conversion actions, joins item splits and folds hours', async () => {
  resetTokenCache();
  const f = mockFetch();
  const r = await buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: f });
  assert.equal(r.meta.range.days, 30);
  assert.deepEqual(r.meta.previous, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(r.meta.has, { leads: false, calls: true, deals: false, revenue: false });
  const d = r.daily.find((x) => x.campaign_id === '1' && x.date === '2026-10-20');
  assert.equal(d.conversions, 5);
  assert.equal(d.calls, 4);                 // only Booked Call counts, not Membership login
  assert.equal(r.campaigns.find((c) => c.id === '2').type, 'video');
  assert.equal(r.campaigns.find((c) => c.id === '1').lost_budget, 0.3);
  const ad = r.items.ads[0];
  assert.equal(ad.name, 'Quit drinking | Book a call');
  assert.equal(ad.calls, 2);
  assert.equal(ad.spend, 15);
  assert.equal(r.items.hours.length, 2);
  assert.equal(r.items.hours[0].spend, 12);  // two hour-9 rows folded
  assert.equal(r.items.devices, undefined);
  assert.equal(r.items.device[0].name, 'Mobile');
  assert.equal(r.items.terms[0].calls, 0);   // no split row for this term
  assert.deepEqual(r.meta.warnings, []);
  // credentials and headers
  const h = f.calls[0].headers;
  assert.equal(h['developer-token'], undefined);   // developer tokens were retired in 2026, none is sent
  assert.equal(h.authorization, 'Bearer tok');
  assert.equal(h['login-customer-id'], '5506283927');
  assert.ok(f.calls[0].url.includes('/customers/6830451613/googleAds:searchStream'));
});

test('a failing breakdown becomes a warning, not an error', async () => {
  resetTokenCache();
  const r = await buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: mockFetch({ failKinds: ['keyword_view'] }) });
  assert.ok(r.meta.warnings.some((w) => w.startsWith('keywords')));
  assert.ok(r.daily.length > 0);
});

test('a failing core query throws', async () => {
  resetTokenCache();
  await assert.rejects(buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: mockFetch({ failCore: true }) }));
});

test('unmapped client counts every conversion as a lead and skips split queries', async () => {
  resetTokenCache();
  const f = mockFetch();
  const r = await buildReport({ client: { name: 'X', customer_id: '1112223333' }, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: f });
  assert.equal(r.meta.labels.leads, 'Conversions');
  assert.equal(r.meta.has.leads, true);
  assert.equal(r.daily.find((x) => x.date === '2026-10-20' && x.campaign_id === '1').leads, 5);
  assert.ok(!f.calls.some((c) => c.q.includes('conversion_action_name')));
});

test('item queries are valid-looking GAQL', () => {
  for (const s of ITEM_SPECS) {
    const q = baseQuery(s, '2026-10-01', '2026-10-30');
    assert.match(q, /^SELECT .+ FROM \w+ WHERE segments\.date BETWEEN '2026-10-01' AND '2026-10-30' AND metrics\.impressions > 0/);
    assert.match(splitQuery(s, '2026-10-01', '2026-10-30', 'conversions'), /segments\.conversion_action_name/);
  }
});

test('classifier is case-insensitive', () => {
  const c = makeClassifier({ calls: ['Booked Call'] });
  assert.equal(c.roles('booked call'), 'calls');
  assert.equal(c.roles('other'), null);
});

test('range resolver', () => {
  const ok = resolveRange(new URLSearchParams('from=2026-10-01&to=2026-10-30'), 'America/Denver');
  assert.equal(ok.from, '2026-10-01');
  assert.ok(resolveRange(new URLSearchParams('from=2026-10-30&to=2026-10-01'), 'America/Denver').error);
  assert.ok(resolveRange(new URLSearchParams('from=2024-01-01&to=2026-10-01'), 'America/Denver').error);
  const p = resolveRange(new URLSearchParams('days=7'), 'America/Denver');
  assert.equal(new Date(p.to + 'T00:00:00Z') - new Date(p.from + 'T00:00:00Z'), 6 * 864e5);
});

test('cache key changes when client settings change', () => {
  assert.notEqual(cacheKey(CLIENT, 'a', 'b'), cacheKey({ ...CLIENT, targets: { cpc: 100 } }, 'a', 'b'));
});

test('demo report totals are internally consistent', () => {
  const r = demoReport('demo', '2026-10-01', '2026-10-30');
  const sp = r.daily.filter((d) => d.date >= '2026-10-01').reduce((a, d) => a + d.spend, 0);
  const itemSp = r.items.age.reduce((a, d) => a + d.spend, 0);
  assert.ok(Math.abs(sp - itemSp) < 1, `${sp} vs ${itemSp}`);
});

test('a legacy developer token is only sent when one is set', async () => {
  resetTokenCache();
  const f = mockFetch();
  await buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: { ...ENV, GOOGLE_ADS_DEVELOPER_TOKEN: 'old' }, fetchFn: f });
  assert.equal(f.calls[0].headers['developer-token'], 'old');
});

test('default API version is current and can be overridden', () => {
  assert.equal(envConfig(ENV).version, DEFAULT_VERSION);
  assert.equal(envConfig({ ...ENV, GOOGLE_ADS_API_VERSION: 'v26' }).version, 'v26');
});

test('missing credentials name the missing settings but never ask for a developer token', () => {
  assert.throws(() => envConfig({}), (e) => /GOOGLE_ADS_CLIENT_ID/.test(e.message) && !/DEVELOPER/.test(e.message) && e.status === 500);
});

test('Cloud project errors get a plain-language hint', () => {
  assert.match(explainError(403, '{"error":{"details":[{"errors":[{"errorCode":{"authorizationError":"CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"}}]}]}}'), /Explorer or Basic/);
  assert.match(explainError(403, 'AUTHORIZATION_ERROR'), /Cloud Console/);
  assert.match(explainError(429, ''), /limit/);
  assert.equal(explainError(400, 'something else'), '');
});

test('a query still works when the API version no longer has metrics.video_views', async () => {
  resetTokenCache();
  const sent = [];
  const f = async (url, init) => {
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    const q = JSON.parse(init.body).query;
    sent.push(q);
    if (q.includes('metrics.video_views')) return new Response(JSON.stringify({ error: { message: "Unrecognized field in the query: 'metrics.video_views'." } }), { status: 400 });
    return new Response(JSON.stringify([{ results: [{ campaign: { id: '1' } }] }]), { status: 200 });
  };
  const rows = await runQuery('6830451613', 'SELECT campaign.id, metrics.clicks, metrics.video_views, metrics.conversions FROM campaign', { env: ENV, fetchFn: f });
  assert.equal(rows.length, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[1], 'SELECT campaign.id, metrics.clicks, metrics.conversions FROM campaign');
  // other bad fields still fail loudly
  await assert.rejects(runQuery('1', 'SELECT metrics.nope FROM campaign', { env: ENV, fetchFn: async (u) => u.includes('oauth2') ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })) : new Response(JSON.stringify({ error: { message: "Unrecognized field in the query: 'metrics.nope'." } }), { status: 400 }) }));
});

test('client link keys are readable, unique and match each account', () => {
  const all = loadClients({});
  assert.ok(all.length >= 8);
  assert.equal(new Set(all.map((c) => c.token)).size, all.length);
  for (const c of all) {
    assert.match(c.token, /^[a-z0-9]+(-[a-z0-9]+)*-\d{4}$/);
    assert.ok(c.token.endsWith(c.customer_id.replace(/\D/g, '').slice(-4)), c.name);
    assert.equal(findClient(c.token, {}).name, c.name);
  }
  assert.equal(findClient('Coach-By-Chris-1613', {}).name, 'Coach by Chris');   // capitals do not matter
  assert.equal(findClient('coach-by-chris-9999', {}), null);
});

test('each ad carries the landing page it leads to', () => {
  const spec = ITEM_SPECS.find((x) => x.kind === 'ads');
  assert.ok(spec.fields.includes('ad_group_ad.ad.final_urls'));
  const it = spec.item({ campaign: { id: '1' }, adGroup: { name: 'G' }, adGroupAd: { ad: { id: '9', finalUrls: ['https://example.com/p'] } } });
  assert.equal(it.url, 'https://example.com/p');
  assert.equal(spec.item({ campaign: { id: '1' }, adGroupAd: { ad: { id: '9' } } }).url, '');
});

test('paused campaigns are left out of every query unless the client asks for them', async () => {
  resetTokenCache();
  const f = mockFetch();
  await buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: f });
  assert.ok(f.calls.length >= 10);
  for (const c of f.calls) assert.match(c.q, /campaign\.status = 'ENABLED'/, c.q.slice(0, 80));
  resetTokenCache();
  const g = mockFetch();
  await buildReport({ client: { ...CLIENT, include_paused: true }, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: g });
  for (const c of g.calls) assert.doesNotMatch(c.q, /campaign\.status = 'ENABLED'/);
});

test('goals turn into targets, counted conversions and a goals block for the page', async () => {
  const { applyGoals, cleanGoals } = await import('../netlify/lib/goals.mjs');
  const a = applyGoals({ name: 'G', goals: { cost_per_conversion: '120', focus_conversions: ['Lead - Form', ' Booked Call '], result_label: 'Leads', roas: 4, monthly_conversions: 50 } });
  assert.deepEqual(a.client.outcomes, { leads: ['Lead - Form', 'Booked Call'] });
  assert.equal(a.client.targets.cpl, 120);
  assert.equal(a.client.targets.roas, 4);
  assert.equal(a.client.labels.leads, 'Leads');
  assert.equal(a.goals.monthly_conversions, 50);
  // outcomes and targets set directly win
  const b = applyGoals({ name: 'G', outcomes: { calls: ['Booked Call'] }, targets: { cpc: 99 }, goals: { cost_per_conversion: 120, focus_conversions: ['X'] } });
  assert.deepEqual(b.client.outcomes, { calls: ['Booked Call'] });
  assert.equal(b.client.targets.cpc, 99);
  assert.equal(cleanGoals(undefined).any, false);
  assert.equal(cleanGoals({ cost_per_conversion: 'abc', monthly_spend: -5 }).any, false);
  resetTokenCache();
  const r = await buildReport({ client: { name: 'G', customer_id: '1112223333', goals: { cost_per_conversion: 75, focus_conversions: ['Booked Call'] } }, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: mockFetch() });
  assert.equal(r.meta.goals.cost_per_conversion, 75);
  assert.equal(r.meta.targets.cpl, 75);
  assert.equal(r.meta.has.leads, true);
});

test('changing goals or the paused setting busts the cache', () => {
  const base = { customer_id: '123-456-7890', name: 'A' };
  assert.notEqual(cacheKey(base, '2026-10-01', '2026-10-30'), cacheKey({ ...base, goals: { roas: 3 } }, '2026-10-01', '2026-10-30'));
  assert.notEqual(cacheKey(base, '2026-10-01', '2026-10-30'), cacheKey({ ...base, include_paused: true }, '2026-10-01', '2026-10-30'));
});

test('goal ranges, spend by campaign type and dash-insensitive conversion names', async () => {
  const { cleanGoals, parseCpa } = await import('../netlify/lib/goals.mjs');
  assert.deepEqual(parseCpa('200-300'), { low: 200, high: 300 });
  assert.deepEqual(parseCpa('$200 to $800'), { low: 200, high: 800 });
  assert.deepEqual(parseCpa(250), { low: null, high: 250 });
  const g = cleanGoals({ cost_per_conversion: '200-300', spend_by_type: { video: 10000, 'search+pmax': 30000, bogus: 5 }, weekly_conversions: 70 });
  assert.equal(g.cost_per_conversion, 300);
  assert.equal(g.cpa_low, 200);
  assert.deepEqual(g.spend_by_type, [{ types: ['video'], amount: 10000 }, { types: ['search', 'pmax'], amount: 30000 }]);
  const c = makeClassifier({ leads: ['MQL - MP Offline Conversions - LEADS feed'] });
  assert.equal(c.roles('MQL - MP Offline Conversions — LEADS feed'), 'leads');
  assert.equal(c.roles('mql  -  mp offline conversions - leads FEED'), 'leads');
});

test('goals written in clients.json all parse', async () => {
  const { cleanGoals } = await import('../netlify/lib/goals.mjs');
  const withGoals = loadClients({}).filter((c) => c.goals);
  assert.ok(withGoals.length >= 7);
  for (const c of withGoals) assert.ok(cleanGoals(c.goals).any, c.name + ' goals did not parse');
});

test('team dashboard row judges a client against its goals', async () => {
  const { summarize } = await import('../netlify/lib/team.mjs');
  const p = demoReport('demo-calls', '2026-10-01', '2026-10-30');
  const row = summarize({ token: 'x-1234', name: 'X', customer_id: '123-456-7890', goals: { cost_per_conversion: 1, monthly_spend: 999999, focus_conversions: ['Nope'] } }, p);
  assert.equal(row.overall, 'bad');
  assert.ok(row.checks.find((k) => k.key === 'cpa').status === 'bad');
  assert.match(row.ads_url, /__c=1234567890/);
  assert.equal(row.report_url, '/x-1234');
  const ok = summarize({ token: 'y-1234', name: 'Y', customer_id: '123-456-7890', goals: { cost_per_conversion: 100000 } }, p);
  assert.equal(ok.overall, 'good');
  assert.equal(summarize({ token: 'z-1234', name: 'Z', customer_id: '1' }, p).overall, 'none');
});

test('admin validation catches bad input and fills the link key', async () => {
  const { validate } = await import('../netlify/functions/admin.mjs');
  const list = [{ token: 'sandler-7469', name: 'Sandler', customer_id: '306-924-7469' }];
  const c = { name: 'New Co', customer_id: '1234567890' };
  assert.deepEqual(validate(c, list, null), []);
  assert.equal(c.token, 'new-co-7890');
  assert.equal(c.customer_id, '123-456-7890');
  assert.ok(validate({ name: '', customer_id: '12' }, list, null).length >= 2);
  assert.ok(validate({ name: 'S', customer_id: '3069247469', token: 'sandler-7469' }, list, null).join(' ').includes('already'));
  assert.deepEqual(validate({ name: 'Sandler', customer_id: '3069247469', token: 'sandler-7469' }, list, 'sandler-7469'), []);
  assert.ok(validate({ name: 'T', customer_id: '1234567890', token: 'team' }, list, null).join(' ').includes('reserved'));
});
