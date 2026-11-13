// Billing page: reads the team's "Billing and Forecast" Google Sheet (one tab per month) and turns it into numbers.
// The sheet stays the source of truth. Changes made on the page are written into the sheet by billing-write.mjs.
//
// Settings (Netlify environment variables):
//   BILLING_SHEET_ID              the long id in the sheet's web address
//   GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET   a Web OAuth client in the same Google Cloud project as Google Ads
//   GOOGLE_SHEETS_REFRESH_TOKEN   a refresh token from that client: spreadsheets.readonly to view, or spreadsheets to
//                                 also save changes from the page. See the README.
//   BILLING_EDIT_PASSWORD         password the page asks for before it saves anything to the sheet
//   BILLING_START                 first month the sheet is accurate for, YYYY-MM (default 2026-10)
//   Next years: one new sheet per year. Its link is added on the Billing page (Edit invoices tab) and kept in
//   Netlify storage, so nothing changes in Netlify settings when a year starts.
//   BILLING_LAST_ROW              how far down each month tab is read (default 60; a long run of empty rows ends the list)
import { cacheGet, cachePut } from './store.mjs';
import { googleSheet, memorySheet, setupError } from './sheets.mjs';

export const BILLING_KEY = 'billing/latest';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 864e5;
const r2 = (v) => Math.round(v * 100) / 100;

export function billingConfig(env = process.env) {
  const sheetId = String(env.BILLING_SHEET_ID || '').trim();
  const start = /^\d{4}-\d{2}$/.test(String(env.BILLING_START || '')) ? env.BILLING_START : '2026-10';
  const lastRow = Math.max(10, Math.min(500, Number(env.BILLING_LAST_ROW) || 60));
  const refresh = String(env.GOOGLE_SHEETS_REFRESH_TOKEN || '').trim();
  // its own Web client when set (the OAuth Playground needs a Web client); otherwise the Google Ads one
  const own = String(env.GOOGLE_SHEETS_CLIENT_ID || '').trim();
  return {
    sheetId, start, lastRow, refresh,
    clientId: own || String(env.GOOGLE_ADS_CLIENT_ID || '').trim(),
    clientSecret: own ? String(env.GOOGLE_SHEETS_CLIENT_SECRET || '').trim() : String(env.GOOGLE_ADS_CLIENT_SECRET || '').trim(),
  };
}

// Which sheet holds which year: BILLING_SHEET_ID for the first year (from BILLING_START), then any added on the page.
export const YEARS_KEY = 'billing/sheets';
export async function billingSources(env = process.env) {
  const cfg = billingConfig(env), y0 = Number(cfg.start.slice(0, 4));
  const extra = ((await cacheGet(YEARS_KEY).catch(() => null)) || {}).years || {};
  const out = [{ year: y0, id: cfg.sheetId || (env.VPM_DEV ? 'demo' : ''), from: Number(cfg.start.slice(5, 7)) }];
  for (const [y, id] of Object.entries(extra)) if (Number(y) > y0 && id) out.push({ year: Number(y), id, from: 1 });
  return out.sort((a, b) => a.year - b.year);
}
export function sheetIdFromLink(s) {
  const t = String(s || '').trim(), m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : '';
}

// The sheet to read and write: Google's, or in-memory samples for the local preview.
const DEMO = new Map();
export async function getSheet(env = process.env, fetchFn = fetch, year) {
  const cfg = billingConfig(env);
  const src = await billingSources(env);
  const s = year ? src.find((x) => x.year === Number(year)) : src[0];
  if (!s || !s.id) throw setupError(year ? `There is no sheet for ${year} yet. Add its link on the Billing page (Edit invoices tab).` : 'Billing is not connected yet. Add BILLING_SHEET_ID in Netlify (the README has the steps).');
  if (env.VPM_DEV && !cfg.sheetId) {
    if (!DEMO.has(s.id)) {
      const m = await import('./demo-billing.mjs');
      DEMO.set(s.id, s.id === 'demo' ? memorySheet(m.demoBillingTabs(Date.now()).slice().reverse(), 'Sample billing sheet', 'demo')
        : memorySheet(m.demoNextYear(Date.now()), `Sample ${s.year} billing sheet`, s.id));
    }
    return DEMO.get(s.id);
  }
  return googleSheet({ ...cfg, sheetId: s.id, fetchFn });
}
// Month tabs are named "November 2026" (or just "November"). Anything else, like "November (old ...)", is not a month.
const TITLE_RE = /^\s*([a-z]+)(?:\s+(\d{4}))?\s*$/i;
export const monthOfTitle = (t) => { const m = String(t).match(TITLE_RE); return m ? MONTHS.findIndex((n) => n.toLowerCase() === m[1].toLowerCase()) : -1; };
export const yearOfTitle = (t) => { const m = String(t).match(TITLE_RE); return m && m[2] ? Number(m[2]) : null; };
// the name for a new month tab, in the same style as the tab it came from
export const monthTitle = (m, year, like) => (yearOfTitle(like) != null ? `${MONTHS[m]} ${year}` : MONTHS[m]);
export { MONTHS };

