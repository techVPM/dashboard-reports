import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildMeta, listMetaConversions, demoMeta, actionName } from '../netlify/lib/meta.mjs';
import { demoReport } from '../netlify/lib/demo.mjs';
import { validate } from '../netlify/functions/admin.mjs';

const ENV = { META_ACCESS_TOKEN: 'tok123', META_APP_SECRET: 'shh' };
const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
function fakeMeta(seen = []) {
  return async (url) => {
    const u = new URL(String(url)); seen.push(u);
    const level = u.searchParams.get('level'), p = u.pathname;
    if (p.endsWith('/customconversions')) return ok({ data: [{ id: '555', name: 'Thank you page' }] });
    if (p.endsWith('/insights') && level === 'campaign') return ok({ data: [
      { date_start: '2026-10-01', campaign_id: '1', campaign_name: 'VPM Leads', objective: 'OUTCOME_LEADS', spend: '50', impressions: '4000', inline_link_clicks: '40', actions: [{ action_type: 'lead', value: '4' }, { action_type: 'link_click', value: '40' }] },
      { date_start: '2026-11-01', campaign_id: '1', campaign_name: 'VPM Leads', objective: 'OUTCOME_LEADS', spend: '60', impressions: '5000', inline_link_clicks: '55', actions: [{ action_type: 'lead', value: '5' }, { action_type: 'offsite_conversion.custom.555', value: '2' }] },
    ] });
    if (p.endsWith('/insights') && level === 'account') return ok({ data: [{ reach: '3000', frequency: '1.6', impressions: '5000', actions: [{ action_type: 'lead', value: '9' }, { action_type: 'video_view', value: '100' }] }] });
    if (p.endsWith('/insights') && level === 'ad') return ok({ data: [{ ad_id: '77', ad_name: 'Testimonial', campaign_id: '1', spend: '60', impressions: '5000', inline_link_clicks: '55', actions: [{ action_type: 'lead', value: '5' }] }] });
    if (u.searchParams.get('ids')) return ok({ 77: { creative: { thumbnail_url: 'https://x/t.jpg', body: 'Hi', video_id: '9' } } });
    return new Response('{}', { status: 404 });
  };
}

test('Meta: no token or no account means no Meta block', async () => {
  assert.equal(await buildMeta({ client: { meta_ad_account: 'act_1' }, from: '2026-11-01', to: '2026-11-30', env: {} }), null);
  assert.equal(await buildMeta({ client: {}, from: '2026-11-01', to: '2026-11-30', env: ENV }), null);
});

test('Meta: reads results, signs every request, keeps periods apart', async () => {
  const seen = [];
  const m = await buildMeta({ client: { meta_ad_account: 'act_123', meta_goals: { focus: ['lead'], cost_per_result: 40 } }, from: '2026-11-01', to: '2026-11-30', env: ENV, fetchFn: fakeMeta(seen) });
  const proof = createHmac('sha256', 'shh').update('tok123').digest('hex');
  assert.ok(seen.every((u) => u.searchParams.get('appsecret_proof') === proof));
  assert.ok(seen.every((u) => u.pathname.startsWith('/v23.0/')));
  assert.equal(m.label, 'Leads');
  assert.equal(m.goal.cost_per_result, 40);
  assert.equal(m.daily.length, 2);
  assert.equal(m.daily.find((d) => d.date === '2026-11-01').results, 5); // the custom conversion is not a main result
  assert.equal(m.ads[0].thumb, 'https://x/t.jpg');
  assert.equal(m.ads[0].video, true);
  assert.equal(m.reach.now, 3000);
});

test('Meta: picks leads by default when nothing is chosen', async () => {
  const m = await buildMeta({ client: { meta_ad_account: '123' }, from: '2026-11-01', to: '2026-11-30', env: ENV, fetchFn: fakeMeta() });
  assert.deepEqual(m.focus, ['lead']); assert.equal(m.picked, false);
});

test('Meta: friendly errors', async () => {
  const bad = async () => new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 400 });
  await assert.rejects(buildMeta({ client: { meta_ad_account: 'act_1' }, from: '2026-11-01', to: '2026-11-30', env: ENV, fetchFn: bad }), /no longer works/);
});

test('Meta: conversion list for the picker skips clicks and names custom conversions', async () => {
  const L = await listMetaConversions('act_123', { env: ENV, fetchFn: fakeMeta() });
  assert.ok(L.find((x) => x.type === 'lead' && x.count30 === 9));
  assert.ok(!L.find((x) => x.type === 'video_view'));
  assert.equal(L.find((x) => x.type === 'offsite_conversion.custom.555').name, 'Thank you page (custom)');
  assert.equal(actionName('offsite_conversion.fb_pixel_lead'), 'Leads on the website');
});

test('Meta: sample report carries Meta separately', () => {
  const r = demoReport('demo', '2026-11-01', '2026-11-30');
  assert.ok(r.platforms.meta.daily.length > 0);
  assert.equal(demoReport('demo-calls', '2026-11-01', '2026-11-30').platforms.meta, null);
  assert.equal(demoMeta('2026-11-01', '2026-11-07').daily.length, 14 * 3);
});

test('Meta goals are cleaned when saving a client', () => {
  const c = { name: 'M Co', customer_id: '1234567890', meta_ad_account: '987654321', meta_goals: { focus: ['lead', 'lead', 'bad value!'], watch: ['lead', 'contact'], label: ' Leads ', cost_per_result: '$40' } };
  assert.deepEqual(validate(c, [], null), []);
  assert.equal(c.meta_ad_account, 'act_987654321');
  assert.deepEqual(c.meta_goals, { focus: ['lead'], watch: ['contact'], label: 'Leads', cost_per_result: 40 });
  const d = { name: 'M Co', customer_id: '1234567890', meta_goals: { cost_per_result: 'abc' } };
  assert.ok(validate(d, [], null).join(' ').includes('Meta cost per result'));
});
