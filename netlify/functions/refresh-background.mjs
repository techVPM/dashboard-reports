// Background function (up to 15 minutes). Refreshes the 7, 30 and 90 day views for one client
// so the first visit of the day is instant. Custom date ranges are fetched on demand.
// Set REFRESH_PRESETS (for example "30") to refresh fewer views and use fewer Google Ads operations per day.
import { buildReport } from '../lib/ads.mjs';
import { cachePut, findClientAsync, latestKey } from '../lib/store.mjs';
import { presetRange, cacheKey, PRESETS } from '../lib/range.mjs';

export default async (req) => {
  if (req.headers.get('x-refresh-secret') !== process.env.REFRESH_SECRET || !process.env.REFRESH_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const client = await findClientAsync(body.token);
  if (!client) return new Response('unknown client', { status: 404 });

  const only = Number(body.days) || 0;
  const want = only && PRESETS.includes(only) ? [only] : String(process.env.REFRESH_PRESETS || '').split(',').map((x) => Number(x.trim())).filter((n) => PRESETS.includes(n));
  for (const days of want.length ? want : PRESETS) {
    const { from, to } = presetRange(days, client.timezone);
    try {
      const payload = await buildReport({ client, from, to });
      await cachePut(cacheKey(client, from, to), { saved_at: Date.now(), payload });
      await cachePut(latestKey(client.token, days), { saved_at: Date.now(), payload });
      console.log('refreshed', client.name, days + 'd', payload.meta.warnings.length ? 'warnings: ' + payload.meta.warnings.join('; ') : 'ok');
    } catch (e) {
      console.error('refresh failed', client.name, days + 'd', e.message);
      if (e.status === 429) break; // daily limit reached, do not keep hammering Google
    }
  }
  return new Response('done');
};
