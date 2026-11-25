// The client journey: a living timeline of the partnership, from kickoff to the first year.
//
//   Milestones   a checklist taken from the Asana onboarding and 30/90-day/6-month/1-year boards. The team ticks them
//                off (with a date) on /journey; each one is either shown to the client or kept for the team.
//   Events       anything else worth marking (a video shoot, Meta ads going live), added by the team.
//   Notes        on a milestone or on the whole journey, each with its own "show to client" switch.
//   Wins         found automatically in the Google Ads history (first result, cost under goal, record weeks...),
//                plus wins the team adds by hand. The team can hide any automatic win.
//   Reports      30-day, 90-day, 6-month and 1-year check-ins comparing the account before VPM with now,
//                written by Claude (or by set rules if no Anthropic key), shown to the client once the team shares them.
//
// Everything is kept in Netlify storage under journey/<client token>.
import { cacheGet, cachePut } from './store.mjs';
import { buildReport, addDays, daysBetween, todayIn } from './ads.mjs';
import { demoReport } from './demo.mjs';

export const PHASES = [
  ['onboarding', 'Onboarding', 'Getting everything ready'],
  ['launch', 'Launch', 'Creative made, ads live'],
  ['d30', 'First 30 days', 'First results and reporting'],
  ['d90', 'Days 31 to 90', 'Finding what works'],
  ['m6', 'Months 4 to 6', 'Scaling what works'],
  ['y1', 'Months 7 to 12', 'The first year'],
];

// id, phase, title, shown to the client by default, and (optional) what fills it in automatically
// The milestones a business owner cares about (the full checklists stay in Asana).
// id, stage, title, why it matters (shown to the client), shown to the client by default, and what fills it in automatically
export const TEMPLATE = [
  ['agreement', 'onboarding', 'Partnership agreement signed', 'Day one of working together.', true],
  ['kickoff', 'onboarding', 'Kickoff call', 'We learned your business, your customers and your goals.', true],
  ['audit', 'onboarding', 'Account audit completed', 'A full review of your ads, tracking and website before we change anything.', true],
  ['tracking', 'onboarding', 'Conversion tracking set up and verified', 'Every call, lead and sale is counted, so we can see exactly what the ads bring in.', true],
  ['strategy', 'onboarding', 'Strategy and roadmap delivered', 'The plan: who we target, what we say and how we measure success.', true],
  ['scripts', 'launch', 'Video scripts approved', 'Your message, written to stop the scroll and drive action.', true],
  ['video_shoot', 'launch', 'Video shoot', 'Filming the ads.', true],
  ['videos_done', 'launch', 'Videos delivered', 'Finished ads, ready to run.', true],
  ['google_live', 'launch', 'Google and YouTube ads live', 'The ads start reaching your customers.', true, 'launch'],
  ['meta_live', 'launch', 'Meta ads live', 'The same message on Facebook and Instagram.', true, 'meta'],
  ['dashboard', 'launch', 'Live reporting dashboard ready', 'Your numbers, any time, in one place.', true],
  ['first_result', 'd30', 'First result from the ads', 'The first call, lead or sale that came from the ads.', true, 'first_result'],
  ['first_report', 'd30', 'First weekly report', 'Clear numbers every week from here on.', true],
  ['learnings', 'd30', 'First learnings: what is working and what is not', 'Early data tells us which audiences and messages to lean into.', true],
  ['review30', 'd30', '30-day review call', 'We walk through the first month together.', true],
  ['report30', 'd30', '30-day report', 'Before and after numbers for the first month.', true, 'report30'],
  ['goal_cost', 'd90', 'Cost per result hits the goal', 'Results coming in at the price we agreed was profitable.', true, 'goal'],
  ['winner', 'd90', 'Winning ad found', 'One ad clearly outperforms the rest, and we put more behind it.', true],
  ['refresh', 'd90', 'First creative refresh', 'New hooks and versions tested against the winners.', true],
  ['review90', 'd90', '90-day review call', 'A deeper look at what is working and the plan for the next quarter.', true],
  ['report90', 'd90', '90-day report', 'Before and after numbers for the first quarter.', true, 'report90'],
  ['scale', 'm6', 'Budget scaled on what works', 'More spend on the campaigns that bring results at a profit.', true],
  ['monthly_goal', 'm6', 'Monthly results goal reached', 'The number of calls, leads or sales we set out to reach each month.', true, 'monthly'],
  ['expand', 'm6', 'New channel or audience added', 'Reaching more of the right people.', true],
  ['review180', 'm6', '6-month review call', 'Halfway through the year: results, lessons and what is next.', true],
  ['report180', 'm6', '6-month report', 'Before and after numbers at six months.', true, 'report180'],
  ['roas_goal', 'y1', 'Return on ad spend goal reached', 'Every dollar in ads bringing back the return we aimed for.', true, 'roas'],
  ['next_year', 'y1', 'Next year plan and goals set', 'Bigger goals, built on what we learned.', true],
  ['review365', 'y1', '1-year review call', 'A full year of results, side by side with where we started.', true],
  ['report365', 'y1', '1-year report', 'Before and after numbers for the whole first year.', true, 'report365'],
].map(([id, phase, title, why, client, auto]) => ({ id, phase, title, why, client, auto: auto || null }));

