// A small Google Sheets client with just what the Billing page needs, plus an in-memory stand-in with the same
// methods for the local preview and the tests. Rows and columns are 1-based like the sheet itself.

export function setupError(msg) { return Object.assign(new Error(msg), { status: 503 }); }
export const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const q = (t) => `'${String(t).replace(/'/g, "''")}'`;

export function googleSheet({ sheetId, clientId, clientSecret, refresh, fetchFn = fetch }) {
  if (!sheetId) throw setupError('Billing is not connected yet. Add BILLING_SHEET_ID in Netlify (the README has the steps).');
  if (!refresh) throw setupError('Billing is not connected yet. Add GOOGLE_SHEETS_REFRESH_TOKEN in Netlify (the README has the steps).');
  if (!clientId || !clientSecret) throw setupError('GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET are missing in Netlify.');
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId);
  let token = null;
  async function auth() {
    if (token) return token;
    const res = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw setupError('Google did not accept GOOGLE_SHEETS_REFRESH_TOKEN (' + (j.error_description || j.error || res.status) + '). Make a new one with the steps in the README.');
    return (token = j.access_token);
  }
  async function call(path, { method = 'GET', body, write = false } = {}) {
    const res = await fetchFn(base + path, { method, headers: { authorization: 'Bearer ' + (await auth()), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    const m = j.error?.message || String(res.status);
    if (res.status === 403 && (/scope/i.test(m) || write)) {
      throw setupError(write
        ? 'Google did not allow changes to the billing sheet. The token in GOOGLE_SHEETS_REFRESH_TOKEN needs edit permission (https://www.googleapis.com/auth/spreadsheets) and the Google account behind it needs edit access to the sheet. See the README.'
        : 'The Google sign-in used for billing does not have permission to read Sheets. See the README.');
    }
    if (res.status === 403 || res.status === 404) throw setupError('Google could not open the billing sheet (' + m + '). Check BILLING_SHEET_ID, and that the Google account behind the token can open the sheet.');
    throw Object.assign(new Error('Google Sheets: ' + m), { status: 502 });
  }
  return {
    kind: 'google', sheetId,
    async meta() {
      const j = await call('?fields=properties.title,sheets.properties(sheetId,title,index)');
      return { title: j.properties?.title || '', tabs: (j.sheets || []).map((s) => ({ id: s.properties.sheetId, title: s.properties.title, index: s.properties.index })) };
    },
    async read(ranges) {
      if (!ranges.length) return [];
      const j = await call('/values:batchGet?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&' + ranges.map((r) => 'ranges=' + encodeURIComponent(`${q(r.tab)}!A1:Q${r.rows}`)).join('&'));
      return ranges.map((_, i) => j.valueRanges?.[i]?.values || []);
    },
    // cells: [{tab, row, col, value}] written as if typed (so "$5,000" and "11/2/2026" keep the sheet's formats)
    async setCells(cells) {
      if (!cells.length) return;
      await call('/values:batchUpdate', { method: 'POST', write: true, body: { valueInputOption: 'USER_ENTERED', data: cells.map((c) => ({ range: `${q(c.tab)}!${colLetter(c.col)}${c.row}`, values: [[c.value]] })) } });
    },
    // the link behind each cell in one column (the Billing POC cells link to the client's contact in GHL)
    async links(ranges) {
      if (!ranges.length) return [];
      const j = await call('?fields=' + encodeURIComponent('sheets(properties.title,data(startRow,rowData(values(hyperlink))))') + '&' + ranges.map((r) => 'ranges=' + encodeURIComponent(`${q(r.tab)}!${colLetter(r.col)}1:${colLetter(r.col)}${r.rows}`)).join('&'));
      const byTitle = new Map((j.sheets || []).map((s) => [s.properties?.title, s.data?.[0] || {}]));
      return ranges.map((r) => {
        const d = byTitle.get(r.tab) || {}, out = [], start = d.startRow || 0;
        (d.rowData || []).forEach((row, i) => { out[start + i] = row?.values?.[0]?.hyperlink || ''; });
        return out;
      });
    },
    // one cell of text that links somewhere, the same way a link typed into the sheet looks
    async setLink(tabId, row, col, text, url) {
      const cell = url ? { userEnteredValue: { stringValue: text }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: url } } }] } : { userEnteredValue: { stringValue: text } };
      await call(':batchUpdate', { method: 'POST', write: true, body: { requests: [{ updateCells: { range: { sheetId: tabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col - 1, endColumnIndex: col }, rows: [{ values: [cell] }], fields: 'userEnteredValue,textFormatRuns' } }] } });
    },
    async insertRowAfter(tabId, row) {
      await call(':batchUpdate', { method: 'POST', write: true, body: { requests: [{ insertDimension: { range: { sheetId: tabId, dimension: 'ROWS', startIndex: row, endIndex: row + 1 }, inheritFromBefore: true } }] } });
    },
    async duplicate(tabId, title, index) {
      await call(':batchUpdate', { method: 'POST', write: true, body: { requests: [{ duplicateSheet: { sourceSheetId: tabId, insertSheetIndex: index, newSheetName: title } }] } });
    },
    // copy one tab into another spreadsheet (the next year's file); returns the new tab's id there
    async copyTabTo(tabId, dest) {
      const j = await call('/sheets/' + tabId + ':copyTo', { method: 'POST', write: true, body: { destinationSpreadsheetId: dest.sheetId } });
      return j.sheetId;
    },
    async place(tabId, title, index) {
      await call(':batchUpdate', { method: 'POST', write: true, body: { requests: [{ updateSheetProperties: { properties: { sheetId: tabId, title, index }, fields: 'title,index' } }] } });
    },
    async rename(tabId, title) {
      await call(':batchUpdate', { method: 'POST', write: true, body: { requests: [{ updateSheetProperties: { properties: { sheetId: tabId, title }, fields: 'title' } }] } });
    },
  };
}

