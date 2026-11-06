// GoHighLevel (HighLevel API v2) for the Business page: clients, tenure, churn, revenue.
// Read-only. Uses a Private Integration key in GHL_TOKEN and the sub-account id in GHL_LOCATION_ID.
//
// Where each number comes from:
//   Client list    contacts tagged "client" (active) plus every contact with a paid invoice
//   Start date     custom field "Client Start Date", else the first paid invoice (marked as estimated)
//   End date       custom field "Client End Date", else the last paid invoice of a contact no longer tagged "client" (estimated)
//   Monthly fee    custom field "Monthly Retainer", else the typical amount of their recent monthly invoices
//   Cash           paid and partly paid invoices (amount actually paid)

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const DAY = 864e5;
export const DEFAULT_LOCATION = 'StKSixAuNDCkNJ4snXLn';

const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '');
export function ghlConfig(env = process.env) {
  const token = clean(env.GHL_TOKEN);
  if (!token) throw Object.assign(new Error('GoHighLevel is not connected yet. Add GHL_TOKEN in Netlify.'), { status: 503 });
  return { token, location: clean(env.GHL_LOCATION_ID) || DEFAULT_LOCATION };
}

export async function ghl(path, { env = process.env, fetchFn = fetch, method = 'GET', body, timeoutMs = 20000 } = {}) {
  const { token } = ghlConfig(env);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(BASE + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, Version: VERSION, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 ? ' The GoHighLevel key was not accepted. Check GHL_TOKEN in Netlify.'
        : res.status === 403 ? ' The GoHighLevel key is missing a permission for this (see the README).' : '';
      throw Object.assign(new Error('GoHighLevel ' + res.status + ' on ' + path.split('?')[0] + '.' + hint), { status: res.status, body: text.slice(0, 300) });
    }
    return text ? JSON.parse(text) : {};
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* ------------------------------ fetching ------------------------------ */

export async function fetchAll({ env = process.env, fetchFn = fetch } = {}) {
  const { location } = ghlConfig(env);
  const o = { env, fetchFn };
  const warnings = [];

  const fieldsRes = await ghl('/locations/' + location + '/customFields', o);
  const fields = (fieldsRes.customFields || []).map((f) => ({ id: f.id, name: f.name, key: f.fieldKey, type: f.dataType }));

  const invoices = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await ghl('/invoices/?altId=' + location + '&altType=location&limit=100&offset=' + offset, o);
    const list = r.invoices || [];
    invoices.push(...list.map(slimInvoice));
    if (list.length < 100 || invoices.length >= (r.total || 0)) break;
  }

  // Contacts tagged "client". The search filter format has changed over time, so a few spellings are tried.
  const tagged = new Map();
  const tries = [
    { field: 'tags', operator: 'eq', value: 'client' },
    { field: 'tags', operator: 'contains', value: 'client' },
    { field: 'tags', operator: 'eq', value: ['client'] },
  ];
  let searchOk = false;
  for (const f of tries) {
    try {
      for (let page = 1; page <= 20; page++) {
        const r = await ghl('/contacts/search', { ...o, method: 'POST', body: { locationId: location, page, pageLimit: 100, filters: [f] } });
        const list = r.contacts || [];
        for (const c of list) tagged.set(c.id, slimContact(c));
        if (list.length < 100) break;
      }
      searchOk = true; break;
    } catch (e) { if (e.status === 401) throw e; }
  }
  if (!searchOk) warnings.push('Could not search contacts by the "client" tag, so only clients with invoices are listed.');

  // Every contact on an invoice, for tags and custom fields.
  const ids = [...new Set(invoices.map((v) => v.contact_id).filter(Boolean))].filter((id) => !tagged.has(id));
  const contacts = new Map(tagged);
  await pool(ids, 5, async (id) => {
    try { const r = await ghl('/contacts/' + id, o); if (r.contact) contacts.set(id, slimContact(r.contact)); }
    catch (e) { if (e.status === 401) throw e; }
  });
  return { location, fields, invoices, contacts: [...contacts.values()], warnings };
}