export const CHECKPOINTS = [[30, '30-day'], [90, '90-day'], [180, '6-month'], [365, '1-year']];

const KEY = (token) => 'journey/' + token;
const HKEY = (token) => 'journeyhist/' + token;
export const blank = () => ({ enabled: false, value: {}, roadmap_url: '', launch_auto: '', kickoff: '', launch: '', items: {}, custom: [], notes: [], reports: {}, hidden_wins: [], updated_at: 0 });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => ISO.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n);

export async function loadJourney(token) { return { ...blank(), ...((await cacheGet(KEY(token)).catch(() => null)) || {}) }; }
export async function saveJourney(token, st) { st.updated_at = Date.now(); await cachePut(KEY(token), st); return st; }

/* ---------- Google Ads history: one row per day, all campaigns together ---------- */
const HIST_HOURS = 12;
export async function history(client, st, { env = process.env, fetchFn = fetch, force = false } = {}) {
  const start = st.kickoff || st.launch;
  if (!isDate(start)) return null;
  const tz = client.timezone || 'America/Denver';
  const to = addDays(todayIn(tz), -1);
  const from = addDays(start, -30);
  if (to < from) return null;
  const end = daysBetween(from, to) > 430 ? addDays(from, 430) : to;
  const hk = HKEY(client.token) + '/' + from;
  const hit = await cacheGet(hk).catch(() => null);
  if (hit && hit.to === end && !force && Date.now() - hit.saved_at < HIST_HOURS * 36e5) return hit;
  const demo = client.token === 'demo' || client.token === 'demo-calls' || (env.VPM_DEV && !env.GOOGLE_ADS_REFRESH_TOKEN);
  const r = demo ? demoReport(client.token === 'demo' ? 'demo' : 'demo-calls', from, end) : await buildReport({ client, from, to: end, env, fetchFn });
  const days = new Map();
  for (const d of r.daily || []) {
    const o = days.get(d.date) || { date: d.date, spend: 0, clicks: 0, impressions: 0, conversions: 0, leads: 0, calls: 0, deals: 0, revenue: 0 };
    for (const k of ['spend', 'clicks', 'impressions', 'conversions', 'leads', 'calls', 'deals', 'revenue']) o[k] += Number(d[k]) || 0;
    days.set(d.date, o);
  }
  const has = r.meta.has || {};
  const rk = has.calls ? 'calls' : has.leads ? 'leads' : has.deals ? 'deals' : 'conversions';
  const label = rk === 'conversions' ? 'Conversions' : (r.meta.labels || {})[rk] || 'Results';
  const out = {
    saved_at: Date.now(), from, to: end, rk, label, goals: r.meta.goals || {}, targets: r.meta.targets || {}, revenue: !!has.revenue,
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    campaigns: (r.campaigns || []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    by_campaign: byCampaign(r.daily || [], rk),
    meta_only: r.meta?.platform === 'meta', meta_days: r.meta?.platform === 'meta' ? null : metaDays(r), meta_goal: Number(client.meta_goals?.cost_per_result) || null,
  };
  await cachePut(hk, out).catch(() => {});
  return out;
}
// Meta's own daily spend and results, kept apart from Google's
function metaDays(r) {
  const m = r.platforms && r.platforms.meta; if (!m || !m.daily) return null;
  const by = new Map();
  for (const d of m.daily) { const o = by.get(d.date) || { date: d.date, spend: 0, results: 0 }; o.spend += Number(d.spend) || 0; o.results += Number(d.results) || 0; by.set(d.date, o); }
  return { label: m.label || 'Results', days: [...by.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) };
}
function metaWindow(md, from, to) {
  const o = { spend: 0, results: 0 };
  for (const d of md.days) if (d.date >= from && d.date <= to) { o.spend += d.spend; o.results += d.results; }
  o.spend = Math.round(o.spend * 100) / 100; o.cost_per_result = o.results > 0 ? Math.round(o.spend / o.results * 100) / 100 : null;
  return o;
}
function byCampaign(daily, rk) {
  const m = new Map();
  for (const d of daily) { const o = m.get(d.campaign_id) || { id: d.campaign_id, first: d.date, spend: 0, results: 0 }; o.spend += Number(d.spend) || 0; o.results += Number(rk === 'conversions' ? d.conversions : d[rk]) || 0; if (d.date < o.first && (d.spend || 0) > 0) o.first = d.date; m.set(d.campaign_id, o); }
  return [...m.values()];
}

/* ---------- numbers for a window of days ---------- */
const R = (h, d) => Number(h.rk === 'conversions' ? d.conversions : d[h.rk]) || 0;
export function sumWindow(h, from, to) {
  const o = { from, to, days: 0, spend: 0, clicks: 0, impressions: 0, results: 0, revenue: 0 };
  for (const d of h.days) if (d.date >= from && d.date <= to) { o.days++; o.spend += d.spend; o.clicks += d.clicks; o.impressions += d.impressions; o.results += R(h, d); o.revenue += d.revenue; }
  o.cost_per_result = o.results > 0 ? o.spend / o.results : null;
  o.ctr = o.impressions > 0 ? o.clicks / o.impressions : null;
  o.cpc = o.clicks > 0 ? o.spend / o.clicks : null;
  o.roas = o.spend > 0 && o.revenue > 0 ? Math.round((o.revenue / o.spend) * 100) / 100 : null;
  for (const k of ['spend', 'results', 'revenue', 'cost_per_result', 'cpc']) if (o[k] != null) o[k] = Math.round(o[k] * 100) / 100;
  if (o.ctr != null) o.ctr = Math.round(o.ctr * 10000) / 10000;
  return o;
}

// The day the ads started for VPM: set by the team, or the first day with spend on or after kickoff.
export function launchDate(h, st) {
  if (isDate(st.launch)) return st.launch;
  if (!h) return null;
  const k = isDate(st.kickoff) ? st.kickoff : h.from;
  const d = h.days.find((x) => x.date >= k && x.spend > 0);
  return d ? d.date : null;
}
// "Before VPM": the 30 days before kickoff if the account was spending, otherwise the first 30 days after launch.
export function baselineWindow(h, st) {
  const k = isDate(st.kickoff) ? st.kickoff : null;
  if (k) { const pre = sumWindow(h, addDays(k, -30), addDays(k, -1)); if (pre.spend > 50) return { ...pre, kind: 'before' }; }
  const L = launchDate(h, st); if (!L) return null;
  return { ...sumWindow(h, L, addDays(L, 29)), kind: 'first30' };
}

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const money2 = (n) => '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2));
const sing = (s) => String(s).replace(/ies$/i, 'y').replace(/s$/i, '');
const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* ---------- wins found in the numbers ---------- */
export function findWins(h, st) {
  if (!h || !h.days.length) return [];
  const L = launchDate(h, st); if (!L) return [];
  const U = sing(h.label), UL = h.label.toLowerCase(), UlS = sing(h.label).toLowerCase();
  const goal = h.goals?.cost_per_conversion || (h.rk === 'calls' ? h.targets?.cpc : h.targets?.cpl) || null;
  const monthly = h.goals?.monthly_conversions || null;
  const roasGoal = h.goals?.roas || h.targets?.roas || null;
  const days = h.days.filter((d) => d.date >= L);
  const wins = [];
  const add = (id, date, title, detail, score) => wins.push({ id, date, title, detail, score, auto: true, kind: 'win' });

  // first result (only for accounts that had none before) and running totals
  const pre = baselineWindow(h, st);
  const hadResults = pre && pre.kind === 'before' && pre.results > 0;
  let total = 0, spend = 0; const marks = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  for (const d of days) {
    const before = total; total += R(h, d); spend += d.spend;
    if (!hadResults && before < 1 && total >= 1) add('first_result', d.date, 'First ' + UlS + ' from the ads', fmtDate(d.date) + ', ' + daysBetween(L, d.date) + ' days after launch.', 90);
    for (const m of marks) if (before < m && total >= m) { for (let i = wins.length - 1; i >= 0; i--) if (/^total_/.test(wins[i].id)) wins.splice(i, 1); add('total_' + m, d.date, m.toLocaleString('en-US') + ' ' + UL + ' since we started', money(spend) + ' invested to get here, ' + money2(spend / total) + ' each.', 40 + Math.min(40, Math.log10(m) * 12)); }
  }

  // rolling 30 days (or since launch when younger): cost per result under goal, monthly volume goal, ROAS goal
  let underAt = null, volAt = null, roasAt = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const w = sumWindow(h, addDays(d.date, -29) < L ? L : addDays(d.date, -29), d.date);
    if (goal && !underAt && w.days >= 7 && w.results >= 3 && w.cost_per_result != null && w.cost_per_result <= goal) { underAt = d.date; add('under_goal', d.date, 'Cost per ' + UlS + ' under the ' + money2(goal) + ' goal', money2(w.cost_per_result) + ' each over the ' + w.days + ' days to ' + fmtDate(d.date) + ' (' + w.results + ' ' + UL + ').', 100); }
    if (monthly && !volAt && w.days >= 25 && w.results >= monthly) { volAt = d.date; add('monthly_goal', d.date, monthly + ' ' + UL + ' in a month: goal reached', w.results + ' ' + UL + ' in the 30 days to ' + fmtDate(d.date) + '.', 95); }
    if (roasGoal && h.revenue && !roasAt && w.days >= 14 && w.roas != null && w.roas >= roasGoal) { roasAt = d.date; add('roas_goal', d.date, 'Return on ad spend above ' + roasGoal + 'x', w.roas.toFixed(1) + 'x in the ' + w.days + ' days to ' + fmtDate(d.date) + '.', 98); }
  }

  // best weeks (7-day blocks from launch, complete weeks only)
  const weeks = [];
  for (let s = L; addDays(s, 6) <= h.to; s = addDays(s, 7)) weeks.push(sumWindow(h, s, addDays(s, 6)));
  if (weeks.length >= 3) {
    const most = weeks.reduce((a, b) => (b.results > a.results ? b : a));
    if (most.results >= 3) add('record_week', most.to, 'Record week: ' + most.results + ' ' + UL, 'The week of ' + fmtDate(most.from) + ', the most since launch.', 70);
    const ok = weeks.filter((w) => w.results >= 3);
    if (ok.length >= 3) { const best = ok.reduce((a, b) => (b.cost_per_result < a.cost_per_result ? b : a)); add('best_cost_week', best.to, 'Lowest cost per ' + UlS + ': ' + money2(best.cost_per_result), 'The week of ' + fmtDate(best.from) + ' (' + best.results + ' ' + UL + ').', 72); }
  }

  // now compared with before VPM
  const base = baselineWindow(h, st);
  const now = sumWindow(h, addDays(h.to, -29) < L ? L : addDays(h.to, -29), h.to);
  if (base && base.kind === 'before' && now.days >= 21 && base.cost_per_result && now.cost_per_result && now.results >= 3) {
    const ch = (now.cost_per_result - base.cost_per_result) / base.cost_per_result;
    if (ch <= -0.1) add('vs_before_cost', h.to, 'Cost per ' + UlS + ' down ' + Math.round(-ch * 100) + '% from before we started', money2(base.cost_per_result) + ' in the 30 days before kickoff, ' + money2(now.cost_per_result) + ' in the last 30 days.', 99);
  }
  if (base && base.kind === 'before' && now.days >= 21 && now.results > base.results * 1.2 && now.results >= 3) {
    add('vs_before_volume', h.to, (base.results ? Math.round((now.results / Math.max(1, base.results) - 1) * 100) + '% more ' : now.results + ' ') + UL + ' than before we started', base.results + ' in the 30 days before kickoff, ' + now.results + ' in the last 30 days.', 97);
  }
  for (const w of metaWins(h, st)) wins.push(w);
  return wins.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Wins on Meta (Facebook and Instagram), from Meta's own numbers. Never mixed with Google's.
export function metaWins(h, st) {
  const md = h && h.meta_days; if (!md || !md.days.length) return [];
  const start = st.kickoff || st.launch || ''; if (!start) return [];
  const label = md.label || 'Results', UL = label.toLowerCase(), US = sing(label).toLowerCase();
  const win = (from, to) => { const o = { days: 0, spend: 0, results: 0 }; for (const d of md.days) if (d.date >= from && d.date <= to) { o.days++; o.spend += d.spend; o.results += d.results; } o.cost = o.results > 0 ? o.spend / o.results : null; return o; };
  const ranBefore = md.days.some((d) => d.date < start && d.spend > 0);
  const firstSpend = md.days.find((d) => d.date >= start && d.spend > 0); if (!firstSpend) return [];
  const M0 = firstSpend.date, days = md.days.filter((d) => d.date >= M0), out = [];
  const add = (id, date, title, detail, score) => out.push({ id, date, title, detail, score, auto: true, kind: 'win', platform: 'meta' });
  let total = 0, spend = 0; const marks = [10, 25, 50, 100, 250, 500, 1000, 2500];
  for (const d of days) {
    const before = total; total += d.results; spend += d.spend;
    if (!ranBefore && before < 1 && total >= 1) add('meta_first_result', d.date, 'First ' + US + ' from Meta ads', 'Facebook and Instagram, ' + daysBetween(M0, d.date) + ' days after the Meta ads started.', 88);
    for (const m of marks) if (before < m && total >= m) { for (let i = out.length - 1; i >= 0; i--) if (/^meta_total_/.test(out[i].id)) out.splice(i, 1); add('meta_total_' + m, d.date, m.toLocaleString('en-US') + ' ' + UL + ' from Meta ads', money(spend) + ' invested on Facebook and Instagram, ' + money2(spend / total) + ' each.', 40 + Math.min(38, Math.log10(m) * 12)); }
  }
  const goal = h.meta_goal;
  if (goal) for (const d of days) { const w = win(addDays(d.date, -29) < M0 ? M0 : addDays(d.date, -29), d.date); if (w.days >= 7 && w.results >= 3 && w.cost != null && w.cost <= goal) { add('meta_under_goal', d.date, 'Meta cost per ' + US + ' under the ' + money2(goal) + ' goal', money2(w.cost) + ' each over the ' + w.days + ' days to ' + fmtDate(d.date) + ' (' + w.results + ' ' + UL + ').', 96); break; } }
  const weeks = []; for (let s = M0; addDays(s, 6) <= h.to; s = addDays(s, 7)) weeks.push({ from: s, to: addDays(s, 6), ...win(s, addDays(s, 6)) });
  if (weeks.length >= 3) { const most = weeks.reduce((a, b) => (b.results > a.results ? b : a)); if (most.results >= 3) add('meta_record_week', most.to, 'Record week on Meta: ' + Math.round(most.results) + ' ' + UL, 'The week of ' + fmtDate(most.from) + ', the most since the Meta ads started.', 68); }
  if (ranBefore) {
    const base = win(addDays(start, -30), addDays(start, -1)), now = win(addDays(h.to, -29), h.to);
    if (base.cost && now.cost && now.results >= 3 && (now.cost - base.cost) / base.cost <= -0.1) add('meta_vs_before_cost', h.to, 'Meta cost per ' + US + ' down ' + Math.round((base.cost - now.cost) / base.cost * 100) + '% from before we started', money2(base.cost) + ' in the 30 days before kickoff, ' + money2(now.cost) + ' in the last 30 days.', 97);
    if (now.results >= 3 && now.results > base.results * 1.2) add('meta_vs_before_volume', h.to, (base.results ? Math.round((now.results / Math.max(1, base.results) - 1) * 100) + '% more ' : Math.round(now.results) + ' ') + UL + ' on Meta than before we started', Math.round(base.results) + ' in the 30 days before kickoff, ' + Math.round(now.results) + ' in the last 30 days.', 95);
  }
  return out;
}

/* ---------- what the automatic milestones fill in ---------- */
export function autoDates(h, st, wins) {
  const out = {};
  const L = launchDate(h, st); if (L) { out.launch = L; if (h && h.meta_only) out.meta = L; }
  const fr = wins.find((w) => w.id === 'first_result'); if (fr) out.first_result = fr.date;
  const g = wins.find((w) => w.id === 'under_goal'); if (g) out.goal = g.date;
  const mg = wins.find((w) => w.id === 'monthly_goal'); if (mg) out.monthly = mg.date;
  const rg = wins.find((w) => w.id === 'roas_goal'); if (rg) out.roas = rg.date;
  // Meta live: the first day with Meta spend, unless Meta was already running before we started
  if (h && h.meta_days) { const start = st.kickoff || st.launch || ''; const first = h.meta_days.days.find((d) => d.spend > 0); if (first && (!start || first.date >= start)) out.meta = first.date; }
  for (const [d] of CHECKPOINTS) { const r = st.reports?.[d]; if (r && r.generated_at && !r.error) out['report' + d] = new Date(r.generated_at).toISOString().slice(0, 10); }
  return out;
}

/* ---------- the whole journey, for the team (all) or the client (shared parts only) ---------- */
export function view(client, st, h, { team = false } = {}) {
  const wins = findWins(h, st);
  const auto = autoDates(h, st, wins);
  const L = launchDate(h, st);
  const notesFor = (id) => st.notes.filter((n) => (n.item || null) === id && (team || n.public)).map((n) => ({ id: n.id, text: n.text, public: !!n.public, at: n.at }));
  const items = TEMPLATE.map((t) => {
    const s = st.items[t.id] || {};
    const autoDate = t.auto && !(h && h.meta_only && t.id === 'google_live') ? auto[t.auto] || null : null;
    const done = s.done != null ? !!s.done : !!autoDate;
    return { id: t.id, phase: t.phase, title: s.title || t.title, why: s.why != null ? s.why : t.why, removed: !!s.removed, client: s.client != null ? !!s.client : t.client, done, date: s.date || (done ? autoDate : '') || '', auto: t.auto, auto_date: autoDate, due: s.due || '', notes: notesFor(t.id), custom: false };
  }).concat(st.custom.map((c) => ({ id: c.id, phase: c.phase, title: c.title, client: !!c.client, done: !!c.done, date: c.date || '', due: c.due || '', win: !!c.win, detail: c.detail || '', notes: notesFor(c.id), custom: true })));
  const hidden = new Set(st.hidden_wins || []);
  const WE = st.win_edits || {};
  const allWins = wins.map((w) => ({ ...w, ...(WE[w.id] || {}), edited: !!WE[w.id], hidden: hidden.has(w.id) }))
    .concat(st.custom.filter((c) => c.win && c.done).map((c) => ({ id: c.id, date: c.date, title: c.title, detail: c.detail || '', score: 80, auto: false, kind: 'win', hidden: !c.client })));
  const reports = {};
  for (const [d, name] of CHECKPOINTS) {
    const r = st.reports?.[d];
    const due = L ? addDays(L, d) : null;
    if (r && (team || (r.shared && r.text))) reports[d] = { ...r, name, due };
    else reports[d] = { name, due, status: r && r.status === 'working' && team ? 'working' : 'none' };
  }
  const out = {
    client_name: client.name, enabled: !!st.enabled, kickoff: st.kickoff || '', launch: L || '', launch_set: !!st.launch,
    today: todayIn(client.timezone), phases: PHASES.map(([id, name, sub]) => ({ id, name, sub })),
    items: team ? items : items.filter((i) => i.client && !i.removed),
    stage: stageIndex(L, todayIn(client.timezone)),
    notes: st.notes.filter((n) => !n.item && (team || n.public)).map((n) => ({ id: n.id, text: n.text, public: !!n.public, at: n.at })),
    wins: (team ? allWins : allWins.filter((w) => !w.hidden)).sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1)),
    reports,
    label: h ? h.label : 'Results',
    goal: h ? { cost: h.goals?.cost_per_conversion || null, monthly: h.goals?.monthly_conversions || null, roas: h.goals?.roas || null, note: h.goals?.note || '' } : null,
    totals: h && L ? sumWindow(h, L, h.to) : null,
    value: h && L ? valueOf(st, sumWindow(h, L, h.to)) : null,
    roadmap_url: /^https:\/\//i.test(st.roadmap_url || '') ? st.roadmap_url : '',
    data_to: h ? h.to : null,
  };
  if (team) { out.hidden_wins = [...hidden]; out.ai = !!process.env.ANTHROPIC_API_KEY; out.value_settings = cleanValue(st.value); out.ads_has_value = !!(h && h.revenue && h.days.some((d) => d.revenue > 0)); }
  return out;
}

