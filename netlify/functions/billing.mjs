// GET  /api/billing   (header x-admin-key) the billing numbers from the team's Google Sheet (saved for 2 minutes)
// POST /api/billing   (header x-admin-key) read the sheet again now
// POST /api/billing   with JSON {action: 'update' | 'add' | 'next' | 'check' | 'year', ...}  (headers x-admin-key and x-billing-key)
//                     save a change into the sheet, then return the fresh numbers
import { isAdmin, isBillingEditor, jsonRes } from '../lib/auth.mjs';
import { savedBilling, refreshBilling } from '../lib/billing.mjs';
import { updateLine, addLine, startNextMonth, checkAll, setYearSheet } from '../lib/billing-write.mjs';

const FRESH = 2 * 60 * 1000; // so edits made in the sheet show up here within 2 minutes

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  let body = null;
  if (req.method === 'POST') { try { const t = await req.text(); body = t ? JSON.parse(t) : null; } catch { return jsonRes({ error: 'Bad request.' }, 400); } }

  if (body && body.action) {
    if (!String(process.env.BILLING_EDIT_PASSWORD || '').trim()) return jsonRes({ error: 'Editing is turned off. Add BILLING_EDIT_PASSWORD in Netlify to turn it on.' }, 503);
    if (!isBillingEditor(req)) return jsonRes({ error: 'Wrong billing password.', billing_auth: true }, 401);
    try {
      let result;
      const year = Number(body.year) || undefined;
      if (body.action === 'update') result = await updateLine({ year, tab: body.tab, row: body.row, expect: body.expect || {}, set: body.set || {} });
      else if (body.action === 'add') result = await addLine({ year, tab: body.tab, line: body.line || {} });
      else if (body.action === 'check') result = await checkAll();
      else if (body.action === 'year') result = await setYearSheet({ year: body.year, link: body.link });
      else if (body.action === 'next') result = await startNextMonth({ year, from: body.from });
      else return jsonRes({ error: 'Unknown action.' }, 400);
      const snap = await refreshBilling();
      return jsonRes({ saved_at: Date.now(), snap, result });
    } catch (e) {
      return jsonRes({ error: e.message }, [400, 409, 503].includes(e.status) ? e.status : 502);
    }
  }

  const hit = await savedBilling().catch(() => null);
  if (req.method !== 'POST' && hit && Date.now() - hit.saved_at < FRESH) return jsonRes({ saved_at: hit.saved_at, snap: hit.snap });
  try {
    const snap = await refreshBilling();
    return jsonRes({ saved_at: Date.now(), snap });
  } catch (e) {
    if (hit && e.status !== 503) return jsonRes({ saved_at: hit.saved_at, snap: hit.snap, stale: e.message });
    return jsonRes({ error: e.message }, e.status === 503 ? 503 : 502);
  }
};

export const config = { path: '/api/billing' };
