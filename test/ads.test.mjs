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
  assert.equal(sent[1], 'SELECT campaign.id, metrics.clicks, metrics.video_trueview_views, metrics.conversions FROM campaign');
  // if neither name for video views is known, the field is dropped
  resetTokenCache();
  const sent2 = [];
  const g = async (url, init) => {
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    const q = JSON.parse(init.body).query; sent2.push(q);
    const m = q.match(/metrics\.video_(trueview_)?views/);
    if (m) return new Response(JSON.stringify({ error: { message: "Unrecognized field in the query: '" + m[0] + "'." } }), { status: 400 });
    return new Response(JSON.stringify([{ results: [{ campaign: { id: '1' } }] }]), { status: 200 });
  };
  assert.equal((await runQuery('6830451613', 'SELECT campaign.id, metrics.video_trueview_views, metrics.clicks FROM campaign', { env: ENV, fetchFn: g })).length, 1);
  assert.equal(sent2[sent2.length - 1], 'SELECT campaign.id, metrics.clicks FROM campaign');
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
  const z = summarize({ token: 'z-1234', name: 'Z', customer_id: '1' }, p);
  assert.equal(z.overall, 'nogoals');
  assert.ok(z.flags.includes('No cost goal') && z.flags.includes('No budget'));
  assert.match(row.reason, /goal \(/);
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

test('videos come from the video report, with Demand Gen video assets as a backup', async () => {
  resetTokenCache();
  const base = mockFetch();
  const f = async (url, init) => {
    if (!String(url).includes('oauth2')) {
      const q = JSON.parse(init.body).query;
      const m = (c, i, k) => ({ costMicros: String(c * 1e6), impressions: String(i), clicks: String(k), conversions: 0, videoTrueviewViews: '10' });
      if (/FROM video WHERE/.test(q) && !q.includes('conversion_action_name')) return new Response(JSON.stringify([{ results: [{ campaign: { id: '2' }, video: { id: 'AAA', title: 'Hook A' }, metrics: { ...m(10, 100, 5), videoQuartileP25Rate: 0.5, videoQuartileP50Rate: 0.3, videoQuartileP100Rate: 0.1 } }] }]));
      if (/FROM ad_group_ad_asset_view/.test(q) && !q.includes('conversion_action_name')) return new Response(JSON.stringify([{ results: [
        { campaign: { id: '2' }, asset: { id: '1', youtubeVideoAsset: { youtubeVideoId: 'AAA', youtubeVideoTitle: 'Hook A' } }, metrics: m(10, 100, 5) },
        { campaign: { id: '2' }, asset: { id: '2', youtubeVideoAsset: { youtubeVideoId: 'BBB', youtubeVideoTitle: 'Hook B' } }, metrics: m(4, 40, 2) },
        { campaign: { id: '2' }, asset: { id: '2', youtubeVideoAsset: { youtubeVideoId: 'BBB', youtubeVideoTitle: 'Hook B' } }, metrics: m(6, 60, 3) },
      ] }]));
    }
    return base(url, init);
  };
  const r = await buildReport({ client: CLIENT, from: '2026-10-01', to: '2026-10-30', env: ENV, fetchFn: f });
  const v = r.items.videos;
  assert.equal(v.length, 2);
  const a = v.find((x) => x.video_id === 'AAA'), b = v.find((x) => x.video_id === 'BBB');
  assert.equal(a.spend, 10);              // not double counted from the backup
  assert.equal(a.p25, 0.5);
  assert.equal(b.spend, 10);              // backup rows for the same video are merged
  assert.equal(b.impressions, 100);
  assert.equal(a.views, 10);
});

test('VPM campaign filter keeps campaigns with vpm in the name', async () => {
  const { scopePayload, summarize, resolveScope } = await import('../netlify/lib/team.mjs');
  const p = demoReport('demo', '2026-10-01', '2026-10-30');
  const v = scopePayload(p, 'vpm'), o = scopePayload(p, 'other'), a = scopePayload(p, 'all');
  assert.equal(v.mixed, true);
  assert.ok(v.payload.campaigns.every((c) => /vpm/i.test(c.name)));
  assert.ok(o.payload.campaigns.every((c) => !/vpm/i.test(c.name)));
  assert.equal(v.payload.campaigns.length + o.payload.campaigns.length, a.payload.campaigns.length);
  assert.ok(v.payload.daily.every((d) => v.payload.campaigns.some((c) => c.id === d.campaign_id)));
  const sv = summarize({ token: 'x-1', name: 'X', customer_id: '1', default_scope: 'vpm' }, p);
  const sa = summarize({ token: 'x-1', name: 'X', customer_id: '1' }, p);
  assert.equal(sv.scope, 'vpm');
  assert.ok(sv.spend < sa.spend);
  assert.equal(resolveScope({ default_scope: 'vpm' }, 'all'), 'all');
});

test('every resource field used in WHERE is also in SELECT (Google requires it, for example campaign.status)', () => {
  for (const s of ITEM_SPECS) {
    for (const q of [baseQuery(s, '2026-10-01', '2026-10-30', "campaign.status = 'ENABLED'"), splitQuery(s, '2026-10-01', '2026-10-30', 'conversions', "campaign.status = 'ENABLED'")]) {
      const [sel, where] = q.split(' WHERE ');
      for (const f of where.match(/\b[a-z_]+(?:\.[a-z_]+)+\b/g) || []) {
        if (f.startsWith('segments.') || f.startsWith('metrics.')) continue;
        assert.ok(sel.includes(f), s.kind + ': ' + f + ' missing from SELECT');
      }
      assert.doesNotMatch(sel, /segments\.date/);
    }
  }
});

test('business numbers from GoHighLevel: tenure, churn, revenue, estimated dates', async () => {
  const { computeBusiness, findFields } = await import('../netlify/lib/ghl.mjs');
  const { demoBusiness } = await import('../netlify/lib/demo-business.mjs');
  const now = Date.parse('2026-11-05T12:00:00Z');
  const b = computeBusiness({ ...demoBusiness(now), now });
  assert.equal(b.kpis.active, 5);
  assert.equal(b.kpis.mrr, 23500);
  assert.ok(b.kpis.churn_year > 0 && b.kpis.churn_year < 1);
  assert.equal(b.months.length, 12);
  assert.ok(b.clients.every((r) => !r.start_est));             // start dates came from the custom field
  assert.ok(b.billing.some((x) => x.kind === 'overdue') && b.billing.some((x) => x.kind === 'upcoming'));
  assert.deepEqual(findFields([{ id: 'a', name: 'Client Start Date' }, { id: 'b', name: 'Client End Date' }, { id: 'c', name: 'Monthly Retainer' }, { id: 'd', name: 'Google Ads Account ID (Optional)' }]), { start: 'a', end: 'b', retainer: 'c', reason: null, ads: 'd' });
  // without the custom fields, dates are estimated from invoices and a note says how to fix it
  const raw = demoBusiness(now);
  const c2 = computeBusiness({ ...raw, fields: [], now });
  assert.ok(c2.clients.some((r) => r.start_est));
  assert.ok(c2.quality.warnings.some((w) => /Client Start Date/.test(w)));
  // "potential client" is not the "client" tag
  const c3 = computeBusiness({ invoices: [], contacts: [{ id: 'x', name: 'P', company: 'Prospect', tags: ['potential client'], fields: {}, added: '2026-10-01' }], now });
  assert.equal(c3.kpis.active, 0);
});

test('GoHighLevel requests use the private key, version header and paging', async () => {
  const { fetchAll } = await import('../netlify/lib/ghl.mjs');
  const seen = [];
  const f = async (url, init) => {
    seen.push([init.method, url.replace('https://services.leadconnectorhq.com', ''), init.headers.Authorization, init.headers.Version]);
    if (url.includes('/customFields')) return new Response(JSON.stringify({ customFields: [{ id: 'fs', name: 'Client Start Date' }] }));
    if (url.includes('/invoices/')) {
      const off = Number(new URL(url).searchParams.get('offset'));
      const list = Array.from({ length: off === 0 ? 100 : 20 }, (_, i) => ({ _id: 'i' + off + i, status: 'paid', total: 100, amountPaid: 100, issueDate: '2026-10-01', contactDetails: { id: 'c' + (i % 3) } }));
      return new Response(JSON.stringify({ invoices: list, total: 120 }));
    }
    if (url.includes('/contacts/search')) return new Response(JSON.stringify({ contacts: [{ id: 'c0', tags: ['client'], companyName: 'A', customFields: [{ id: 'fs', value: '2026-01-01' }] }] }));
    if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { id: url.split('/').pop(), tags: [], companyName: 'B' } }));
    return new Response('{}', { status: 404 });
  };
  const r = await fetchAll({ env: { GHL_TOKEN: 'pit-test' }, fetchFn: f });
  assert.equal(r.invoices.length, 120);
  assert.equal(r.contacts.length, 3);
  assert.ok(seen.every((s) => s[2] === 'Bearer pit-test' && s[3] === '2021-07-28'));
  assert.ok(seen.some((s) => s[0] === 'POST' && s[1] === '/contacts/search'));
  await assert.rejects(fetchAll({ env: {}, fetchFn: f }), /GHL_TOKEN/);
});

