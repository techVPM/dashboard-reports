import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, resetTokenCache, makeClassifier, baseQuery, splitQuery, ITEM_SPECS, envConfig, explainError, DEFAULT_VERSION } from '../netlify/lib/ads.mjs';
import { resolveRange, cacheKey } from '../netlify/lib/range.mjs';
import { demoReport } from '../netlify/lib/demo.mjs';

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