/* ---------- return in dollars (optional per client) ----------
   value: { on, source: 'ads' (conversion value from Google Ads) | 'estimate' (results x close rate x average sale), close_rate, avg_sale } */
export function cleanValue(v = {}) {
  const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
  return { on: !!v.on, source: v.source === 'estimate' ? 'estimate' : 'ads', close_rate: n(v.close_rate) && Math.min(100, n(v.close_rate)), avg_sale: n(v.avg_sale) };
}
export function valueOf(st, w) {
  const v = cleanValue(st.value);
  if (!v.on || !w || !w.spend) return null;
  let amount = null;
  if (v.source === 'ads') amount = w.revenue > 0 ? w.revenue : null;
  else if (v.close_rate && v.avg_sale) amount = w.results * (v.close_rate / 100) * v.avg_sale;
  if (amount == null) return null;
  return { amount: Math.round(amount), roi: Math.round((amount / w.spend) * 10) / 10, estimate: v.source === 'estimate' };
}

/* ---------- checkpoint report ----------
   Each check-in compares its own period with the period just before it:
   30-day report: the last 30 days against the 30 days before them; 90-day: the last 90 against the 90 before; and so on. */
// Which stage of the first year the client is in: 0 onboarding (before launch), 1 launch (first week), 2 first 30 days, 3 to day 90, 4 to month 6, 5 after.
export function stageIndex(L, today) {
  if (!L) return 0;
  const n = daysBetween(L, today);
  return n < 0 ? 0 : n <= 7 ? 1 : n <= 30 ? 2 : n <= 90 ? 3 : n <= 182 ? 4 : 5;
}
const dailyTotals = (r, rk) => {
  const m = new Map();
  for (const d of r.daily || []) {
    const o = m.get(d.date) || { date: d.date, spend: 0, clicks: 0, impressions: 0, conversions: 0, leads: 0, calls: 0, deals: 0, revenue: 0 };
    for (const k of ['spend', 'clicks', 'impressions', 'conversions', 'leads', 'calls', 'deals', 'revenue']) o[k] += Number(d[k]) || 0;
    m.set(d.date, o);
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
};
export function reportWindows(L, days, lastDay) {
  const due = addDays(L, days - 1);
  const end = due < lastDay ? due : lastDay;
  return { end, early: due > lastDay, now: [addDays(end, -(days - 1)), end], prev: [addDays(end, -(2 * days - 1)), addDays(end, -days)] };
}
export async function makeReport({ client, st, days, env = process.env, fetchFn = fetch }) {
  const h = await history(client, st, { env, fetchFn, force: true });
  if (!h) throw Object.assign(new Error('Set the kickoff date first.'), { status: 400 });
  const L = launchDate(h, st);
  if (!L) throw Object.assign(new Error('The ads have not started yet, so there is nothing to compare.'), { status: 400 });
  const W = reportWindows(L, days, h.to);
  const demo = client.token === 'demo' || client.token === 'demo-calls' || (env.VPM_DEV && !env.GOOGLE_ADS_REFRESH_TOKEN);
  const get = (from, to) => (demo ? demoReport(client.token === 'demo' ? 'demo' : 'demo-calls', from, to) : buildReport({ client, from, to, env, fetchFn }));
  // both periods in one read, then the latest period again for its top campaigns, ads and searches
  const both = await get(W.prev[0], W.end);
  const hh = { ...h, days: dailyTotals(both, h.rk), to: W.end };
  const prev = { ...sumWindow(hh, W.prev[0], W.prev[1]), kind: 'previous' };
  // week by week (month by month for the 6-month and 1-year reports) for the charts
  const step = days > 120 ? 30 : 7, buckets = (a, b) => { const out = []; for (let e = b; e >= a; e = addDays(e, -step)) { const st0 = addDays(e, -(step - 1)) < a ? a : addDays(e, -(step - 1)); const w = sumWindow(hh, st0, e); out.unshift({ from: st0, to: e, spend: w.spend, results: w.results, cost: w.cost_per_result, revenue: w.revenue }); } return out; }; // full weeks counted back from the last day, so the newest bar is never a part week
  const series = { step, now: buckets(W.now[0], W.now[1]), before: buckets(W.prev[0], W.prev[1]) };
  const now = sumWindow(hh, W.now[0], W.now[1]);
  const since = sumWindow(h, L, W.end);
  const vNow = valueOf(st, now), vPrev = valueOf(st, prev);
  const wins = findWins({ ...h, days: h.days.filter((d) => d.date <= W.end), to: W.end }, st).filter((w) => !(st.hidden_wins || []).includes(w.id) && w.date >= W.now[0]);
  let detail = null;
  try {
    const r = await get(W.now[0], W.now[1]);
    const res = (o) => Number(h.rk === 'conversions' ? o.conversions : o[h.rk]) || 0;
    const camps = new Map((r.campaigns || []).map((c) => [c.id, { name: c.name, type: c.type, spend: 0, results: 0, clicks: 0 }]));
    for (const d of r.daily || []) { const c = camps.get(d.campaign_id); if (c && d.date >= W.now[0]) { c.spend += d.spend || 0; c.results += res(d); c.clicks += d.clicks || 0; } }
    const top = (arr, n = 5) => (arr || []).slice().sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, n).map((x) => ({ name: x.name, spend: Math.round(x.spend || 0), results: Math.round(res(x) * 10) / 10, clicks: x.clicks || 0, views: x.views || 0 }));
    detail = {
      campaigns: [...camps.values()].filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 8).map((c) => ({ ...c, spend: Math.round(c.spend), results: Math.round(c.results * 10) / 10 })),
      ads: top(r.items?.ads), videos: top(r.items?.videos), landing_pages: top(r.items?.landing), search_terms: top(r.items?.terms, 8),
    };
  } catch (e) { detail = { error: e.message }; }
  const done = TEMPLATE.map((t) => ({ t, s: st.items[t.id] || {} })).filter((x) => x.s.done && x.s.date >= W.now[0] && x.s.date <= W.end).map((x) => ({ title: x.s.title || x.t.title, date: x.s.date || '' }))
    .concat(st.custom.filter((c) => c.done && c.date >= W.now[0] && c.date <= W.end).map((c) => ({ title: c.title, date: c.date || '' })));
  const numbers = {
    client: client.name, checkpoint: days, period_days: days, label: h.label, kickoff: st.kickoff || null, launch: L, end: W.end, early: W.early,
    goal: { cost_per_result: h.goals?.cost_per_conversion || null, monthly_results: h.goals?.monthly_conversions || null, roas: h.goals?.roas || null, note: h.goals?.note || '' },
    before: prev, now, since_launch: since, series,
    value: vNow ? { now: vNow, before: vPrev } : null,
  };
  // Meta, counted by Meta and kept separate from Google's results
  if (both.meta?.platform === 'meta') numbers.platform = 'meta';
  const md = both.meta?.platform === 'meta' ? null : metaDays(both);
  if (md && md.days.some((d) => d.spend > 0)) numbers.meta = { label: md.label, before: metaWindow(md, W.prev[0], W.prev[1]), now: metaWindow(md, W.now[0], W.now[1]) };
  const facts = { numbers, wins: wins.map((w) => ({ date: w.date, title: w.title, detail: w.detail })), milestones_this_period: done, notes: st.notes.filter((n) => n.public).map((n) => n.text).slice(-10), detail };
  let text = null, by = 'rules', ai_error = null;
  if (env.ANTHROPIC_API_KEY) {
    try { text = await claudeWrite(facts, env, fetchFn); by = 'claude'; } catch (e) { ai_error = e.message; }
  }
  if (!text) text = ruleWrite(facts);
  return { days, generated_at: Date.now(), by, ai_error, early: W.early, numbers, wins: facts.wins, text, shared: false, status: 'done' };
}