/* ---------------- 2.4 ---------------- */
import { weekOverWeek, alertsFor, healthFor, bizByToken, summarize as summarize24 } from '../netlify/lib/team.mjs';
import { videoRows as videoRows24 } from '../netlify/lib/videos.mjs';
import { computeBusiness as computeBusiness24 } from '../netlify/lib/ghl.mjs';
import { demoBusiness as demoBusiness24 } from '../netlify/lib/demo-business.mjs';
import { validate as validate24 } from '../netlify/functions/admin.mjs';

const dayRows = (to, n, f) => Array.from({ length: n }, (_, i) => { const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i); return { date: d.toISOString().slice(0, 10), campaign_id: '1', ...f(i) }; });

test('week over week compares the last 7 days with the 7 before', () => {
  const daily = dayRows('2026-11-05', 14, (i) => ({ spend: 100, leads: i < 7 ? 1 : 2 }));
  const w = weekOverWeek(daily, '2026-11-05', 'leads');
  assert.equal(w.results, 7); assert.equal(w.prev.results, 14); assert.equal(w.change.results, -0.5);
  assert.equal(w.change.spend, 0);
  assert.equal(weekOverWeek(daily.slice(0, 7), '2026-11-05', 'leads'), null, 'no week before, no comparison');
});

test('alerts: spend stopped, no results for days, over budget, and a big drop', () => {
  const typeOf = new Map([['1', 'video']]);
  const goals = { monthly_spend: 1000, spend_by_type: [] };
  let daily = dayRows('2026-11-05', 14, (i) => ({ spend: i < 2 ? 0 : 100, leads: 2 }));
  let a = alertsFor(daily, '2026-11-05', 'leads', goals, typeOf, { res: 20 }, weekOverWeek(daily, '2026-11-05', 'leads'));
  assert.ok(a.some((x) => x.kind === 'stopped'));
  assert.ok(!a.some((x) => x.kind === 'drop'), 'a stop is not also reported as a drop');
  daily = dayRows('2026-11-05', 14, (i) => ({ spend: 100, leads: i < 4 ? 0 : 2 }));
  a = alertsFor(daily, '2026-11-05', 'leads', goals, typeOf, { res: 20 }, weekOverWeek(daily, '2026-11-05', 'leads'));
  const nr = a.find((x) => x.kind === 'noresults');
  assert.ok(nr && /4 days/.test(nr.text));
  assert.ok(a.some((x) => x.kind === 'overspend'), '$100 a day is 3x a $1,000 budget');
  daily = dayRows('2026-11-05', 14, () => ({ spend: 20, leads: 1 }));
  assert.deepEqual(alertsFor(daily, '2026-11-05', 'leads', goals, typeOf, { res: 14 }, weekOverWeek(daily, '2026-11-05', 'leads')), []);
});

