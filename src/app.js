/* ===== app: shell, date range, loading, events ===== */
var API = window.VPM_API_URL || '/api/report';
var KEY = '';
try { KEY = new URLSearchParams(location.search).get('k') || ''; } catch (e) { /* no query */ }
var CACHE = {}, loadSeq = 0, loaded = false;

function render() {
  var v = S.view === 'campaign' ? 'campaigns' : S.view;
  document.getElementById('nav').innerHTML = Object.keys(VIEWS).map(function (k) { return '<button data-go="' + k + '" class="' + (v === k ? 'on' : '') + '" ' + (v === k ? 'aria-current="page"' : '') + '><svg viewBox="0 0 20 20" aria-hidden="true">' + ICON[k] + '</svg>' + VIEWS[k][0] + '</button>'; }).join('');
  var cc = S.view === 'campaign' ? camp(S.cid) : null, t = cc ? [cc.name, 'Campaign drill-down'] : VIEWS[S.view];
  document.getElementById('ttl').textContent = t[0];
  var sub = t[1]; if (S.view === 'overview' && META.client_name) sub = META.client_name + ' · ' + sub;
  document.getElementById('sub').textContent = sub;
  var types = []; C.forEach(function (c) { if (types.indexOf(c.type) < 0) types.push(c.type); });
  var seg = document.getElementById('typeseg');
  if (types.length > 1) {
    seg.hidden = false;
    var opts = [['all', 'All campaigns']].concat(types.map(function (x) { return [x, TYPE_LBL[x] || 'Other']; }));
    seg.innerHTML = opts.map(function (o) { return '<button data-type="' + o[0] + '" class="' + (S.type === o[0] ? 'on' : '') + '" aria-pressed="' + (S.type === o[0]) + '">' + o[1] + '</button>'; }).join('');
  } else { seg.hidden = true; S.type = 'all'; }
  var f = { overview: vOverview, weekly: vWeekly, trends: vTrends, campaigns: vCampaigns, audiences: vAudiences, videos: vVideos, ads: vAds, insights: vInsights, campaign: vDetail }[S.view];
  charts = []; view.innerHTML = f(); paintCharts();
  if (S.view === 'trends') scnNote();
  if (S.view === 'weekly') { var A = agg(list()), Wk = weeks(A); weekChart(document.getElementById('ch-wk1'), Wk, 'bars'); weekChart(document.getElementById('ch-wk2'), Wk, 'line'); hourChart(document.getElementById('ch-hr')); }
  try { history.replaceState(null, '', location.search + '#' + (S.view === 'campaign' ? 'c-' + S.cid : S.view)); } catch (e) { /* ignore */ }
}
function go(v, cid) { S.view = v; S.cid = cid || null; render(); try { root.scrollIntoView(); } catch (e) { /* ignore */ } window.scrollTo(0, 0); }