// Video Power Marketing's voice (from the VPM brand voice guide), kept short for a busy owner.
const SYSTEM = `You write the check-in report Video Power Marketing (VPM) gives a client at 30 days, 90 days, 6 months and 1 year of running their Google and YouTube ads (and Meta ads, when numbers.meta is present).

Voice: VPM is the guide, the client is the hero. Write like a trusted partner talking over coffee: warm, direct, honest, humble. Use "we" and "you" and "together". Lead with what changed for their business, then the numbers that prove it. Plain words a business owner understands; explain any ad term in a few words or avoid it.
Never use these words: game-changer, revolutionary, disruptive, synergy, leverage, bandwidth, circle back, amazing, incredible, unbelievable, epic, "we believe", "we feel", comprehensive, holistic, end-to-end, basically, actually, very, just, simply, world-class, best-in-class, cutting-edge. No hype, no exclamation marks, no em dashes or en dashes (use commas or periods).
Be honest: celebrate real wins with numbers, name gaps plainly and say what we will do about them. Never invent or estimate numbers; use only the facts given.

If numbers.platform is "meta", this client only runs Meta (Facebook and Instagram) ads: every number is from Meta, so talk about Meta and do not mention Google or YouTube.
If numbers.meta is present, those are Meta (Facebook and Instagram) results as Meta counts them. Talk about them separately and never add them to the Google numbers, because each platform counts results its own way.

The comparison: "now" is the latest ${'${period}'}-day period, "before" is the ${'${period}'} days just before it. Say that plainly (for example "the last 30 days compared with the 30 days before"). If "value" is present it is ${'${valueKind}'}.

Structure it as Progress, Problems and Plans, kept short and easy to scan:
- headline: one line, 12 words or fewer, the most important result (honest, even when results are down)
- summary: 2 short sentences on where things stand
- progress: 2 to 3 items, what got better or what we built, each a short title and one sentence with a number
- problems: 1 to 3 items, what the data shows is not working yet, said plainly, each a short title and one sentence
- plans: 2 to 3 items, what we will do next and why, each a short title and one sentence. One plan may suggest a VPM service that would help (for example fresh video creative, a new campaign type, or landing page work) when the data supports it, framed as a recommendation, not a pitch.
If results are down, say so in the headline or summary and put the fix in plans. Do not hide bad news.
Return only JSON: {"headline": "", "summary": "", "progress": [{"title": "", "detail": ""}], "problems": [{"title": "", "detail": ""}], "plans": [{"title": "", "detail": ""}]}`;