function slimInvoice(v) {
  const cd = v.contactDetails || {};
  return {
    id: v._id, number: v.invoiceNumber, name: v.name || '', status: v.status, total: Number(v.total || v.invoiceTotal || 0),
    paid: Number(v.amountPaid || 0), due: Number(v.amountDue || 0), issued: v.issueDate || v.createdAt, due_date: v.dueDate,
    paid_at: v.lastPaidAt || null, recurring: v.scheduleType === 'recurring', live: v.liveMode !== false,
    contact_id: cd.id || '', contact_name: cd.name || '', company: cd.companyName || '',
    items: (v.invoiceItems || []).map((i) => ({ name: i.name || '', amount: Number(i.amount || 0) * Number(i.qty || 1) })),
  };
}
function slimContact(c) {
  return {
    id: c.id, name: [c.firstNameRaw || c.firstName, c.lastNameRaw || c.lastName].filter(Boolean).join(' ') || c.contactName || c.name || '',
    company: c.companyName || '', source: String(c.source || '').trim(), email: c.email || '', tags: (c.tags || []).map((t) => String(t).toLowerCase().trim()), added: c.dateAdded || null,
    fields: Object.fromEntries((c.customFields || c.customField || []).map((f) => [f.id, f.value ?? f.field_value ?? f.fieldValue])),
  };
}

/* ------------------------------ the numbers ------------------------------ */

const MONTH = 30.4375 * DAY;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const r2 = (v) => Math.round(v * 100) / 100;
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const digits = (s) => String(s || '').replace(/\D/g, '');
function asDate(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(String(v).length === 10 ? v + 'T12:00:00Z' : v);
  return Number.isFinite(t) ? t : null;
}
function asMoney(v) { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; }

// Finds our custom fields by name, so they work whatever GoHighLevel named their keys.
export function findFields(fields) {
  const by = (re) => (fields.find((f) => re.test(f.name || '')) || {}).id || null;
  return {
    start: by(/^client\s*start/i), end: by(/^client\s*end/i), retainer: by(/retainer/i),
    reason: by(/churn\s*reason|reason.*(left|lost|churn)/i), ads: by(/google\s*ads.*(account|customer)?\s*id/i),
  };
}

const isMonthlyItem = (n) => /month|mgmt|management|retainer/i.test(n);
const isClientTag = (tags) => tags.includes('client');