test('client health adds up results, spend, overdue invoices and tenure', () => {
  const cpa = (status) => [{ key: 'cpa', status }];
  assert.equal(healthFor({ overall: 'good', checks: cpa('good'), alerts: [] }, { overdue: 0, months: 12 }).level, 'green');
  assert.equal(healthFor({ overall: 'warn', checks: cpa('warn'), alerts: [] }, { overdue: 0, months: 1 }).level, 'amber');
  const overOnly = healthFor({ overall: 'bad', checks: [{ key: 'spend', status: 'bad' }], alerts: [{ kind: 'overspend', level: 'bad', text: 'x' }] }, { overdue: 0, months: 12 });
  assert.equal(overOnly.level, 'amber', 'spending off budget alone counts once: keep an eye');
  const red = healthFor({ overall: 'bad', checks: cpa('bad'), alerts: [] }, { overdue: 500, months: 12 });
  assert.equal(red.level, 'red'); assert.ok(red.why.some((w) => /Overdue/.test(w)));
  assert.equal(healthFor({ overall: 'good', checks: [], alerts: [] }).linked, false);
  const m = bizByToken({ clients: [{ id: 'c1', token: 'acme-1234', active: true, months: 3 }], billing: [{ contact_id: 'c1', kind: 'overdue', amount: 250 }] });
  assert.equal(m.get('acme-1234').overdue, 250);
});