async function claudeWrite(facts, env, fetchFn) {
  const v = facts.numbers.value;
  const system = SYSTEM.replace(/\$\{period\}/g, String(facts.numbers.period_days)).replace('${valueKind}', v ? (v.now.estimate ? 'an estimate of sales from the ads (results x close rate x average sale); call it an estimate' : 'the sales value Google Ads recorded') : 'not given');
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, system, messages: [{ role: 'user', content: 'Facts for the ' + facts.numbers.checkpoint + '-day check-in (JSON):\n' + JSON.stringify(facts) }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Anthropic: ' + (j.error?.message || res.status));
  const raw = (j.content || []).map((c) => c.text || '').join('');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Anthropic: no report in the answer');
  return tidy(JSON.parse(m[0]));
}
const nodash = (s) => String(s || '').replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/!/g, '.');
export function tidy(t) {
  const arr = (a) => (Array.isArray(a) ? a : []);
  const items = (a, n) => arr(a).slice(0, n).map((w) => (typeof w === 'string' ? { title: nodash(clip(w, 200)), detail: '' } : { title: nodash(clip(w.title, 120)), detail: nodash(clip(w.detail, 300)) }));
  return {
    headline: nodash(clip(t.headline, 160)), summary: nodash(clip(t.summary, 600)),
    progress: items(t.progress || t.wins, 4), problems: items(t.problems || t.opportunities, 3), plans: items(t.plans || t.next_steps, 4),
  };
}

