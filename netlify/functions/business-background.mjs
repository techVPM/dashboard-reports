// Background function: rebuilds the Business snapshot from GoHighLevel. Called by the daily refresh.
import { refreshBusiness } from '../lib/business.mjs';

export default async (req) => {
  if (!process.env.REFRESH_SECRET || req.headers.get('x-refresh-secret') !== process.env.REFRESH_SECRET) return new Response('forbidden', { status: 403 });
  if (!process.env.GHL_TOKEN) { console.log('business: GHL_TOKEN not set, skipped'); return; }
  try { const s = await refreshBusiness(); console.log('business refreshed:', s.kpis.active, 'active clients'); }
  catch (e) { console.error('business refresh failed', e.message); }
};