test('team row carries week over week and alerts', () => {
  const p = demoReport('demo-calls', '2026-10-07', '2026-11-05');
  const r = summarize24({ token: 't', name: 'T', customer_id: '1', goals: {} }, p, Date.now());
  assert.ok(r.wow && r.wow.prev.spend > 0);
  assert.ok(r.alerts.some((a) => a.kind === 'noresults'), 'the calls sample goes quiet for 3 days');
});

test('creative rows: watch curve, running or paused, new, and share of campaign spend', () => {
  const p = demoReport('demo', '2026-10-07', '2026-11-05');
  const rows = videoRows24({ name: 'X', token: 'x', goals: {} }, p);
  assert.ok(rows.every((v) => v.first_day <= v.last_day), 'first day is never after the last day');
  assert.ok(rows.some((v) => v.running === false) && rows.some((v) => v.running === true));
  assert.ok(rows.some((v) => v.is_new));
  assert.ok(rows.every((v) => v.p75 == null || (v.p75 <= v.p50 && v.p75 >= v.p100)));
  assert.ok(rows.every((v) => v.spend_share == null || (v.spend_share > 0 && v.spend_share <= 1)));
  assert.ok(rows.some((v) => v.spend_share < 0.1 && v.results >= 2), 'the sample has an underfunded winner');
});

test('business: recurring revenue history, forecast, churn reasons, sources and start quarters', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const b = computeBusiness24({ ...demoBusiness24(now), now });
  const last = b.months[b.months.length - 1];
  assert.equal(last.mrr, b.kpis.mrr, 'this month ends at today\'s recurring revenue');
  for (let i = 1; i < b.months.length; i++) {
    const m = b.months[i], prev = b.months[i - 1];
    assert.ok(Math.abs(prev.mrr + m.mrr_new - m.mrr_lost + m.mrr_changed - m.mrr) < 0.01, 'moves add up for ' + m.month);
  }
  assert.ok(b.months.some((m) => m.mrr_changed > 0), 'a fee change in the sample shows up');
  assert.deepEqual(b.forecast.map((f) => f.days), [30, 60, 90]);
  assert.ok(b.forecast[0].total <= b.forecast[1].total && b.forecast[1].total <= b.forecast[2].total);
  assert.equal(b.reasons.reduce((s, r) => s + r.count, 0), b.clients.filter((c) => c.monthly && !c.active).length);
  assert.equal(b.sources.reduce((s, r) => s + r.clients, 0), b.clients.length);
  assert.ok(b.cohorts.length > 0 && b.cohorts.every((c) => c.stay3 == null || (c.stay3 >= 0 && c.stay3 <= 1)));
  assert.equal(typeof b.kpis.churn_lost_6m, 'number');
  assert.ok(b.billing.every((x) => 'contact_id' in x));
});

test('business links clients to reports by GoHighLevel contact first, then Google Ads ID', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const data = demoBusiness24(now);
  const target = data.contacts.find((c) => c.tags.includes('client'));
  const b = computeBusiness24({ ...data, now, reportClients: [{ token: 'linked-0001', customer_id: '111-222-3333', ghl_contact_id: target.id }] });
  const row = b.clients.find((r) => r.id === target.id);
  assert.equal(row.token, 'linked-0001'); assert.equal(row.ads, '1112223333');
});