// Without an Anthropic key: the same shape, from set phrases.
export function ruleWrite({ numbers: n, wins }) {
  const U = sing(n.label).toLowerCase(), UL = n.label.toLowerCase(), P = n.period_days || 30;
  const b = n.before, c = n.now;
  const bl = 'the ' + P + ' days before';
  const out = { headline: '', summary: '', progress: [], problems: [], plans: [] };
  const pct = (a, z) => (a && z ? Math.round(((z - a) / a) * 100) : null);
  const dCost = b && pct(b.cost_per_result, c.cost_per_result), dRes = b && b.results ? pct(b.results, c.results) : null;
  out.headline = c.results ? c.results + ' ' + UL + ' in the last ' + P + ' days' + (c.cost_per_result ? ', ' + money2(c.cost_per_result) + ' each' : '') : 'Your ads are live and learning';
  out.summary = 'In the last ' + P + ' days, ' + money(c.spend) + ' in ads brought in ' + c.results + ' ' + UL + '.' + (b && b.spend ? ' Compared with ' + bl + ', cost per ' + U + (dCost == null ? ' is not comparable yet.' : Math.abs(dCost) < 2 ? ' held steady.' : dCost <= 0 ? ' is down ' + -dCost + '%.' : ' is up ' + dCost + '%.') : '');
  if (dRes != null && dRes > 0) out.progress.push({ title: dRes + '% more ' + UL, detail: b.results + ' in ' + bl + ', ' + c.results + ' in the last ' + P + ' days.' });
  if (dCost != null && dCost <= -2) out.progress.push({ title: 'Each ' + U + ' costs ' + -dCost + '% less', detail: money2(b.cost_per_result) + ' before, ' + money2(c.cost_per_result) + ' now.' });
  for (const w of wins.slice(-3).reverse()) if (out.progress.length < 3) out.progress.push({ title: w.title, detail: w.detail });
  if (dRes != null && dRes < -5) out.problems.push({ title: 'Fewer ' + UL + ' than before', detail: c.results + ' in the last ' + P + ' days against ' + b.results + ' in ' + bl + '.' });
  if (dCost != null && dCost >= 5) out.problems.push({ title: 'Each ' + U + ' costs more', detail: money2(b.cost_per_result) + ' before, ' + money2(c.cost_per_result) + ' now.' });
  if (n.goal.cost_per_result && c.cost_per_result && c.cost_per_result > n.goal.cost_per_result) out.problems.push({ title: 'Above the ' + money2(n.goal.cost_per_result) + ' goal', detail: 'Cost per ' + U + ' is ' + money2(c.cost_per_result) + ' right now.' });
  if (out.problems.length < 2 && c.ctr != null && c.ctr < 0.02) out.problems.push({ title: 'Not enough people click', detail: (c.ctr * 100).toFixed(1) + '% of people who see the ads click.' });
  out.plans.push({ title: 'Move budget to what works', detail: 'More spend on the ads bringing the lowest cost per ' + U + '.' });
  out.plans.push({ title: 'Test fresh creative', detail: 'New video hooks and headlines to lift clicks and results.' });
  out.plans.push({ title: 'Review together', detail: 'We will walk through this report on our next call.' });
  return out;
}

/* ---------- check-ins coming due, for the All clients page ---------- */
// A report is flagged from 7 days before its date until 30 days after, unless it has been made.
export function checkinsDue(st, today) {
  const L = isDate(st.launch) ? st.launch : isDate(st.launch_auto) ? st.launch_auto : null;
  if (!L) return [];
  const out = [];
  for (const [d, name] of CHECKPOINTS) {
    const due = addDays(L, d);
    const r = st.reports?.[d];
    if (r && r.text) continue;
    const gap = daysBetween(today, due);
    if (gap <= 7 && gap >= -30) out.push({ days: d, label: name, due, overdue: gap < 0 });
  }
  return out;
}
