// /api/admin  (header x-admin-key)
//   GET                         -> { clients, source }
//   POST { action: 'save', client, original_token }  -> adds or updates one client
//   POST { action: 'delete', token }                 -> removes one client
// Saved changes go to Netlify storage and are used instead of clients.json from then on.
import { getClientsWithSource, saveClients, RESERVED } from '../lib/store.mjs';
import { cleanGoals } from '../lib/goals.mjs';
import { isAdmin, jsonRes } from '../lib/auth.mjs';
import { runQuery, digits } from '../lib/ads.mjs';

// Every conversion action in a Google Ads account, with how many it counted in the last 30 days,
// so the admin page can offer them as tick boxes instead of typing names.
export async function listConversions(customerId, opts = {}) {
  const [acts, counts] = await Promise.all([
    runQuery(customerId, "SELECT conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status = 'ENABLED'", opts),
    runQuery(customerId, 'SELECT segments.conversion_action_name, metrics.all_conversions FROM customer WHERE segments.date DURING LAST_30_DAYS AND metrics.all_conversions > 0', opts).catch(() => []),
  ]);
  const by = new Map();
  for (const r of acts) { const n = r.conversionAction?.name; if (n) by.set(n, { name: n, category: String(r.conversionAction.category || '').toLowerCase().replace(/_/g, ' '), primary: !!r.conversionAction.primaryForGoal, count30: 0 }); }
  for (const r of counts) {
    const n = r.segments?.conversionActionName; if (!n) continue;
    const o = by.get(n) || { name: n, category: '', primary: false, count30: 0 };
    o.count30 += Number(r.metrics?.allConversions || 0); by.set(n, o);
  }
  return [...by.values()].map((o) => ({ ...o, count30: Math.round(o.count30 * 10) / 10 })).sort((a, b) => b.count30 - a.count30 || a.name.localeCompare(b.name));
}

const TOKEN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const makeToken = (name, id) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + String(id || '').replace(/\D/g, '').slice(-4);

export function validate(c, list, original) {
  const errs = [];
  if (!c || typeof c !== 'object') return ['Missing client details.'];
  c.name = String(c.name || '').trim();
  c.customer_id = String(c.customer_id || '').trim();
  const d = c.customer_id.replace(/\D/g, '');
  if (!c.name) errs.push('Add the client name.');
  if (d.length !== 10) errs.push('The Google Ads ID must have 10 digits, like 123-456-7890.');
  else c.customer_id = d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  c.token = String(c.token || '').trim().toLowerCase() || makeToken(c.name, d);
  if (!TOKEN.test(c.token) || c.token.length < 4) errs.push('The link key can only use lowercase letters, numbers and dashes.');
  if (RESERVED.includes(c.token)) errs.push('That link key is reserved. Pick another.');
  if (list.some((x) => x.token === c.token && x.token !== original)) errs.push('Another client already uses the link key ' + c.token + '.');
  if (c.goals) {
    const g = cleanGoals(c.goals);
    if (c.goals.cost_per_conversion && !g.cost_per_conversion) errs.push('Target cost per conversion should be a number like 250 or a range like 200-300.');
  }
  return errs;
}

async function warm(token) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL, secret = process.env.REFRESH_SECRET;
  if (!base || !secret) return false;
  try {
    const r = await fetch(base + '/.netlify/functions/refresh-background', { method: 'POST', headers: { 'content-type': 'application/json', 'x-refresh-secret': secret }, body: JSON.stringify({ token, days: 30 }), signal: AbortSignal.timeout(8000) });
    return r.status < 300;
  } catch { return false; }
}

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('conversions')) {
    const id = digits(url.searchParams.get('conversions'));
    if (id.length !== 10) return jsonRes({ error: 'Add a 10 digit Google Ads ID first.' }, 400);
    if (process.env.VPM_DEV) return jsonRes({ conversions: [{ name: 'Booked Call', category: 'book appointment', primary: true, count30: 46 }, { name: 'Submit lead form', category: 'submit lead form', primary: false, count30: 56 }, { name: 'Local actions - Directions', category: 'get directions', primary: true, count30: 2 }, { name: 'YouTube follow-on views', category: 'default', primary: false, count30: 1 }] });
    try { return jsonRes({ conversions: await listConversions(id) }); }
    catch (e) { return jsonRes({ error: 'Could not read conversions from Google Ads: ' + e.message }, 502); }
  }
  const { clients, source, saved_at } = await getClientsWithSource();
  if (req.method === 'GET') return jsonRes({ clients, source, saved_at: saved_at || null });
  if (req.method !== 'POST') return jsonRes({ error: 'Not allowed.' }, 405);
  let body = {};
  try { body = await req.json(); } catch { return jsonRes({ error: 'Bad request.' }, 400); }
  const list = clients.map((c) => ({ ...c }));

  if (body.action === 'delete') {
    const i = list.findIndex((c) => c.token === body.token);
    if (i < 0) return jsonRes({ error: 'Client not found.' }, 404);
    list.splice(i, 1);
    await saveClients(list);
    return jsonRes({ ok: true, clients: list });
  }
  if (body.action === 'save') {
    const original = body.original_token || null;
    const c = { ...(body.client || {}) };
    const errs = validate(c, list, original);
    if (errs.length) return jsonRes({ error: errs.join(' ') }, 400);
    const i = original ? list.findIndex((x) => x.token === original) : -1;
    if (i >= 0) list[i] = c; else list.push(c);
    try { await saveClients(list); } catch (e) { return jsonRes({ error: e.message }, 500); }
    const warmed = c.disabled ? false : await warm(c.token);
    return jsonRes({ ok: true, client: c, clients: list, warmed });
  }
  return jsonRes({ error: 'Unknown action.' }, 400);
};

export const config = { path: '/api/admin' };