test('admin keeps Meta, Drive and GoHighLevel links tidy', () => {
  const base = { name: 'Acme', customer_id: '1234567890' };
  let c = { ...base, meta_ad_account: '1234567890123', drive_url: 'https://drive.google.com/x', ghl_contact_id: 'abcDEF12345', internal_notes: '  hi  ' };
  assert.deepEqual(validate24(c, [], null), []);
  assert.equal(c.meta_ad_account, 'act_1234567890123'); assert.equal(c.internal_notes, 'hi');
  c = { ...base, meta_ad_account: 'act_12', drive_url: 'drive.google.com' };
  const errs = validate24(c, [], null);
  assert.ok(errs.some((e) => /Meta/.test(e)) && errs.some((e) => /Drive/.test(e)));
  c = { ...base, ghl_contact_id: 'abcDEF12345' };
  assert.ok(validate24(c, [{ token: 'other-1111', name: 'Other', ghl_contact_id: 'abcDEF12345' }], null).some((e) => /already linked/.test(e)));
  c = { ...base, meta_ad_account: '' }; validate24(c, [], null); assert.ok(!('meta_ad_account' in c), 'blank links are dropped');
});

test('a contact picked in admin links right away and beats a Google Ads ID match', () => {
  const snap = { clients: [{ id: 'old', token: 'acme-1234', active: true, months: 30 }, { id: 'new', token: null, active: true, months: 2 }], billing: [] };
  assert.equal(bizByToken(snap, [{ token: 'acme-1234', ghl_contact_id: 'new' }]).get('acme-1234').id, 'new');
  const now = Date.parse('2026-11-06T12:00:00Z');
  const data = demoBusiness24(now);
  const [a, b] = data.contacts.filter((c) => c.tags.includes('client'));
  a.fields.fa = '111-222-3333'; b.fields.fa = '111-222-3333';
  data.fields.push({ id: 'fa', name: 'Google Ads Account ID (Optional)' });
  const res = computeBusiness24({ ...data, now, reportClients: [{ token: 'acme-3333', customer_id: '111-222-3333', ghl_contact_id: b.id }] });
  assert.equal(res.clients.find((r) => r.id === a.id).token, null);
  assert.equal(res.clients.find((r) => r.id === b.id).token, 'acme-3333');
});

/* ---------------- 2.6 billing ---------------- */
import { parseMonth, computeBilling, money as bMoney, usDate } from '../netlify/lib/billing.mjs';
import { demoBillingTabs } from '../netlify/lib/demo-billing.mjs';

const HEAD26 = ['', 'Client Name', 'Billing POC', 'Start Date', 'Service Category', 'Monthly Ad Spend ', 'Invoice Amount ', 'Invoice Status', 'Invoice Date', 'Payment Status', 'Invoice Notes', 'Payment Method', 'Referral Partner (10%)', 'Status'];
const top26 = [['', '', 'Monthly Summary'], ['', 'X', 'Total Active Clients: ', '3', 'Total Client Ad Spend: ', '$1,500.00', 'Average Monthly Client Value:', '', 'New Clients', '1'], ['', 'Y', 'Total Revenue Invoice: ', '$12,500', '', '', '', '', 'Lost Clients', '0'], [], []];

test('billing: money and dates from the sheet', () => {
  assert.equal(bMoney('$5,000.00'), 5000); assert.equal(bMoney('0'), 0); assert.equal(bMoney(''), null); assert.equal(bMoney('–'), null);
  assert.equal(usDate('11/2/2026'), '2026-11-02'); assert.equal(usDate('10/06/2026'), '2026-10-06'); assert.equal(usDate('–'), null);
});