export function computeBusiness({ fields = [], invoices = [], contacts = [], warnings = [], now = Date.now(), reportClients = [] }) {
  const F = findFields(fields);
  const live = invoices.filter((v) => v.live !== false);
  const paidInv = live.filter((v) => (v.status === 'paid' || v.status === 'partially_paid') && v.paid > 0)
    .map((v) => ({ ...v, t: asDate(v.paid_at) || asDate(v.issued) }));
  const byContact = new Map();
  for (const v of paidInv) { if (!byContact.has(v.contact_id)) byContact.set(v.contact_id, []); byContact.get(v.contact_id).push(v); }
  const cmap = new Map(contacts.map((c) => [c.id, c]));
  const ids = new Set([...byContact.keys(), ...contacts.filter((c) => isClientTag(c.tags) || (F.start && c.fields[F.start])).map((c) => c.id)]);
  const reportByAds = new Map(reportClients.filter((c) => c.customer_id).map((c) => [digits(c.customer_id), c]));
  const reportByGhl = new Map(reportClients.filter((c) => c.ghl_contact_id).map((c) => [c.ghl_contact_id, c]));

  const rows = [];
  for (const id of ids) {
    if (!id) continue;
    const c = cmap.get(id) || { id, name: '', company: '', tags: [], fields: {} };
    const inv = (byContact.get(id) || []).sort((a, b) => a.t - b.t);
    const anyInv = inv[0] || live.find((v) => v.contact_id === id) || {};
    const name = c.company || anyInv.company || c.name || anyInv.contact_name || 'Unknown';
    const tagged = isClientTag(c.tags);
    const fStart = F.start ? asDate(c.fields[F.start]) : null;
    const fEnd = F.end ? asDate(c.fields[F.end]) : null;
    const fRet = F.retainer ? asMoney(c.fields[F.retainer]) : null;
    const firstPaid = inv.length ? inv[0].t : null, lastPaid = inv.length ? inv[inv.length - 1].t : null;
    const start = fStart || firstPaid || (tagged ? asDate(c.added) : null);
    if (!start) continue;
    const active = tagged && !(fEnd && fEnd <= now);
    const end = active ? null : (fEnd || lastPaid || start);
    const cash = r2(inv.reduce((a, v) => a + v.paid, 0));
    // typical monthly fee: the monthly line items on their last three invoices
    const monthlyAmts = inv.slice(-3).map((v) => { const m = v.items.filter((i) => isMonthlyItem(i.name)).reduce((a, i) => a + i.amount, 0); return m || (v.recurring ? v.total : 0); }).filter((x) => x > 0);
    const retainer = fRet || (monthlyAmts.length ? median(monthlyAmts) : null);
    const monthly = !!(fRet || inv.length >= 2 || inv.some((v) => v.recurring) || monthlyAmts.length);
    const months = Math.max(0, ((end || now) - start) / MONTH);
    const linked = reportByGhl.get(id) || null;
    const ads = (F.ads ? digits(c.fields[F.ads]) : '') || (linked ? digits(linked.customer_id) : '');
    // fee history from the monthly line items on each paid invoice, for the recurring revenue chart
    const feeHist = inv.map((v) => { const m = v.items.filter((i) => isMonthlyItem(i.name)).reduce((a, i) => a + i.amount, 0); return [v.t, m || (v.recurring ? v.total : 0)]; }).filter((x) => x[1] > 0);
    // an explicit link in admin wins; the Google Ads ID only links clients that have no contact picked
    const byAds = ads ? reportByAds.get(ads) : null;
    const rep = linked || (byAds && !byAds.ghl_contact_id ? byAds : null);
    rows.push({
      id, name, contact: c.name || anyInv.contact_name || '', active, monthly,
      start: ymd(start), start_est: !fStart, end: end ? ymd(end) : null, end_est: !active && !fEnd,
      months: r2(months), retainer: retainer ? r2(retainer) : null, retainer_est: !fRet && !!retainer,
      cash, invoices: inv.length, last_paid: lastPaid ? ymd(lastPaid) : null,
      reason: F.reason ? String(c.fields[F.reason] || '') : '',
      report: rep ? '/' + rep.token : null, token: rep ? rep.token : null, no_invoices: tagged && !inv.length,
      ads, source: c.source || '', email: c.email || '',
      _fees: feeHist, _fret: fRet,
    });
  }
  rows.sort((a, b) => (b.active - a.active) || b.cash - a.cash);

  // headline numbers
  const d = new Date(now), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const t = (s) => asDate(s);
  const act = rows.filter((r) => r.active);
  const mon = rows.filter((r) => r.monthly);
  const activeAt = (ts) => mon.filter((r) => t(r.start) <= ts && (!r.end || t(r.end) >= ts)).length;
  const lostIn = (a, b) => mon.filter((r) => !r.active && r.end && t(r.end) >= a && t(r.end) < b).length;
  const newIn = (a, b) => rows.filter((r) => t(r.start) >= a && t(r.start) < b).length;
  const startYear = activeAt(y0), lostYear = lostIn(y0, now + DAY);
  // everyone we worked with on a monthly basis this year: on the books Jan 1, plus those who started since
  const yearBase = startYear + mon.filter((r) => t(r.start) >= y0).length;
  const mrr = act.reduce((a, r) => a + (r.retainer || 0), 0);
  const ended = mon.filter((r) => !r.active);
  const old6 = mon.filter((r) => t(r.start) <= now - 6 * MONTH), old12 = mon.filter((r) => t(r.start) <= now - 12 * MONTH);

  // monthly history, last 12 months
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1), b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 1);
    months.push({
      month: ymd(a).slice(0, 7),
      cash: r2(paidInv.filter((v) => v.t >= a && v.t < b).reduce((s, v) => s + v.paid, 0)),
      active: mon.filter((r) => t(r.start) < b && (!r.end || t(r.end) >= a)).length,
      new: newIn(a, b), lost: lostIn(a, b),
    });
  }
  // monthly churn: clients lost in a month / monthly clients active at its start, last 6 full months
  const six = months.slice(-7, -1);
  const churnBase = six.reduce((s, m) => s + activeAt(asDate(m.month + '-01')), 0);
  const churnLost = six.reduce((s, m) => s + m.lost, 0);

  // recurring revenue (MRR) over the same 12 months: what monthly clients were paying at each month end,
  // split into new clients, lost clients and fee changes. Fees come from their invoices at the time.
  const feeAt = (r, T) => {
    if (T >= now - DAY && r.active && r.retainer) return r.retainer; // today matches the headline number
    let f = null; for (const [ft, amt] of r._fees) { if (ft <= T) f = amt; else break; }
    return f ?? (r._fees[0]?.[1] ?? r.retainer ?? 0);
  };
  const isOn = (r, T) => t(r.start) <= T && (!r.end || t(r.end) >= T);
  const mrrAt = (T) => mon.reduce((s, r) => s + (isOn(r, T) ? feeAt(r, T) : 0), 0);
  for (const m of months) {
    const a = asDate(m.month + '-01'), b0 = Date.UTC(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 1), b = Math.min(b0 - 1, now);
    const startM = mrrAt(a - 1), endM = mrrAt(b);
    const nw = mon.filter((r) => t(r.start) >= a && t(r.start) <= b).reduce((s, r) => s + feeAt(r, b), 0);
    const lost = mon.filter((r) => r.end && t(r.end) >= a && t(r.end) <= b && !isOn(r, b)).reduce((s, r) => s + feeAt(r, t(r.end)), 0);
    Object.assign(m, { mrr: r2(endM), mrr_new: r2(nw), mrr_lost: r2(lost), mrr_changed: r2(endM - startM - nw + lost) });
  }

  // churn reasons, among clients who left
  const reasonMap = new Map();
  for (const r of mon.filter((x) => !x.active)) {
    const k = (r.reason || '').trim() || 'No reason recorded';
    const o = reasonMap.get(k.toLowerCase()) || { reason: k, count: 0, cash: 0, clients: [] };
    o.count++; o.cash += r.cash; o.clients.push(r.name); reasonMap.set(k.toLowerCase(), o);
  }
  const reasons = [...reasonMap.values()].map((o) => ({ ...o, cash: r2(o.cash) })).sort((a, b) => b.count - a.count);

  // where the best clients come from (GoHighLevel contact source)
  const srcMap = new Map();
  for (const r of rows) {
    const k = (r.source || '').trim() || 'Unknown';
    const o = srcMap.get(k.toLowerCase()) || { source: k, clients: 0, active: 0, cash: 0, months: 0 };
    o.clients++; o.active += r.active ? 1 : 0; o.cash += r.cash; o.months += r.months; srcMap.set(k.toLowerCase(), o);
  }
  const sources = [...srcMap.values()].map((o) => ({ source: o.source, clients: o.clients, active: o.active, ltv: r2(o.cash / o.clients), avg_months: r2(o.months / o.clients), cash: r2(o.cash) }))
    .sort((a, b) => b.cash - a.cash);

  // retention by the quarter clients started (monthly clients), last 8 quarters
  const qOf = (ts) => { const x = new Date(ts); return x.getUTCFullYear() + ' Q' + (Math.floor(x.getUTCMonth() / 3) + 1); };
  const cohortMap = new Map();
  for (const r of mon) {
    const k = qOf(t(r.start));
    const o = cohortMap.get(k) || { quarter: k, started: 0, active: 0, months: 0, old3: 0, hit3: 0, old6: 0, hit6: 0, old12: 0, hit12: 0 };
    o.started++; o.active += r.active ? 1 : 0; o.months += r.months;
    for (const n of [3, 6, 12]) if (t(r.start) <= now - n * MONTH) { o['old' + n]++; if (r.months >= n) o['hit' + n]++; }
    cohortMap.set(k, o);
  }
  const cohorts = [...cohortMap.values()].sort((a, b) => a.quarter.localeCompare(b.quarter)).slice(-8).map((o) => ({
    quarter: o.quarter, started: o.started, active: o.active, avg_months: r2(o.months / o.started),
    stay3: o.old3 ? r2(o.hit3 / o.old3) : null, stay6: o.old6 ? r2(o.hit6 / o.old6) : null, stay12: o.old12 ? r2(o.hit12 / o.old12) : null,
    n3: o.old3, n6: o.old6, n12: o.old12,
  }));

  // invoices that need attention
  const open = live.filter((v) => ['sent', 'partially_paid', 'overdue', 'draft'].includes(v.status) && (v.due > 0 || v.status === 'draft'));
  const billing = open.map((v) => {
    const dueT = asDate(v.due_date);
    const kind = v.status === 'draft' ? 'draft' : dueT && dueT < now ? 'overdue' : 'upcoming';
    return { client: v.company || v.contact_name, contact_id: v.contact_id || '', number: v.number, amount: r2(v.due || v.total), due: dueT ? ymd(dueT) : null, kind, status: v.status };
  }).sort((a, b) => ({ overdue: 0, upcoming: 1, draft: 2 }[a.kind] - { overdue: 0, upcoming: 1, draft: 2 }[b.kind]) || String(a.due).localeCompare(String(b.due)));

  // cash forecast: monthly fees from active clients on their usual billing day, plus invoices already sent
  const MON = 30.4375 * DAY;
  const openBy = new Set(open.filter((v) => v.status !== 'draft').map((v) => v.contact_id));
  const forecast = [30, 60, 90].map((n) => {
    const until = now + n * DAY;
    let fees = 0;
    for (const r of act.filter((x) => x.monthly && x.retainer)) {
      const anchor = asDate(r.last_paid) || t(r.start);
      let next = anchor + MON, count = 0;
      while (next <= until) { if (next > now - 31 * DAY) count++; next += MON; }
      if (openBy.has(r.id) && count) count--; // the open invoice already covers the next one
      fees += count * r.retainer;
    }
    const sent = open.filter((v) => v.status !== 'draft' && (!asDate(v.due_date) || asDate(v.due_date) <= until)).reduce((s, v) => s + (v.due || v.total), 0);
    return { days: n, fees: r2(fees), invoices: r2(sent), total: r2(fees + sent) };
  });
  for (const r of rows) { delete r._fees; delete r._fret; }

  const W = warnings.slice();
  if (!F.start || !F.end) W.push('Add the custom fields "Client Start Date" and "Client End Date" in GoHighLevel. Until then, dates come from first and last payments.');
  if (!F.retainer) W.push('Add a "Monthly Retainer" custom field for exact monthly revenue. Until then it is estimated from recent invoices.');
  const noInv = rows.filter((r) => r.no_invoices).map((r) => r.name);
  if (noInv.length) W.push('Tagged "client" but no paid invoices in GoHighLevel (billed elsewhere?): ' + noInv.join(', ') + '.');
  const est = rows.filter((r) => r.start_est || r.end_est).length;

  return {
    generated_at: new Date(now).toISOString(),
    kpis: {
      active: act.length,
      mrr: r2(mrr),
      avg_retainer: act.length ? r2(mrr / act.length) : null,
      new_month: newIn(m0, now + DAY), new_year: newIn(y0, now + DAY),
      lost_month: lostIn(m0, now + DAY), lost_year: lostYear,
      active_jan1: startYear,
      churn_year: yearBase ? r2(lostYear / yearBase) : null,
      year_base: yearBase,
      churn_monthly: churnBase ? r2(churnLost / churnBase) : null,
      churn_lost_6m: churnLost, churn_base_6m: churnBase,
      avg_months: mon.length ? r2(mon.reduce((s, r) => s + r.months, 0) / mon.length) : null,
      median_months: mon.length ? r2(median(mon.map((r) => r.months))) : null,
      avg_months_ended: ended.length ? r2(ended.reduce((s, r) => s + r.months, 0) / ended.length) : null,
      reach6: old6.length ? r2(old6.filter((r) => r.months >= 6).length / old6.length) : null,
      reach6_n: old6.filter((r) => r.months >= 6).length, reach6_base: old6.length,
      reach12_n: old12.filter((r) => r.months >= 12).length, reach12_base: old12.length,
      reach12: old12.length ? r2(old12.filter((r) => r.months >= 12).length / old12.length) : null,
      ltv_ended: ended.length ? r2(ended.reduce((s, r) => s + r.cash, 0) / ended.length) : null,
      ltv_all: rows.length ? r2(rows.reduce((s, r) => s + r.cash, 0) / rows.length) : null,
      cash_30: r2(paidInv.filter((v) => v.t >= now - 30 * DAY).reduce((s, v) => s + v.paid, 0)),
      cash_year: r2(paidInv.filter((v) => v.t >= y0).reduce((s, v) => s + v.paid, 0)),
      overdue: r2(billing.filter((b) => b.kind === 'overdue').reduce((s, b) => s + b.amount, 0)),
    },
    months, clients: rows, billing, forecast, reasons, sources, cohorts,
    quality: { fields_found: F, estimated_dates: est, warnings: W },
  };
}
