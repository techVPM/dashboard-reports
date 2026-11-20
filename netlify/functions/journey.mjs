// GET  /api/journey?k=<client link key>               the client's journey: shared milestones, notes, wins and reports
// GET  /api/journey?token=<key>  (x-admin-key)         everything, for the team page (/journey)
// GET  /api/journey?list=1       (x-admin-key)         the clients, for the picker
// POST /api/journey              (x-admin-key)         {token, action, ...} edits; see ACTIONS below
import { getClients, findClientAsync } from '../lib/store.mjs';
import { isAdmin, jsonRes } from '../lib/auth.mjs';
import { loadJourney, saveJourney, history, view, makeReport, launchDate, cleanValue, TEMPLATE, PHASES, CHECKPOINTS, isDate, newId } from '../lib/journey.mjs';

const DEMO = { name: 'Sample Coaching Co', token: 'demo-calls', timezone: 'America/Denver' };
const demoState = () => {
  const d = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
  return { enabled: true, kickoff: d, launch: '', items: { agreement: { done: true, date: d }, kickoff: { done: true, date: d }, audit: { done: true, date: d }, tracking: { done: true, date: d }, strategy: { done: true, date: d }, scripts: { done: true, date: d }, video_shoot: { done: true, date: new Date(Date.now() - 88 * 864e5).toISOString().slice(0, 10) }, videos_done: { done: true, date: new Date(Date.now() - 80 * 864e5).toISOString().slice(0, 10) }, dashboard: { done: true, date: new Date(Date.now() - 75 * 864e5).toISOString().slice(0, 10) } }, custom: [], notes: [{ id: 'n1', text: 'Kickoff went great. The team is excited to get the first videos made.', public: true, at: Date.now() - 99 * 864e5 }], reports: {}, hidden_wins: [] };
};