/* ---------- date range ---------- */
var MODES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['custom', 'Custom']];
function rangeQS() {
  if (S.range.mode === 'custom' && S.range.from && S.range.to) return 'from=' + S.range.from + '&to=' + S.range.to;
  return 'days=' + (S.range.mode === 'custom' ? '30' : S.range.mode);
}
function drawRangeBar() {
  var seg = document.getElementById('rangeseg');
  seg.innerHTML = MODES.map(function (m) { return '<button data-range="' + m[0] + '" class="' + (S.range.mode === m[0] ? 'on' : '') + '" aria-pressed="' + (S.range.mode === m[0]) + '">' + m[1] + '</button>'; }).join('');
  var bar = document.getElementById('rangebar');
  var up = '';
  if (META.refreshed_at) { var d = new Date(META.refreshed_at); up = isFinite(d) ? ' · Updated ' + d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' }) + ' MT' : ''; }
  var info = loaded ? '<div class="chip"><b>' + dlab(START, true) + ' to ' + dlab(START + (N - 1) * DAY, true) + '</b>' + esc(up) + '</div><div class="chip">vs ' + esc(prevLabel()) + '</div>' : '';
  var form = '';
  if (S.range.mode === 'custom') {
    var maxd = iso(Date.now() + DAY);
    form = '<form class="custom" id="customform"><label>From <input type="date" id="cfrom" required max="' + maxd + '" value="' + esc(S.range.from) + '"></label><label>To <input type="date" id="cto" required max="' + maxd + '" value="' + esc(S.range.to) + '"></label><button type="submit" class="apply">Apply</button></form>';
  }
  bar.innerHTML = form + info;
}
function setBusy(b) { view.classList.toggle('busy', b); root.setAttribute('aria-busy', b ? 'true' : 'false'); }
function banners() {
  document.getElementById('sample').hidden = MODE !== 'demo';
  document.getElementById('stale').hidden = !META.stale;
  if (META.client_name) document.getElementById('sidefoot').textContent = META.client_name;
  try { document.title = (META.client_name ? META.client_name + ' ' : '') + 'Performance Report'; } catch (e) { /* ignore */ }
}
function fail(msg) { setBusy(false); view.innerHTML = '<div class="panel"><p class="msg">' + esc(msg) + '</p></div>'; drawRangeBar(); }
function apply(P) {
  build(P); buildMET(); loaded = true;
  var h = ''; try { h = location.hash.slice(1); } catch (e) { /* ignore */ }
  if (!S.fresh) { S.fresh = 1; if (VIEWS[h]) S.view = h; else if (h.indexOf('c-') === 0 && camp(h.slice(2))) { S.view = 'campaign'; S.cid = h.slice(2); } }
  if (S.view === 'campaign' && !camp(S.cid)) S.view = 'campaigns';
  S.met = { o: null, t: null, cd: null };
  banners(); drawRangeBar(); setBusy(false); render();
}
function load() {
  var qs = rangeQS(), my = ++loadSeq;
  if (CACHE[qs]) { apply(CACHE[qs]); return; }
  setBusy(true); drawRangeBar();
  var dbg = ''; try { var sp = new URLSearchParams(location.search); if (sp.get('fresh') === '1' && sp.get('s')) dbg = '&fresh=1&s=' + encodeURIComponent(sp.get('s')); } catch (e) { /* ignore */ }
  fetch(API + (API.indexOf('?') > -1 ? '&' : '?') + 'k=' + encodeURIComponent(KEY) + '&' + qs + dbg, { cache: 'no-store' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (x) {
      if (my !== loadSeq) return;
      if (!x.ok || x.j.error) { fail(((x.j && x.j.error) || 'The report data could not be loaded. Try again in a few minutes.') + (x.j && x.j.reason ? ' Details: ' + x.j.reason : '')); return; }
      CACHE[qs] = x.j; apply(x.j);
    })
    .catch(function (err) { if (my !== loadSeq) return; try { console.error(err); } catch (e) { /* ignore */ } fail('The report data could not be loaded. Try again in a few minutes. If it keeps happening, contact Video Power Marketing.'); });
  try {
    var p = new URLSearchParams(location.search); p.delete('r'); p.delete('from'); p.delete('to');
    if (S.range.mode === 'custom' && S.range.from && S.range.to) { p.set('from', S.range.from); p.set('to', S.range.to); } else p.set('r', S.range.mode === 'custom' ? '30' : S.range.mode);
    history.replaceState(null, '', '?' + p.toString() + location.hash);
  } catch (e) { /* ignore */ }
}

/* ---------- events ---------- */
root.addEventListener('click', function (e) {
  var t = e.target.closest('[data-go],[data-camp],[data-met],[data-type],[data-sort],[data-range]'); if (!t || !root.contains(t)) return;
  if (t.tagName === 'A') e.preventDefault();
  if (t.dataset.range) {
    var m = t.dataset.range;
    if (m === 'custom') {
      S.range.mode = 'custom';
      if (!S.range.from) { var end = new Date(START + (N - 1) * DAY); S.range.to = iso(end.getTime()); S.range.from = iso(START); }
      drawRangeBar(); return;
    }
    S.range.mode = m; load(); return;
  }
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.camp) return go('campaign', t.dataset.camp);
  if (t.dataset.met) {
    var p = t.dataset.met.split(':'); S.met[p[0]] = p[1];
    t.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === t); });
    var c = charts.filter(function (x) { return x.id === p[0]; })[0]; if (c) drawChart(document.getElementById('ch-' + p[0]), c.A.d, S.scn, p[1]); return;
  }
  if (t.dataset.type) { S.type = t.dataset.type; if (S.view === 'campaign') S.view = 'campaigns'; return render(); }
  if (t.dataset.sort) { var q = t.dataset.sort.split(':'), cur = S.sort[q[0]]; S.sort[q[0]] = cur && cur[0] === q[1] ? [q[1], -cur[1]] : [q[1], q[1] === 'name' || q[1] === 'camp' ? 1 : -1]; return render(); }
});
root.addEventListener('submit', function (e) {
  if (e.target.id !== 'customform') return;
  e.preventDefault();
  var a = document.getElementById('cfrom').value, b = document.getElementById('cto').value;
  var cto = document.getElementById('cto'); cto.setCustomValidity('');
  if (!a || !b || a > b) { cto.setCustomValidity('Choose an end date that is on or after the start date.'); cto.reportValidity(); return; }
  S.range.from = a; S.range.to = b; load();
});
root.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-camp]')) { e.preventDefault(); go('campaign', e.target.dataset.camp); } });
root.addEventListener('input', function (e) {
  if (e.target.id !== 'scn') return;
  S.scn = e.target.value / 100; document.getElementById('scnout').textContent = scnText();
  var A = charts[0].A; drawChart(document.getElementById('ch-t'), A.d, S.scn, S.met.t); document.getElementById('proj').innerHTML = projTable(A); scnNote();
});
var rt; window.addEventListener('resize', function () {
  clearTimeout(rt); rt = setTimeout(function () {
    paintCharts();
    if (S.view === 'weekly' && loaded) { var A = agg(list()), Wk = weeks(A); weekChart(document.getElementById('ch-wk1'), Wk, 'bars'); weekChart(document.getElementById('ch-wk2'), Wk, 'line'); hourChart(document.getElementById('ch-hr')); }
  }, 120);
});

/* ---------- start ---------- */
(function () {
  var p; try { p = new URLSearchParams(location.search); } catch (e) { p = new URLSearchParams(''); }
  var r = p.get('r'), f = p.get('from'), t = p.get('to');
  if (f && t && /^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) { S.range = { mode: 'custom', from: f, to: t }; }
  else if (r === '7' || r === '30' || r === '90') S.range.mode = r;
  if (!KEY) { fail('This report link is not valid. Ask your Video Power Marketing contact for a new one.'); return; }
  drawRangeBar();
  load();
})();