test('billing: a month tab becomes line items, extra lines belong to the client above', () => {
  const v = [...top26, HEAD26,
    ['1', 'Acme ', 'Al', '', 'Ads Management', '$1,000.00', '$5,000', 'Paid', '11/2/2026', 'Paid', '', 'GHL/Stripe', '', 'Active'],
    ['', '', '', '', 'Video Production', '', '$5,000', 'Wait', '11/19/2026', 'Unpaid', 'Payment 2 of 3'],
    ['', '', '', '', '', '', '', '', '', '', 'note: charge on delivery'],
    [],
    ['2', 'Beta', 'Bo', '', 'Ads Management', '$500.00', '$2,500', 'Invoice Sent', '11/1/2026', 'Card Declined', '', 'GHL/Stripe', '', 'Active'],
    ['3', 'Gamma', 'Gi', '', 'Ads Management', '$0.00', '0', 'Do Not Send', '–', 'Unpaid', '', 'Quickbooks', '', 'Active'],
    [], [], [], [], [], [], [],
    ['9', 'Old Copy', 'Zed', '', 'Ads Management', '', '$9,999', 'Paid', '10/1/2026', 'Paid'],
  ];
  const p = parseMonth(v, '2026-11');
  assert.equal(p.lines.length, 4, 'rows after a long gap of empty rows are leftovers, not this month');
  assert.equal(p.lines[1].client, 'Acme'); assert.equal(p.lines[1].service, 'Video Production');
  assert.match(p.lines[1].notes, /charge on delivery/);
  assert.equal(p.summary.invoiced, 12500); assert.equal(p.summary.new, 1);
  const b = computeBilling({ tabs: [{ title: 'November', month: '2026-11', values: v }], now: Date.parse('2026-11-13T17:00:00Z') });
  const m = b.months[0];
  assert.equal(m.invoiced, 12500); assert.equal(m.collected, 5000); assert.equal(m.outstanding, 7500); assert.equal(m.failed, 2500);
  assert.equal(m.ads, 7500); assert.equal(m.video, 5000); assert.equal(m.ad_spend, 1500);
  assert.ok(b.attention.some((a) => a.client === 'Beta' && /declined/i.test(a.why)));
  assert.ok(!b.attention.some((a) => a.client === 'Gamma'), 'Do Not Send is never an alert');
  assert.ok(!b.attention.some((a) => a.client === 'Acme'), 'a future invoice date is not overdue');
});

test('billing: a copied tab and next month are placeholders, left out of totals', () => {
  const now = Date.parse('2026-11-13T17:00:00Z');
  const b = computeBilling({ tabs: demoBillingTabs(now), now });
  const dec = b.months.find((m) => m.month === '2026-12');
  assert.ok(dec.placeholder && dec.copied);
  assert.ok(b.warnings.some((w) => /copy/.test(w)));
  const real = b.months.filter((m) => !m.placeholder);
  assert.equal(b.totals.invoiced, real.reduce((s, m) => s + m.invoiced, 0));
  assert.equal(b.current, '2026-11');
  const rev = computeBilling({ tabs: demoBillingTabs(now).reverse(), now });
  assert.deepEqual(rev.months.map((m) => m.month), ['2026-10', '2026-11', '2026-12'], 'months read oldest to newest whatever the tab order');
  assert.ok(b.clients.every((c) => c.total >= c.outstanding));
});

/* ---------- 2.7: saving from the Billing page into the sheet ---------- */
import { memorySheet } from '../netlify/lib/sheets.mjs';
import { updateLine, addLine, startNextMonth } from '../netlify/lib/billing-write.mjs';
import { parseMonth as pm27 } from '../netlify/lib/billing.mjs';

const NOW27 = Date.UTC(2026, 10, 13);
const sheet27 = () => memorySheet(demoBillingTabs(NOW27).reverse());
const env27 = { VPM_DEV: '1' };
async function lines27(sheet, title) { const [v] = await sheet.read([{ tab: title, rows: 60 }]); return pm27(v, '').lines; }

test('2.7 update writes only changed cells and refuses a stale row', async () => {
  const s = sheet27(); const L = (await lines27(s, 'November')).find((l) => l.payment_status !== 'Paid' && !l.inv_notes);
  const r = await updateLine({ env: env27, sheet: s, tab: 'November', row: L.row, expect: { client: L.client, service: L.service, amount: L.amount }, set: { payment_status: 'Paid', amount: L.amount, inv_notes: 'from test' } });
  assert.equal(r.changed, 2);
  const L2 = (await lines27(s, 'November')).find((x) => x.row === L.row);
  assert.equal(L2.payment_status, 'Paid'); assert.equal(L2.inv_notes, 'from test');
  await assert.rejects(updateLine({ env: env27, sheet: s, tab: 'November', row: L.row, expect: { client: 'Someone Else', service: L.service, amount: L.amount }, set: { payment_status: 'Unpaid' } }), (e) => e.status === 409);
});