export default async (req) => {
  const url = new URL(req.url);
  const admin = isAdmin(req);

  if (req.method === 'GET') {
    if (url.searchParams.get('list')) {
      if (!admin) return jsonRes({ error: 'Wrong password.' }, 401);
      const all = await getClients();
      return jsonRes({ clients: all.filter((c) => !c.disabled).map((c) => ({ token: c.token, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)), phases: PHASES, template: TEMPLATE, checkpoints: CHECKPOINTS });
    }
    const k = url.searchParams.get('k'), token = url.searchParams.get('token');
    if (token && !admin) return jsonRes({ error: 'Wrong password.' }, 401);
    let client, st;
    if (k === 'demo' || k === 'demo-calls') { client = { ...DEMO, token: k }; st = demoState(); }
    else {
      client = token ? (await getClients()).find((c) => c.token === token) : await findClientAsync(k);
      if (!client) return jsonRes({ error: 'This link is not valid.' }, 404);
      st = await loadJourney(client.token);
    }
    if (!token && !st.enabled) return jsonRes({ enabled: false, client_name: client.name });
    let h = null, herr = null;
    try { h = await history(client, st); } catch (e) { herr = e.message; }
    // remember the launch date found in Google Ads, so the All clients page can flag check-ins coming due
    const LA = h ? launchDate(h, { ...st, launch: '' }) : null;
    if (LA && LA !== st.launch_auto && k !== 'demo' && k !== 'demo-calls') { st.launch_auto = LA; await saveJourney(client.token, st).catch(() => {}); }
    const out = view(client, st, h, { team: !!token });
    if (token) out.history_error = herr;
    return jsonRes(out);
  }

  if (req.method !== 'POST') return jsonRes({ error: 'Not allowed.' }, 405);
  if (!admin) return jsonRes({ error: 'Wrong password.' }, 401);
  let b; try { b = await req.json(); } catch { return jsonRes({ error: 'Bad request.' }, 400); }
  const client = (await getClients()).find((c) => c.token === b.token);
  if (!client) return jsonRes({ error: 'Client not found.' }, 404);
  const st = await loadJourney(client.token);
  const date = (v) => (v === '' || v == null ? '' : isDate(v) ? v : null);
  const bad = (m) => jsonRes({ error: m }, 400);
  const txt = (s, n) => String(s ?? '').trim().slice(0, n);
  const phaseOk = (p) => PHASES.some(([id]) => id === p);

  switch (b.action) {
    case 'dates': {
      const k = date(b.kickoff), l = date(b.launch);
      if (k === null || l === null) return bad('Dates should look like 2026-11-20.');
      if ('kickoff' in b) st.kickoff = k; if ('launch' in b) st.launch = l;
      break;
    }
    case 'enabled': st.enabled = !!b.enabled; break;
    case 'value': st.value = cleanValue(b.value || {}); break;
    case 'roadmap': {
      const u = txt(b.url, 500);
      if (u && !/^https:\/\/[^\s"<>]+$/i.test(u)) return bad('The roadmap link should start with https://');
      st.roadmap_url = u; break;
    }
    case 'item': { // a template milestone: done, date, due, client, title
      if (!TEMPLATE.some((t) => t.id === b.id)) return bad('Unknown milestone.');
      const s = st.items[b.id] || {};
      if ('done' in b) s.done = b.done === null ? undefined : !!b.done;
      if ('date' in b) { const d = date(b.date); if (d === null) return bad('Dates should look like 2026-11-20.'); s.date = d; }
      if ('due' in b) { const d = date(b.due); if (d === null) return bad('Dates should look like 2026-11-20.'); s.due = d; }
      if ('client' in b) s.client = !!b.client;
      if ('title' in b) s.title = txt(b.title, 120) || undefined;
      st.items[b.id] = s;
      break;
    }
    case 'custom': { // add or change an event or a win
      const d = date(b.date), du = date(b.due ?? '');
      if (d === null || du === null) return bad('Dates should look like 2026-11-20.');
      const title = txt(b.title, 140); if (!title) return bad('Give it a title.');
      if (!phaseOk(b.phase)) return bad('Pick a stage.');
      const rec = { id: b.id || newId(), phase: b.phase, title, date: d || '', due: du || '', done: b.done != null ? !!b.done : !!d, client: b.client !== false, win: !!b.win, detail: txt(b.detail, 400) };
      const i = st.custom.findIndex((c) => c.id === rec.id);
      if (i >= 0) st.custom[i] = rec; else st.custom.push(rec);
      break;
    }
    case 'custom_delete': st.custom = st.custom.filter((c) => c.id !== b.id); st.notes = st.notes.filter((n) => n.item !== b.id); break;
    case 'note': { // add or change a note; item = milestone id, or empty for a note on the whole journey
      const text = txt(b.text, 2000); if (!text) return bad('Write the note first.');
      const i = st.notes.findIndex((n) => n.id === b.id);
      const rec = { id: b.id || newId(), item: b.item || null, text, public: !!b.public, at: i >= 0 ? st.notes[i].at : Date.now() };
      if (i >= 0) st.notes[i] = rec; else st.notes.push(rec);
      break;
    }
    case 'note_delete': st.notes = st.notes.filter((n) => n.id !== b.id); break;
    case 'win': { const set = new Set(st.hidden_wins || []); if (b.hidden) set.add(String(b.id)); else set.delete(String(b.id)); st.hidden_wins = [...set]; break; }
    case 'report': {
      const days = Number(b.days); if (!CHECKPOINTS.some(([d]) => d === days)) return bad('Pick a checkpoint.');
      st.reports[days] = { ...(st.reports[days] || {}), status: 'working', started_at: Date.now() };
      await saveJourney(client.token, st);
      // writing the report can take longer than a normal request, so it runs in the background
      if (process.env.VPM_DEV) { await runReport(client, days); return jsonRes({ ok: true }); }
      const bg = await fetch(new URL('/.netlify/functions/journey-report-background', req.url), { method: 'POST', headers: { 'x-refresh-secret': process.env.REFRESH_SECRET || '', 'content-type': 'application/json' }, body: JSON.stringify({ token: client.token, days }) }).catch((e) => ({ ok: false, status: e.message }));
      if (!bg.ok && bg.status !== 202) { st.reports[days] = { ...st.reports[days], status: 'error', error: 'Could not start the report (' + bg.status + '). Is REFRESH_SECRET set in Netlify?' }; await saveJourney(client.token, st); }
      return jsonRes({ ok: true, working: true });
    }
    case 'report_share': { const r = st.reports[Number(b.days)]; if (!r || !r.text) return bad('Generate the report first.'); r.shared = !!b.shared; break; }
    case 'report_edit': { // the team can reword any part before sharing
      const r = st.reports[Number(b.days)]; if (!r || !r.text) return bad('Generate the report first.');
      const { tidy } = await import('../lib/journey.mjs');
      r.text = tidy({ ...r.text, ...(b.text || {}) }); r.edited_at = Date.now();
      break;
    }
    case 'report_delete': delete st.reports[Number(b.days)]; break;
    default: return bad('Unknown action.');
  }
  await saveJourney(client.token, st);
  return jsonRes({ ok: true });
};

// Builds one checkpoint report and saves it into the journey.
export async function runReport(client, days) {
  let rec;
  try { rec = await makeReport({ client, st: await loadJourney(client.token), days }); }
  catch (e) { rec = { days, status: 'error', error: e.message, generated_at: null }; }
  const st = await loadJourney(client.token);
  const prev = st.reports[days] || {};
  st.reports[days] = rec.status === 'error' && prev.text ? { ...prev, status: 'done', error: rec.error } : rec;
  await saveJourney(client.token, st);
  return st.reports[days];
}

export const config = { path: '/api/journey' };