// Same methods over plain arrays: [{title, values}] in sheet order.
let memId = 1;
export function memorySheet(tabs, title = 'Sample billing sheet', sheetId = '') {
  let nextId = 1000 * memId++;
  const T = tabs.map((t) => ({ id: nextId++, title: t.title, values: t.values.map((r) => (r || []).slice()), links: { ...(t.links || {}) } })); // links: {'row:col': url}
  const byTitle = (t) => T.find((x) => x.title === t);
  const byId = (id) => T.find((x) => x.id === id);
  return {
    kind: 'memory', sheetId, tabsRaw: T,
    async meta() { return { title, tabs: T.map((t, i) => ({ id: t.id, title: t.title, index: i })) }; },
    async read(ranges) { return ranges.map((r) => (byTitle(r.tab)?.values || []).slice(0, r.rows).map((x) => x.slice())); },
    async setCells(cells) {
      for (const c of cells) {
        const t = byTitle(c.tab); if (!t) throw new Error('No tab ' + c.tab);
        while (t.values.length < c.row) t.values.push([]);
        const r = t.values[c.row - 1]; while (r.length < c.col) r.push('');
        // like USER_ENTERED with the sheet's formats: amounts show as money, dates as M/D/YYYY
        r[c.col - 1] = typeof c.value === 'number' ? '$' + c.value.toLocaleString('en-US') : String(c.value);
      }
    },
    async links(ranges) { return ranges.map((r) => { const t = byTitle(r.tab), out = []; for (let i = 0; i < r.rows; i++) out[i] = t?.links[`${i + 1}:${r.col}`] || ''; return out; }); },
    async setLink(id, row, col, text, url) { const t = byId(id); await this.setCells([{ tab: t.title, row, col, value: text }]); if (url) t.links[`${row}:${col}`] = url; else delete t.links[`${row}:${col}`]; },
    async insertRowAfter(id, row) {
      const t = byId(id); t.values.splice(row, 0, []);
      const L = {}; for (const [k, v] of Object.entries(t.links)) { const [r, c] = k.split(':').map(Number); L[`${r > row ? r + 1 : r}:${c}`] = v; } t.links = L;
    },
    async duplicate(id, newTitle, index) { const t = byId(id); T.splice(index, 0, { id: nextId++, title: newTitle, values: t.values.map((r) => r.slice()), links: { ...t.links } }); },
    async rename(id, newTitle) { byId(id).title = newTitle; },
    async copyTabTo(id, dest) { const t = byId(id); return dest._accept({ title: 'Copy of ' + t.title, values: t.values.map((r) => r.slice()), links: { ...t.links } }); },
    _accept(t) { const id = nextId++; T.push({ id, ...t }); return id; },
    async place(id, newTitle, index) { const t = byId(id); t.title = newTitle; T.splice(T.indexOf(t), 1); T.splice(Math.min(index, T.length), 0, t); },
  };
}