test('2.7 add puts an existing client under their lines and a new client at the end', async () => {
  const s = sheet27(); const before = await lines27(s, 'November');
  const c = before[0].client;
  const a = await addLine({ env: env27, sheet: s, tab: 'November', line: { client: c, service: 'Video Production', amount: 750 } });
  const b = await addLine({ env: env27, sheet: s, tab: 'November', line: { client: 'Brand New LLC', service: 'Ads Management', amount: 1200, poc: 'Pat' } });
  const after = await lines27(s, 'November');
  assert.equal(after.length, before.length + 2);
  assert.equal(after.find((l) => l.row === a.row).client, c);
  const nl = after.find((l) => l.row === b.row);
  assert.equal(nl.client, 'Brand New LLC'); assert.equal(nl.amount, 1200);
  await assert.rejects(addLine({ env: env27, sheet: s, tab: 'November', line: { client: 'X', service: 'Ads Management', amount: -5 } }));
});

test('2.7 next month copies the tab, moves dates and keeps the old tab', async () => {
  const s = sheet27();
  const r = await startNextMonth({ env: env27, sheet: s, from: 'November', now: NOW27 });
  assert.equal(r.tab, 'December'); assert.equal(r.renamed, 'December (old 2026-11-13)');
  const titles = (await s.meta()).tabs.map((t) => t.title);
  assert.ok(titles.includes('December (old 2026-11-13)'));
  const dec = await lines27(s, 'December');
  assert.ok(dec.filter((l) => l.invoice_date).every((l) => l.invoice_date.slice(0, 7) === '2026-12'));
  assert.ok(dec.filter((l) => !/do not send/i.test(l.invoice_status)).every((l) => l.payment_status === 'Unpaid'));
  await assert.rejects(startNextMonth({ env: env27, sheet: s, from: 'December', now: NOW27 }));
});

test('2.8 connection check writes the header back unchanged', async () => {
  const { checkSheet } = await import('../netlify/lib/billing-write.mjs');
  const s = sheet27(); const before = JSON.stringify(s.tabsRaw.map((t) => t.values));
  const r = await checkSheet({ env: env27, sheet: s });
  assert.equal(r.ok, true); assert.equal(r.tab, 'December');
  assert.equal(JSON.stringify(s.tabsRaw.map((t) => t.values)), before);
});

