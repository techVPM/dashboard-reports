// GET /api/report?k=<client token>&days=30            (preset ending yesterday)
// GET /api/report?k=<client token>&from=2026-10-01&to=2026-10-30   (custom range)
import { buildReport, AdsError } from '../lib/ads.mjs';
import { demoReport } from '../lib/demo.mjs';
import { cacheGet, cachePut, findClientAsync, latestKey } from '../lib/store.mjs';
import { resolveRange, cacheKey } from '../lib/range.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'x-robots-tag': 'noindex, nofollow',
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=60', ...CORS, ...extra } });

// How long a stored copy is considered fresh. The 10 am refresh keeps the presets warm.
const FRESH_HOURS_PAST = 20;   // range ends yesterday or earlier
const FRESH_HOURS_TODAY = 2;   // range includes today (still moving)

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = url.searchParams.get('k') || '';

  if (token === 'demo' || token === 'demo-calls') {
    const r = resolveRange(url.searchParams, 'America/Denver');
    if (r.error) return json({ error: r.error }, 400);
    return json(demoReport(token, r.from, r.to));
  }

  const client = await findClientAsync(token);
  if (!client) return json({ error: 'This report link is not valid. Ask your Video Power Marketing contact for a new one.' }, 404);

  const r = resolveRange(url.searchParams, client.timezone);
  if (r.error) return json({ error: r.error }, 400);

  const key = cacheKey(client, r.from, r.to);
  const secret = process.env.REFRESH_SECRET;
  const force = url.searchParams.get('fresh') === '1' && secret && url.searchParams.get('s') === secret;

  const cached = await cacheGet(key);
  const ageH = cached ? (Date.now() - cached.saved_at) / 36e5 : Infinity;
  const maxAge = r.to >= r.today ? FRESH_HOURS_TODAY : FRESH_HOURS_PAST;
  if (cached && ageH < maxAge && !force) return json(cached.payload);

  try {
    const payload = await buildReport({ client, from: r.from, to: r.to });
    await cachePut(key, { saved_at: Date.now(), payload });
    if (!url.searchParams.get('from') && r.to < r.today && payload.meta.range.days === 30) await cachePut(latestKey(client.token), { saved_at: Date.now(), payload });
    return json(payload);
  } catch (e) {
    console.error('report failed', client.name, e.message, e.detail || '');
    if (cached) {
      cached.payload.meta.stale = true;
      return json(cached.payload);
    }
    const msg = e instanceof AdsError && e.status === 500 ? 'The report is not set up yet. Contact Video Power Marketing.' : 'The report data could not be loaded. Try again in a few minutes.';
    // With the secret in the link (&s=...), show the real reason so setup problems are easy to diagnose.
    const body = { error: msg };
    if (secret && url.searchParams.get('s') === secret) body.reason = e.message;
    return json(body, 502);
  }
};

export const config = { path: '/api/report' };
