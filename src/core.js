/* ===== core: helpers, data model, aggregation ===== */
var root = document.getElementById('vpm');
if (!root) return;
var view = document.getElementById('view');
var DAY = 864e5;
var KEYS = ['spend', 'impr', 'clicks', 'views', 'conv', 'leads', 'calls', 'deals', 'rev'];
var META = {}, C = [], ITEMS = {}, START = 0, N = 30, HAS = { leads: 0, calls: 0, deals: 0, rev: 0 };
var T = {}, LBL = { leads: 'Leads', calls: 'Booked calls', deals: 'Sales' }, RK = 'leads', MODE = 'live', BM = null, TERMG = [];

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
function money2(v) { return '$' + v.toFixed(2); }
function comp(v) { return v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.0', '') + 'k' : '$' + Math.round(v); }
function int(v) { return Math.round(v).toLocaleString('en-US'); }
function xf(v) { return v.toFixed(2) + 'x'; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }
function pct0(v) { return Math.round(v * 100) + '%'; }
function NA() { return '<span class="mut">n/a</span>'; }
function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
function zeros(n) { var a = [], i; for (i = 0; i < n; i++) a.push(0); return a; }
function div(a, b) { return a.map(function (v, i) { return b[i] ? v / b[i] : 0; }); }
function roll7(a) { return a.map(function (_, i) { var s = Math.max(0, i - 6), sl = a.slice(s, i + 1); return sum(sl) / sl.length; }); }
function niceStep(x) { var p = Math.pow(10, Math.floor(Math.log10(x))), n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function hue(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
function dms(s) { return Date.parse(s + 'T00:00:00Z'); }
function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dlab(ms, withYear) { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' }); }
function dstr(i) { return dlab(START + i * DAY); }
function sing(label) { return String(label || '').toLowerCase().replace(/s$/, ''); }
function nz(v) { return v == null || v === '' || !isFinite(+v) ? null : +v; }
function blank() { var o = {}; KEYS.forEach(function (k) { o[k] = 0; }); return o; }
function hourLabel(h) { h = +h; return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; }

/* ---------- build the model from an API payload ---------- */
function build(P) {
  META = P.meta || {};
  var rg = META.range || { from: iso(Date.now() - 30 * DAY), to: iso(Date.now()), days: 30 };
  N = rg.days; START = dms(rg.from);
  var H = META.has || {};
  HAS = { leads: !!H.leads, calls: !!H.calls, deals: !!H.deals, rev: !!H.revenue };
  LBL = Object.assign({ leads: 'Leads', calls: 'Booked calls', deals: 'Sales' }, META.labels || {});
  var tg = META.targets || {};
  T = { cpl: nz(tg.cpl), cpc: nz(tg.cpc), roas: nz(tg.roas) || 3, be: nz(tg.breakeven) || 2 };
  RK = HAS.calls ? 'calls' : HAS.leads ? 'leads' : HAS.deals ? 'deals' : 'conv';
  LBL.conv = 'Conversions';
  MODE = META.demo ? 'demo' : 'live';
  var cm = {};
  C = [];
  function mk(id, name, type, extra) {
    var c = Object.assign({ id: String(id), name: name || ('Campaign ' + id), type: type || 'other', cur: blank(), pri: blank(), daily: {} }, extra || {});
    KEYS.forEach(function (k) { c.daily[k] = zeros(N); });
    cm[c.id] = c; C.push(c); return c;
  }
  (P.campaigns || []).forEach(function (c) {
    mk(c.id, c.name, c.type, { channel: c.channel, status: c.status, budget: c.budget, is: c.impression_share, lostB: c.lost_budget, lostR: c.lost_rank });
  });
  var map = { spend: 'spend', impressions: 'impr', clicks: 'clicks', views: 'views', conversions: 'conv', leads: 'leads', calls: 'calls', deals: 'deals', revenue: 'rev' };
  (P.daily || []).forEach(function (r) {
    var i = Math.round((dms(r.date) - START) / DAY), cur = i >= 0 && i < N, pri = i < 0 && i >= -N;
    if (!cur && !pri) return;
    var c = cm[r.campaign_id] || mk(r.campaign_id, null, 'other');
    var o = cur ? c.cur : c.pri;
    Object.keys(map).forEach(function (k) {
      var v = +r[k] || 0; o[map[k]] += v;
      if (cur) c.daily[map[k]][i] += v;
    });
  });
  // keep only campaigns that had any activity in either period
  C = C.filter(function (c) { return c.cur.spend > 0 || c.pri.spend > 0; });
  ITEMS = {};
  var byId = {}; C.forEach(function (c) { byId[c.id] = c; });
  Object.keys(P.items || {}).forEach(function (kind) {
    ITEMS[kind] = (P.items[kind] || []).map(function (r, idx) {
      var o = { cid: String(r.campaign_id || ''), camp: (byId[String(r.campaign_id)] || {}).name || '', name: r.name || '', detail: r.detail || '' };
      Object.keys(map).forEach(function (k) { o[map[k]] = +r[k] || 0; });
      if (kind === 'videos') { o.dur = r.detail; o.hue = hue(o.name); o.vid = String(r.video_id || ''); o.i = idx; }
      if (kind === 'ads') { o.h1 = o.name; o.h2 = o.detail; }
      return o;
    });
  });
  TERMG = [];
  var tgs = META.term_groups || {};
  Object.keys(tgs).forEach(function (n) { try { TERMG.push([n, new RegExp(tgs[n], 'i')]); } catch (e) { /* ignore bad pattern */ } });
  var all = agg(C);
  BM = all.cur[RK] ? all.cur.spend / all.cur[RK] : null;
}

/* ---------- aggregation ---------- */
function agg(list) {
  var out = { cur: blank(), pri: blank(), d: {} }, i;
  KEYS.forEach(function (k) { out.d[k] = zeros(N); });
  list.forEach(function (c) {
    KEYS.forEach(function (k) {
      out.cur[k] += c.cur[k]; out.pri[k] += c.pri[k];
      for (i = 0; i < N; i++) out.d[k][i] += c.daily[k][i];
    });
  });
  ['leads', 'calls', 'deals', 'rev'].forEach(function (k) {
    if (!HAS[k]) { out.cur[k] = null; out.pri[k] = null; out.d[k] = null; }
  });
  return out;
}
function cprO(o) { return o[RK] ? o.spend / o[RK] : null; }          // cost per main result
function cplO(o) { return o.leads ? o.spend / o.leads : null; }
function cpcO(o) { return o.calls ? o.spend / o.calls : null; }
function roasO(o) { return (o.rev != null && o.spend) ? o.rev / o.spend : null; }
function ctrO(o) { return o.impr ? o.clicks / o.impr : null; }
function cpclkO(o) { return o.clicks ? o.spend / o.clicks : null; }
function cvrO(o) { return o.clicks ? o.conv / o.clicks : null; }
function cpvO(o) { return o.conv ? o.spend / o.conv : null; }

/* ---------- verdicts ---------- */
function target() { return (RK === 'calls' ? T.cpc : T.cpl) || BM; }
function stat(o, thr) {
  if (o.spend < thr) return 'early';
  if (HAS.rev) { var r = o.spend ? o.rev / o.spend : 0; return r >= T.roas ? 'scale' : r >= T.be ? 'hold' : 'fix'; }
  var t = target();
  if (!t) return 'nodata';
  var c = o[RK] ? o.spend / o[RK] : Infinity;
  return c <= t ? 'scale' : c <= t * 1.3 ? 'hold' : 'fix';
}
var CL = { scale: 'good', hold: 'warn', fix: 'bad', early: 'early', nodata: 'early' };
var LBLS = { camp: { scale: 'Scaling', hold: 'Holding', fix: 'Fix or pause', early: 'Too early', nodata: 'No outcome data' }, item: { scale: 'Scale', hold: 'Keep', fix: 'Cut', early: 'Too early', nodata: 'No outcome data' } };
function thrCamp() { return Math.max(30, N * 5); }
function thrItem() { return Math.max(15, N * 1.7); }
function pill(o, kind, thr) { var s = stat(o, thr); return '<span class="pill ' + CL[s] + '">' + LBLS[kind][s] + '</span>'; }
function costC(v) { var t = target(); return v == null ? 'mut' : !t ? '' : v <= t ? 'good' : v <= t * 1.3 ? 'warn' : 'bad'; }
function roasC(v) { return v == null ? 'mut' : v >= T.roas ? 'good' : v >= T.be ? 'warn' : 'bad'; }

/* ---------- week buckets (Monday start) ---------- */
function weeks(A) {
  var out = [], cur = null, i;
  for (i = 0; i < N; i++) {
    var ms = START + i * DAY, dow = new Date(ms).getUTCDay(), mon = ms - ((dow + 6) % 7) * DAY;
    if (!cur || cur.mon !== mon) { cur = { mon: mon, first: i, last: i, days: 0 }; KEYS.forEach(function (k) { cur[k] = (k === 'leads' || k === 'calls' || k === 'deals' || k === 'rev') && !A.d[k] ? null : 0; }); out.push(cur); }
    cur.last = i; cur.days++;
    KEYS.forEach(function (k) { if (A.d[k]) cur[k] += A.d[k][i]; });
  }
  out.forEach(function (w) { w.label = dstr(w.first) + (w.last > w.first ? ' to ' + dstr(w.last) : ''); w.partial = w.days < 7; });
  return out;
}
