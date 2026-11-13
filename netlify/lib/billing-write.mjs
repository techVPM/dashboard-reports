// Saves changes from the Billing page into the billing sheet: update a line, add a line, start next month's tab.
// Every write re-reads the tab first and checks the row still holds what the page showed, so a row that moved
// or changed in the sheet is never overwritten by mistake.
import { billingConfig, getSheet, billingSources, sheetIdFromLink, YEARS_KEY, parseMonth, pocColumn, monthOfTitle, yearOfTitle, monthTitle, MONTHS, LOG_KEY } from './billing.mjs';
import { cacheGet, cachePut } from './store.mjs';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const short = (s, n = 500) => norm(s).slice(0, n);
export const moneyText = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const usText = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };
const linkOk = (u) => !u || /^https:\/\/[^\s"<>]+$/i.test(String(u).trim());
const amountOk = (v) => v === '' || v == null || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 10_000_000);

// Field on the page → column key in parseMonth's map, and how to write it.
const FIELDS = {
  invoice_status: ['istatus', (v) => short(v, 60)],
  payment_status: ['pstatus', (v) => short(v, 60)],
  invoice_date: ['idate', (v) => { if (!v) return ''; const t = usText(v); if (!t) throw err('The invoice date should be a date.'); return t; }],
  method: ['method', (v) => short(v, 60)],
  amount: ['amount', (v) => { if (!amountOk(v) || v === '' || v == null) throw err('The amount should be a number of dollars, 0 or more.'); return moneyText(v); }],
  ad_spend: ['spend', (v) => { if (v === '' || v == null) return ''; if (!amountOk(v)) throw err('Ad spend should be a number of dollars.'); return moneyText(v); }],
  inv_notes: ['notes', (v) => short(v)],
  add_notes: ['more', (v) => short(v)],
  service: ['service', (v) => { const s = short(v, 80); if (!s) throw err('Pick a service.'); return s; }],
};

async function loadTab(sheet, title, rows) {
  const meta = await sheet.meta();
  const tab = meta.tabs.find((t) => t.title === title);
  if (!tab) throw err(`There is no "${title}" tab in the sheet any more. Refresh the page.`, 409);
  const [values] = await sheet.read([{ tab: title, rows }]);
  const pc = pocColumn(values);
  let links = [];
  if (pc && sheet.links) { try { [links] = await sheet.links([{ tab: title, col: pc, rows }]); } catch { links = []; } }
  return { tab, values, parsed: parseMonth(values, '', links || []) };
}

async function log(entry) {
  const cur = (await cacheGet(LOG_KEY).catch(() => null)) || { items: [] };
  cur.items = [{ at: Date.now(), ...entry }, ...(cur.items || [])].slice(0, 200);
  await cachePut(LOG_KEY, cur).catch(() => {});
}

/* ---------- update one line ---------- */
export async function updateLine({ env = process.env, fetchFn = fetch, sheet, year, tab: title, row, expect = {}, set = {} }) {
  const cfg = billingConfig(env);
  sheet = sheet || (await getSheet(env, fetchFn, year));
  const { tab, parsed } = await loadTab(sheet, title, cfg.lastRow);
  const line = parsed.lines.find((l) => l.row === Number(row));
  // the row must still be the line the page showed
  if (!line || norm(line.client).toLowerCase() !== norm(expect.client).toLowerCase() || norm(line.service) !== norm(expect.service) || Number(line.amount) !== Number(expect.amount)) {
    throw err('That line changed in the sheet since the page loaded (someone may have added or moved rows). Refresh and try again.', 409);
  }
  const cells = [], changes = {};
  for (const [k, v] of Object.entries(set)) {
    const f = FIELDS[k]; if (!f) continue;
    const col = parsed.col[f[0]];
    if (col == null) throw err(`The ${title} tab has no column for ${k.replace('_', ' ')}.`);
    const value = f[1](v);
    const before = k === 'invoice_date' ? usText(line.invoice_date) : k === 'amount' ? moneyText(line.amount) : k === 'ad_spend' ? (line.ad_spend == null ? '' : moneyText(line.ad_spend)) : norm(line[k]);
    if (norm(value) === norm(before)) continue;
    cells.push({ tab: title, row: line.row, col: col + 1, value });
    changes[k] = [before, value];
  }
  // the billing contact and its GHL link sit on the client's first row
  let pocChanged = false;
  if (('poc' in set || 'poc_link' in set) && line.first && parsed.col.poc != null) {
    const text = 'poc' in set ? short(set.poc, 120) : line.poc;
    const url = 'poc_link' in set ? String(set.poc_link || '').trim() : line.poc_link;
    if (!linkOk(url)) throw err('The GHL contact link should start with https://');
    if (url && !text) throw err('Add the billing contact name for the link to sit on.');
    if (text !== norm(line.poc) || url !== (line.poc_link || '')) {
      await sheet.setLink(tab.id, line.row, parsed.col.poc + 1, text, url);
      if (text !== norm(line.poc)) changes.billing_contact = [line.poc, text];
      if (url !== (line.poc_link || '')) changes.ghl_link = [line.poc_link ? 'old link' : '', url ? 'new link' : ''];
      pocChanged = true;
    }
  }
  if (!cells.length && !pocChanged) return { changed: 0 };
  if (cells.length) await sheet.setCells(cells);
  await log({ action: 'update', year: year || null, tab: title, row: line.row, client: line.client, service: line.service, changes });
  return { changed: cells.length + (pocChanged ? 1 : 0) };
}