// Month tabs from BILLING_START onward, from every year's sheet.
export async function fetchBillingTabs({ env = process.env, fetchFn = fetch, sheet } = {}) {
  const cfg = billingConfig(env);
  if (sheet) return fetchOne({ cfg, sheet, year: Number(cfg.start.slice(0, 4)), from: Number(cfg.start.slice(5, 7)) });
  const src = await billingSources(env), parts = [];
  for (const s of src) {
    const sh = await getSheet(env, fetchFn, s.year);
    try { parts.push(await fetchOne({ cfg, sheet: sh, year: s.year, from: s.from })); }
    catch (e) { if (s === src[0]) throw e; parts.push({ title: '', year: s.year, cfg, sheet: sh, tabs: [], error: e.message }); }
  }
  return { title: parts[0].title, year: parts[0].year, cfg, sheet: parts[0].sheet, tabs: parts.flatMap((p) => p.tabs), years: parts.map((p) => ({ year: p.year, id: p.sheet.sheetId, title: p.title, error: p.error || null })) };
}
async function fetchOne({ cfg, sheet, year: y0, from: m0 }) {
  const meta = await sheet.meta();
  const tabs = meta.tabs.map((t) => ({ ...t, m: monthOfTitle(t.title), y: yearOfTitle(t.title) }))
    // one sheet per year: months before the start are not accurate yet, and a tab named for another year is skipped
    .filter((x) => x.m >= 0 && x.m + 1 >= m0 && (x.y == null || x.y === y0));
  const vals = await sheet.read(tabs.map((x) => ({ tab: x.title, rows: cfg.lastRow })));
  // the GHL contact links behind the Billing POC cells (a second small read; the page still works if it fails)
  const pocCols = vals.map((v) => pocColumn(v));
  const want = tabs.map((x, i) => ({ tab: x.title, col: pocCols[i], rows: cfg.lastRow, i })).filter((r) => r.col);
  let links = [];
  try { links = sheet.links ? await sheet.links(want) : []; } catch { links = []; }
  const linkBy = new Map(want.map((r, k) => [r.i, links[k] || []]));
  return {
    title: meta.title, year: y0, cfg, sheet,
    tabs: tabs.map((x, i) => ({ id: x.id, index: x.index, title: x.title, year: y0, sheet_id: sheet.sheetId, month: `${y0}-${String(x.m + 1).padStart(2, '0')}`, values: vals[i], links: linkBy.get(i) || [] })),
  };
}

