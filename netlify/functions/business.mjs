// GET  /api/business            (header x-admin-key) the saved Business snapshot from GoHighLevel
// POST /api/business            (header x-admin-key) rebuild it now (about 10 to 30 seconds)
import { isAdmin, jsonRes } from '../lib/auth.mjs';
import { savedBusiness, refreshBusiness } from '../lib/business.mjs';

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  if (req.method === 'POST') {
    try { const snap = await refreshBusiness(); return jsonRes({ saved_at: Date.now(), snap }); }
    catch (e) { return jsonRes({ error: e.message }, e.status === 503 ? 503 : 502); }
  }
  const hit = await savedBusiness();
  if (hit) return jsonRes({ saved_at: hit.saved_at, snap: hit.snap });
  try { const snap = await refreshBusiness(); return jsonRes({ saved_at: Date.now(), snap }); }
  catch (e) { return jsonRes({ error: e.message }, e.status === 503 ? 503 : 502); }
};

export const config = { path: '/api/business' };