test('2.9 GHL contact links come from the Billing POC cells and are copied for a client from another month', async () => {
  const s = sheet27();
  const { fetchBillingTabs, computeBilling } = await import('../netlify/lib/billing.mjs');
  const got = await fetchBillingTabs({ env: { VPM_DEV: '1', BILLING_START: '2026-10' }, sheet: s });
  const snap = computeBilling({ tabs: got.tabs, now: NOW27, title: 't', sheetId: '' });
  const nov = snap.months.find((m) => m.title === 'November');
  assert.match(nov.lines[0].poc_link, /^https:\/\/app\.gohighlevel\.com\//);
  assert.ok(snap.directory.length >= 7 && snap.directory.every((c) => c.poc_link));
  const oct = snap.directory.find((c) => !nov.lines.some((l) => l.client === c.client)) || snap.directory[0];
  // a client from another month joins December with their contact and link
  const r = await addLine({ env: env27, sheet: s, tab: 'December', line: { client: 'Maple Home Services', poc: 'Jo Reyes', poc_link: 'https://app.gohighlevel.com/x/1', client_status: 'Active', service: 'Ads Management', amount: 900 } });
  const [lk] = await s.links([{ tab: 'December', col: 3, rows: 60 }]);
  assert.equal(lk[r.row - 1], 'https://app.gohighlevel.com/x/1');
  await assert.rejects(addLine({ env: env27, sheet: s, tab: 'December', line: { client: 'Bad Link Co', service: 'Ads Management', amount: 1, poc_link: 'javascript:alert(1)' } }));
  // editing the contact on a first line updates the link
  const L = (await lines27(s, 'November')).find((l) => l.first);
  await updateLine({ env: env27, sheet: s, tab: 'November', row: L.row, expect: { client: L.client, service: L.service, amount: L.amount }, set: { poc: 'New Person', poc_link: 'https://app.gohighlevel.com/x/2' } });
  const [lk2] = await s.links([{ tab: 'November', col: 3, rows: 60 }]);
  assert.equal(lk2[L.row - 1], 'https://app.gohighlevel.com/x/2');
  assert.ok(oct);
});

test('2.10 December copies into next year\'s sheet as January and keeps the old January', async () => {
  const s26 = sheet27();
  const { demoNextYear } = await import('../netlify/lib/demo-billing.mjs');
  const s27 = memorySheet(demoNextYear(NOW27), 'next', 'next-id');
  // fill December with real dates first, so the copy has December dates to move
  await startNextMonth({ env: env27, sheet: s26, from: 'November', now: NOW27 });
  const r = await startNextMonth({ env: env27, sheet: s26, target: s27, year: 2026, from: 'December', now: NOW27 });
  assert.equal(r.tab, 'January'); assert.equal(r.year, 2027); assert.equal(r.renamed, 'January (old 2026-11-13)');
  const titles = (await s27.meta()).tabs.map((t) => t.title);
  assert.deepEqual(titles.slice(0, 3), ['Dashboard', 'January', 'January (old 2026-11-13)']);
  const jan = await lines27(s27, 'January');
  assert.ok(jan.length > 3);
  assert.ok(jan.filter((l) => l.invoice_date).every((l) => l.invoice_date.slice(0, 7) === '2027-01'));
  // the 2026 sheet is untouched apart from what it had
  assert.ok(!(await s26.meta()).tabs.some((t) => t.title === 'January'));
});

test('2.10 sheet link parsing', async () => {
  const { sheetIdFromLink } = await import('../netlify/lib/billing.mjs');
  assert.equal(sheetIdFromLink('https://docs.google.com/spreadsheets/d/13Q_2uLLL73_ZdTVPOqCz4Vu1Vqh853h4I-5ZexiZ9dI/edit?gid=0'), '13Q_2uLLL73_ZdTVPOqCz4Vu1Vqh853h4I-5ZexiZ9dI');
  assert.equal(sheetIdFromLink('not a link'), '');
});

test('2.11 month tabs named with the year ("November 2026") read and roll over in the same style', async () => {
  const { monthOfTitle, yearOfTitle, fetchBillingTabs } = await import('../netlify/lib/billing.mjs');
  assert.equal(monthOfTitle('November 2026'), 10); assert.equal(yearOfTitle('November 2026'), 2026);
  assert.equal(monthOfTitle('November'), 10); assert.equal(yearOfTitle('November'), null);
  assert.equal(monthOfTitle('November 2026 (old 2026-11-13)'), -1); assert.equal(monthOfTitle('Dashboard'), -1);
  const tabs = demoBillingTabs(NOW27).reverse().map((t) => ({ ...t, title: t.title + ' 2026' }));
  tabs.push({ title: 'January 2027', values: tabs[0].values }); // a stray tab for another year is skipped
  const s = memorySheet(tabs);
  const got = await fetchBillingTabs({ env: { VPM_DEV: '1', BILLING_START: '2026-10' }, sheet: s });
  assert.deepEqual(got.tabs.map((t) => t.title).sort(), ['December 2026', 'November 2026', 'October 2026']);
  const r = await startNextMonth({ env: env27, sheet: s, year: 2026, from: 'November 2026', now: NOW27 });
  assert.equal(r.tab, 'December 2026'); assert.equal(r.renamed, 'December 2026 (old 2026-11-13)');
  const s27 = memorySheet([{ title: 'Dashboard', values: [[]] }], 'n', 'n');
  const r2 = await startNextMonth({ env: env27, sheet: s, target: s27, year: 2026, from: 'December 2026', now: NOW27 });
  assert.equal(r2.tab, 'January 2027'); assert.equal(r2.year, 2027);
});