/* ---------- parsing ---------- */
export const money = (s) => {
  const t = String(s ?? '').replace(/[$,\s]/g, '');
  if (!t || /^[-\u2013\u2014]$/.test(t)) return null;
  const n = Number(t.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
};
export const usDate = (s) => {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
};
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase();

const COLS = {
  client: ['client name', 'client'], poc: ['billing poc', 'invoice contact name'], start: ['start date', 'contract start date'],
  service: ['service category', 'invoice description - services rendered'], spend: ['monthly ad spend', 'ad spend'],
  amount: ['invoice amount'], istatus: ['invoice status'], idate: ['invoice date'], pstatus: ['payment status'],
  notes: ['invoice notes', '{notes}'], method: ['payment method'], status: ['status'], referral: ['referral partner (10%)'], more: ['additional notes'],
};

// 1-based column of "Billing POC" in a tab, or 0
export function pocColumn(values) {
  const rows = values || [];
  const r = rows.find((x) => (x || []).some((c) => key(c) === 'client name'));
  if (!r) return 0;
  const i = r.map(key).findIndex((h) => COLS.poc.includes(h));
  return i >= 0 ? i + 1 : 0;
}

// One month tab → its line items and the summary block at the top. links[i] is the link behind row i+1's Billing POC.
export function parseMonth(values, month, links = []) {
  const rows = values || [];
  const hi = rows.findIndex((r) => (r || []).some((c) => key(c) === 'client name'));
  const warnings = [];
  if (hi < 0) return { month, lines: [], summary: {}, col: {}, header_row: null, last_row: null, warnings: ['No "Client Name" header row found in this tab.'] };
  const head = rows[hi].map(key), col = {};
  for (const [k, names] of Object.entries(COLS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; }
  if (col.amount == null) warnings.push('No "Invoice Amount" column found.');
  // summary pairs above the header: "Total Active Clients:" 10, "Total Revenue Invoice:" $28,500 ...
  const summary = {};
  const SUM = { 'total active clients': 'active', 'total client ad spend': 'ad_spend', 'total revenue invoice': 'invoiced', 'new clients': 'new', 'lost clients': 'lost', 'average monthly client value': 'avg_value' };
  for (const r of rows.slice(0, hi)) (r || []).forEach((c, i) => { const k = SUM[key(c).replace(/:$/, '')]; if (k && summary[k] == null) summary[k] = money(r[i + 1]); });

  const lines = []; let cur = null, num = 0, gap = 0, lastUsed = hi + 1, maxNum = 0;
  const g = (r, k) => (col[k] == null ? '' : norm(r[col[k]]));
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.some((c) => key(c) === 'monthly summary')) break; // a second copy of the block below; not line items
    // a long run of empty rows ends the list: anything far below is leftover, not this month's billing
    if (!r.some((c) => norm(c))) { if (++gap >= 5 && lines.length) break; continue; }
    gap = 0; lastUsed = i + 1;
    const n0 = Number(norm(r[0])); if (Number.isFinite(n0) && n0 > maxNum) maxNum = n0;
    const name = g(r, 'client'), service = g(r, 'service'), amtRaw = g(r, 'amount'), amount = money(amtRaw);
    const note = [g(r, 'notes'), g(r, 'more')].filter(Boolean).join(' · ');
    if (name) {
      const ln = String(links[i] || '');
      cur = { name, poc: g(r, 'poc'), poc_link: /^https:\/\//i.test(ln) ? ln : '', status: g(r, 'status'), referral: g(r, 'referral') }; num++;
    } else if (!service && amount == null) {
      // a note on its own row belongs to the line above
      if (note && lines.length) { const L = lines[lines.length - 1]; L.notes = [L.notes, note].filter(Boolean).join(' · '); L.note_row = i + 1; }
      continue;
    }
    if (!cur) continue;
    if (!service && amount == null && !g(r, 'istatus')) continue;
    if (amtRaw && amount == null) warnings.push(`Row ${i + 1}: could not read the invoice amount "${amtRaw}".`);
    lines.push({
      row: i + 1, client: cur.name, poc: cur.poc, poc_link: cur.poc_link, client_status: cur.status, service: service || 'Other',
      ad_spend: money(g(r, 'spend')), amount: amount || 0, invoice_status: g(r, 'istatus'), invoice_date: usDate(g(r, 'idate')),
      payment_status: g(r, 'pstatus'), method: g(r, 'method'), notes: note, referral: cur.referral,
      inv_notes: g(r, 'notes'), add_notes: g(r, 'more'), first: !!name, amount_raw: amtRaw,
    });
  }
  return { month, lines, summary, warnings, clients_listed: num, col, header_row: hi + 1, last_row: lastUsed, max_num: maxNum };
}

const isPaid = (l) => /^paid$/i.test(l.payment_status);
const noBill = (l) => /do not send/i.test(l.invoice_status);
const failed = (l) => /declin|fail/i.test(l.payment_status);
export const outstanding = (l) => l.amount > 0 && !isPaid(l) && !noBill(l);
const svc = (s) => (/ads? management/i.test(s) ? 'ads' : /video/i.test(s) ? 'video' : 'other');

// Everything the page needs, from the parsed tabs.
export function computeBilling({ tabs = [], now = Date.now(), title = '', sheetId = '' } = {}) {
  const today = new Date(now).toISOString().slice(0, 10), thisMonth = today.slice(0, 7);
  const warnings = [];
  // the sheet lists tabs newest first; the page reads oldest to newest
  const months = tabs.slice().sort((x, y) => String(x.month).localeCompare(String(y.month))).map((t) => {
    const p = parseMonth(t.values, t.month, t.links);
    const L = p.lines;
    const sum = (f) => r2(L.filter(f).reduce((s, l) => s + l.amount, 0));
    const state = t.month < thisMonth ? 'closed' : t.month === thisMonth ? 'current' : 'forecast';
    // a tab copied from another month still carries that month's invoice dates
    const dated = L.filter((l) => l.invoice_date), off = dated.filter((l) => l.invoice_date.slice(0, 7) !== t.month);
    const copied = dated.length >= 3 && off.length / dated.length >= 0.8;
    if (copied) p.warnings.push(`Most invoice dates in ${t.title} are from ${MONTHS[Number(off[0].invoice_date.slice(5, 7)) - 1]}, so this tab looks like a copy and is treated as a placeholder.`);
    for (const w of p.warnings) warnings.push(`${t.title}: ${w}`);
    const clients = [...new Set(L.map((l) => key(l.client)))];
    const spendBy = new Map(); for (const l of L) if (l.ad_spend != null) spendBy.set(key(l.client), (spendBy.get(key(l.client)) || 0) + l.ad_spend);
    return {
      month: t.month, title: t.title, year: Number(String(t.month).slice(0, 4)), tab_id: t.id ?? null,
      sheet_url: t.sheet_id && !/^demo/.test(t.sheet_id) ? 'https://docs.google.com/spreadsheets/d/' + t.sheet_id + '/edit' : null, state, placeholder: state === 'forecast' || copied, copied,
      invoiced: sum(() => true), collected: sum(isPaid), outstanding: sum(outstanding), failed: sum((l) => failed(l) && !noBill(l)),
      ads: sum((l) => svc(l.service) === 'ads'), video: sum((l) => svc(l.service) === 'video'), other: sum((l) => svc(l.service) === 'other'),
      clients: clients.length, billed_clients: new Set(L.filter((l) => l.amount > 0).map((l) => key(l.client))).size,
      ad_spend: r2([...spendBy.values()].reduce((a, b) => a + b, 0)),
      summary: p.summary, lines: L,
    };
  });

  // Things that need a look, from real months only (not placeholders)
  const attention = [];
  for (const m of months.filter((x) => !x.placeholder)) for (const l of m.lines) {
    if (noBill(l) || !(l.amount > 0)) continue;
    const age = l.invoice_date ? Math.floor((Date.parse(today) - Date.parse(l.invoice_date)) / DAY) : null;
    let why = null, level = 'warn';
    if (failed(l)) { why = 'Card declined'; level = 'bad'; }
    else if (/needs discussion/i.test(l.invoice_status)) why = 'Needs discussion';
    else if (outstanding(l) && /sent/i.test(l.invoice_status) && age != null && age >= 7) { why = `Sent ${age} days ago, not paid`; level = age >= 30 ? 'bad' : 'warn'; }
    else if (outstanding(l) && /wait/i.test(l.invoice_status) && age != null && age > 0) why = `Invoice date passed ${age} day${age === 1 ? '' : 's'} ago, still waiting to send`;
    else if (outstanding(l) && /^unpaid$/i.test(l.payment_status) && age != null && age >= 14) why = `Unpaid for ${age} days`;
    if (why) attention.push({ month: m.month, client: l.client, service: l.service, amount: l.amount, invoice_status: l.invoice_status, payment_status: l.payment_status, invoice_date: l.invoice_date, why, level, notes: l.notes });
  }
  attention.sort((a, b) => (a.level === 'bad' ? 0 : 1) - (b.level === 'bad' ? 0 : 1) || b.amount - a.amount);

  // Each client across the months that are real
  const real = months.filter((m) => !m.placeholder), byClient = new Map();
  for (const m of real) for (const l of m.lines) {
    const k = key(l.client);
    const o = byClient.get(k) || { client: l.client, months: new Set(), total: 0, ads: 0, video: 0, other: 0, collected: 0, outstanding: 0, last_paid: null, ad_spend: 0, status: '', poc: '', poc_link: '' };
    if (l.poc) o.poc = l.poc; if (l.poc_link) o.poc_link = l.poc_link;
    o.months.add(m.month); o.total += l.amount; o[svc(l.service)] += l.amount;
    if (isPaid(l)) { o.collected += l.amount; if (l.invoice_date && (!o.last_paid || l.invoice_date > o.last_paid)) o.last_paid = l.invoice_date; }
    if (outstanding(l)) o.outstanding += l.amount;
    if (l.ad_spend) o.ad_spend += l.ad_spend;
    if (l.client_status) o.status = l.client_status;
    byClient.set(k, o);
  }
  const clients = [...byClient.values()].map((o) => ({ ...o, months: o.months.size, total: r2(o.total), ads: r2(o.ads), video: r2(o.video), other: r2(o.other), collected: r2(o.collected), outstanding: r2(o.outstanding), ad_spend: r2(o.ad_spend), avg: r2(o.total / Math.max(1, o.months.size)) }))
    .sort((a, b) => b.total - a.total);

  const T = (f) => r2(real.reduce((s, m) => s + f(m), 0));
  const cur = months.find((m) => m.month === thisMonth) || real[real.length - 1] || null;
  return {
    title, sheet_url: sheetId ? 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit' : null, today, this_month: thisMonth,
    months, attention, clients, directory: directory(months),
    totals: { months: real.length, invoiced: T((m) => m.invoiced), collected: T((m) => m.collected), outstanding: T((m) => m.outstanding), avg_month: real.length ? r2(T((m) => m.invoiced) / real.length) : null },
    current: cur ? cur.month : null,
    warnings,
  };
}

// Every client on any month tab (placeholders too), newest details first. The Billing page picks clients from
// this list, so who gets billed comes from the sheet, never from GHL.
function directory(months) {
  const by = new Map();
  for (const m of months.slice().reverse()) for (const l of m.lines) {
    const k = key(l.client); const o = by.get(k) || { client: l.client, poc: '', poc_link: '', status: '', last_month: m.month };
    if (!o.poc && l.poc) o.poc = l.poc; if (!o.poc_link && l.poc_link) o.poc_link = l.poc_link; if (!o.status && l.client_status) o.status = l.client_status;
    by.set(k, o);
  }
  return [...by.values()].sort((a, b) => a.client.localeCompare(b.client));
}

/* ---------- saved copy ---------- */
export async function buildBilling({ env = process.env, fetchFn = fetch, now = Date.now() } = {}) {
  const got = await fetchBillingTabs({ env, fetchFn });
  const snap = computeBilling({ tabs: got.tabs, now, title: got.title, sheetId: got.cfg.sheetId });
  snap.years = (got.years || [{ year: got.year, id: got.cfg.sheetId, title: got.title }]).map((y) => ({ ...y, url: y.id && !/^demo/.test(y.id) ? 'https://docs.google.com/spreadsheets/d/' + y.id + '/edit' : null }));
  const multi = new Set(snap.months.map((m) => m.year)).size > 1;
  for (const m of snap.months) m.label = multi && yearOfTitle(m.title) == null ? `${m.title} ${m.year}` : m.title;
  // "Start next month": the month after the latest month that has begun (this month), built from that month.
  // If that tab exists already (a placeholder), it is rebuilt and the old one kept, renamed.
  const begun = snap.months.filter((m) => m.state !== 'forecast'), base = begun[begun.length - 1];
  if (base) {
    const mo = Number(base.month.slice(5, 7)), ny = mo === 12 ? base.year + 1 : base.year, nm = mo % 12;
    const key2 = `${ny}-${String(nm + 1).padStart(2, '0')}`;
    const hasSheet = snap.years.some((y) => y.year === ny && y.id);
    snap.next_month = { from: base.title, from_year: base.year, title: MONTHS[nm], year: ny, label: multi || ny !== base.year ? `${MONTHS[nm]} ${ny}` : MONTHS[nm], exists: snap.months.some((m) => m.month === key2), needs_sheet: !hasSheet };
  }
  snap.edit_enabled = !!String(env.BILLING_EDIT_PASSWORD || '').trim();
  snap.log = ((await cacheGet(LOG_KEY).catch(() => null)) || {}).items?.slice(0, 15) || [];
  return snap;
}
export const LOG_KEY = 'billing/log';
export async function refreshBilling(opts = {}) {
  const snap = await buildBilling(opts);
  await cachePut(BILLING_KEY, { saved_at: Date.now(), snap });
  return snap;
}
export async function savedBilling() {
  const hit = await cacheGet(BILLING_KEY);
  return hit && hit.snap ? hit : null;
}
