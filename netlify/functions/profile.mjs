// GET /api/profile?c=<client token>   (header x-admin-key)
// One client on one page for the team: ad results against goals, billing and tenure from GoHighLevel,
// internal notes, and links to the report, Google Ads, GoHighLevel and Drive.
import { getClients } from '../lib/store.mjs';
import { savedReport } from '../lib/saved.mjs';
import { summarize, emptyRow, healthFor, bizByToken, adsLink, scopePayload, resolveScope } from '../lib/team.mjs';
import { savedBusiness, refreshBusiness } from '../lib/business.mjs';
import { applyGoals } from '../lib/goals.mjs';
import { isAdmin, jsonRes } from '../lib/auth.mjs';
import { videoRows } from '../lib/videos.mjs';
import { DEFAULT_LOCATION } from '../lib/ghl.mjs';

export default async (req) => {
  if (!isAdmin(req)) return jsonRes({ error: 'Wrong password.' }, 401);
  const url = new URL(req.url);
  const token = url.searchParams.get('c') || '';
  const all = await getClients();
  const c = all.find((x) => x.token === token);
  if (!c) return jsonRes({ error: 'Client not found. Pick one on the All clients page.' }, 404);

  let bizHit = await savedBusiness().catch(() => null);
  if (!bizHit && process.env.VPM_DEV) bizHit = { snap: await refreshBusiness().catch(() => null), saved_at: Date.now() };
  const snap = bizHit?.snap || null;
  const biz = bizByToken(snap, all).get(c.token) || null;
  const rowsB = snap ? snap.clients || [] : [];
  const bizRow = (c.ghl_contact_id && rowsB.find((r) => r.id === c.ghl_contact_id)) || (biz && rowsB.find((r) => r.id === biz.id)) || null;
  const openInv = snap && bizRow ? (snap.billing || []).filter((b) => b.contact_id === bizRow.id) : [];

  let row, videos = [];
  try {
    const hit = await savedReport(c, 30);
    if (hit) {
      row = summarize(c, hit.payload, hit.saved_at, 'default');
      row.health = healthFor(row, biz);
      videos = videoRows(c, scopePayload(hit.payload, resolveScope(c, 'default')).payload).filter((v) => v.impressions >= 500).sort((a, b) => (b.results - a.results) || (b.impressions - a.impressions)).slice(0, 5);
    } else row = emptyRow(c, 'No saved 30-day report yet');
  } catch (e) { row = emptyRow(c, 'Could not read the saved report: ' + e.message); }

  const loc = process.env.GHL_LOCATION_ID || DEFAULT_LOCATION;
  const ghlId = c.ghl_contact_id || bizRow?.id || null;
  return jsonRes({
    client: {
      name: c.name, token: c.token, customer_id: c.customer_id, disabled: !!c.disabled, timezone: c.timezone || 'America/Denver',
      default_scope: c.default_scope || 'all', goal_note: applyGoals(c).goals.note || '', goals: c.goals || {},
      internal_notes: c.internal_notes || '', meta_ad_account: c.meta_ad_account || '', drive_url: c.drive_url || '',
      ghl_contact_id: c.ghl_contact_id || '', last_change_date: c.last_change_date || null,
    },
    links: {
      report: '/' + c.token, ads: adsLink(c), admin: '/admin#' + c.token,
      ghl: ghlId ? 'https://app.gohighlevel.com/v2/location/' + loc + '/contacts/detail/' + encodeURIComponent(ghlId) : null,
      drive: c.drive_url && /^https:\/\//.test(c.drive_url) ? c.drive_url : null,
      meta: c.meta_ad_account ? 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + String(c.meta_ad_account).replace(/\D/g, '') : null,
    },
    ads: row, videos,
    business: bizRow ? { ...bizRow, open_invoices: openInv, linked_by: c.ghl_contact_id ? 'contact' : 'ads id' } : null,
    business_saved_at: bizHit?.saved_at || null, business_connected: !!snap, ghl_configured: !!process.env.GHL_TOKEN,
  });
};

export const config = { path: '/api/profile' };