/* ---------- add a line ---------- */
export async function addLine({ env = process.env, fetchFn = fetch, sheet, year, tab: title, line: L = {} }) {
  const cfg = billingConfig(env);
  sheet = sheet || (await getSheet(env, fetchFn, year));
  const { tab, parsed } = await loadTab(sheet, title, cfg.lastRow);
  const client = short(L.client, 120);
  if (!client) throw err('Enter the client name.');
  const C = parsed.col;
  if (C.client == null || C.amount == null) throw err(`The ${title} tab is missing the Client Name or Invoice Amount column.`);
  const mine = parsed.lines.filter((l) => norm(l.client).toLowerCase() === client.toLowerCase());
  let row;
  if (mine.length) {
    // another line for a client already on the tab goes right under their last line (and its note row)
    const after = Math.max(...mine.map((l) => Math.max(l.row, l.note_row || 0)));
    await sheet.insertRowAfter(tab.id, after);
    row = after + 1;
  } else {
    // a new client goes under the last row in use, into an empty row, inserting one only if the next row is taken
    const after = parsed.last_row || parsed.header_row;
    const [values] = await sheet.read([{ tab: title, rows: after + 1 }]);
    const next = values[after] || [];
    if (next.some((c) => norm(c))) await sheet.insertRowAfter(tab.id, after);
    row = after + 1;
  }
  const cells = [];
  const put = (k, v) => { if (C[k] != null && v !== '' && v != null) cells.push({ tab: title, row, col: C[k] + 1, value: v }); };
  const link = String(L.poc_link || '').trim();
  if (!linkOk(link)) throw err('The GHL contact link should start with https://');
  if (!mine.length) {
    cells.push({ tab: title, row, col: 1, value: String((parsed.max_num || 0) + 1) });
    put('client', client); put('status', short(L.client_status || 'New', 40));
    if (!link) put('poc', short(L.poc, 120));
  }
  put('service', FIELDS.service[1](L.service));
  put('amount', FIELDS.amount[1](L.amount));
  for (const k of ['invoice_status', 'payment_status', 'invoice_date', 'method', 'ad_spend', 'inv_notes']) if (L[k] != null && L[k] !== '') put(FIELDS[k][0], FIELDS[k][1](L[k]));
  await sheet.setCells(cells);
  if (!mine.length && link && C.poc != null) await sheet.setLink(tab.id, row, C.poc + 1, short(L.poc, 120) || client, link);
  await log({ action: 'add', year: year || null, tab: title, row, client, service: L.service, amount: Number(L.amount) });
  return { row };
}

/* ---------- start next month's tab ---------- */
const nextDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return '';
  let y = +m[1], mo = +m[2] + 1; if (mo > 12) { mo = 1; y++; }
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(+m[3], last)).padStart(2, '0')}`;
};
// from: the month tab to copy (in `year`'s sheet). December goes into next year's sheet as January.
export async function startNextMonth({ env = process.env, fetchFn = fetch, sheet, target, year, from, now = Date.now() }) {
  const cfg = billingConfig(env);
  sheet = sheet || (await getSheet(env, fetchFn, year));
  const meta = await sheet.meta();
  const src = meta.tabs.find((t) => t.title === from);
  if (!src) throw err(`There is no "${from}" tab in the sheet.`, 409);
  const m = monthOfTitle(from);
  if (m < 0) throw err('Pick a month tab to copy from.');
  const crossing = m === 11;
  const fy = yearOfTitle(from) ?? (Number(year) || null);
  const name = monthTitle((m + 1) % 12, crossing ? (fy || 0) + 1 : fy, from);
  let dest = sheet, dmeta = meta;
  if (crossing) {
    // the new year lives in its own sheet
    dest = target || (Number(year) > 0 ? await getSheet(env, fetchFn, Number(year) + 1).catch(() => null) : null);
    if (!dest) throw err(`Add the ${Number(year) + 1} sheet's link first (Edit invoices tab, "Sheets by year").`, 409);
    dmeta = await dest.meta();
  }
  const old = dmeta.tabs.find((t) => monthOfTitle(t.title) === (m + 1) % 12);
  let renamed = null;
  if (old) {
    // keep the old tab, renamed, so nothing is lost
    renamed = `${old.title} (old ${new Date(now).toISOString().slice(0, 10)})`;
    let n = 2; while (dmeta.tabs.some((t) => t.title === renamed)) renamed = `${old.title} (old ${new Date(now).toISOString().slice(0, 10)} ${n++})`;
    await dest.rename(old.id, renamed);
  }
  if (crossing) {
    // copy December into next year's sheet, named January, placed before the other month tabs
    const firstMonth = dmeta.tabs.find((t) => monthOfTitle(t.title) >= 0 || /\(old /.test(t.title));
    const newId = await sheet.copyTabTo(src.id, dest);
    await dest.place(newId, name, firstMonth ? firstMonth.index : dmeta.tabs.length);
  } else {
    // the sheet lists newest first, so the new month goes just before the one it was copied from
    const at = meta.tabs.indexOf(src);
    await sheet.duplicate(src.id, name, Math.max(0, src.index ?? at));
  }
  sheet = dest;
  const [values] = await sheet.read([{ tab: name, rows: cfg.lastRow }]);
  const p = parseMonth(values, '');
  const C = p.col, cells = [];
  for (const l of p.lines) {
    const skip = /do not send/i.test(l.invoice_status);
    if (C.idate != null && l.invoice_date) cells.push({ tab: name, row: l.row, col: C.idate + 1, value: usText(nextDate(l.invoice_date)) });
    if (C.pstatus != null && !skip) cells.push({ tab: name, row: l.row, col: C.pstatus + 1, value: 'Unpaid' });
    if (C.istatus != null && !skip && !/automatic/i.test(l.invoice_status)) cells.push({ tab: name, row: l.row, col: C.istatus + 1, value: 'Wait' });
    if (C.status != null && l.first && /^new$/i.test(l.client_status)) cells.push({ tab: name, row: l.row, col: C.status + 1, value: 'Active' });
  }
  await sheet.setCells(cells);
  await log({ action: 'next', year: crossing ? Number(year) + 1 : year || null, tab: name, from, renamed, lines: p.lines.length });
  return { tab: name, year: crossing ? Number(year) + 1 : year || null, renamed, lines: p.lines.length };
}

/* ---------- check that the page can read and write the sheet ---------- */
// Reads the newest month tab and writes its "Client Name" header back exactly as it is, so nothing changes,
// but Google still has to allow a write. Proves the token has edit permission.
export async function checkAll({ env = process.env, fetchFn = fetch } = {}) {
  const src = await billingSources(env), out = [];
  for (const s of src) {
    const sheet = await getSheet(env, fetchFn, s.year);
    try { out.push({ year: s.year, ...(await checkSheet({ env, sheet })) }); } catch (e) { throw Object.assign(new Error(`${s.year} sheet: ${e.message}`), { status: e.status }); }
  }
  return { ok: true, sheets: out, tabs: out.reduce((a, x) => a + x.tabs, 0), tab: out.map((x) => `${x.tab} ${x.year}`).join(' and ') };
}
export async function checkSheet({ env = process.env, fetchFn = fetch, sheet } = {}) {
  const cfg = billingConfig(env);
  sheet = sheet || (await getSheet(env, fetchFn));
  const meta = await sheet.meta();
  const months = meta.tabs.filter((t) => monthOfTitle(t.title) >= 0);
  if (!months.length) throw err('The sheet has no month tabs.', 409);
  const newest = months.reduce((a, b) => (monthOfTitle(b.title) > monthOfTitle(a.title) ? b : a));
  const [values] = await sheet.read([{ tab: newest.title, rows: cfg.lastRow }]);
  const p = parseMonth(values, '');
  if (p.col.client == null || !p.header_row) throw err(`Could not find the header row in the ${newest.title} tab.`, 409);
  const text = values[p.header_row - 1][p.col.client];
  await sheet.setCells([{ tab: newest.title, row: p.header_row, col: p.col.client + 1, value: text }]);
  return { ok: true, tabs: meta.tabs.length, tab: newest.title };
}

/* ---------- add or change the sheet for a year ---------- */
export async function setYearSheet({ env = process.env, fetchFn = fetch, year, link }) {
  const src = await billingSources(env), y0 = src[0].year, y = Number(year);
  if (!Number.isInteger(y) || y <= y0 || y > y0 + 20) throw err(`Pick a year after ${y0}.`);
  const cur = (await cacheGet(YEARS_KEY).catch(() => null)) || { years: {} };
  cur.years = cur.years || {};
  if (!String(link || '').trim()) { delete cur.years[y]; await cachePut(YEARS_KEY, cur); await log({ action: 'year', year: y, removed: true }); return { year: y, removed: true }; }
  const id = sheetIdFromLink(link);
  if (!id) throw err('Paste the full Google Sheets link (it has /spreadsheets/d/ in it).');
  if (id === src[0].id) throw err(`That is the ${y0} sheet. Paste the ${y} sheet's link.`);
  cur.years[y] = id;
  // check the page can open it before saving
  const prev = { ...cur.years };
  await cachePut(YEARS_KEY, cur);
  try {
    const sheet = await getSheet(env, fetchFn, y);
    const meta = await sheet.meta();
    await log({ action: 'year', year: y, title: meta.title });
    return { year: y, title: meta.title, tabs: meta.tabs.length };
  } catch (e) {
    delete prev[y]; cur.years = prev; await cachePut(YEARS_KEY, cur);
    throw err(`Could not open that sheet (${e.message}). Check the link, and that the Google account behind the billing token can edit it.`, e.status || 400);
  }
}

export async function readLog() { return ((await cacheGet(LOG_KEY).catch(() => null)) || {}).items || []; }
