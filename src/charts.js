/* ===== charts: trend + projection, weekly bars/line, hour bars ===== */
var MET = {};
var MORDER = ['rev', 'spend', 'leads', 'calls', 'cpl', 'cpc', 'roas'];
function buildMET() {
  var sl = sing(LBL.leads), sc = sing(LBL.calls);
  MET = {
    rev: { l: 'Revenue vs spend', need: ['rev', 'spend'], a: function (F) { return F.rev; }, b: function (F) { return F.spend; }, fmt: comp, tf: money, n1: 'Revenue', n2: 'Spend', note: 'Per day, 7-day average' },
    spend: { l: 'Spend', need: ['spend'], a: function (F) { return F.spend; }, fmt: comp, tf: money, n1: 'Spend', note: 'Per day, 7-day average' },
    leads: { l: LBL.leads, need: ['leads'], a: function (F) { return F.leads; }, fmt: int, tf: function (v) { return v.toFixed(1); }, n1: LBL.leads, note: 'Per day, 7-day average' },
    calls: { l: LBL.calls, need: ['calls'], a: function (F) { return F.calls; }, fmt: int, tf: function (v) { return v.toFixed(1); }, n1: LBL.calls, note: 'Per day, 7-day average' },
    cpl: { l: 'Cost per ' + sl, need: ['spend', 'leads'], a: function (F) { return div(F.spend, F.leads); }, fmt: function (v) { return '$' + Math.round(v); }, tf: money2, n1: 'Cost per ' + sl, note: '7-day average' },
    cpc: { l: 'Cost per ' + sc, need: ['spend', 'calls'], a: function (F) { return div(F.spend, F.calls); }, fmt: function (v) { return '$' + Math.round(v); }, tf: money, n1: 'Cost per ' + sc, note: '7-day average' },
    roas: { l: 'ROAS', need: ['rev', 'spend'], a: function (F) { return div(F.rev, F.spend); }, fmt: function (v) { return v.toFixed(1) + 'x'; }, tf: xf, n1: 'ROAS', note: '7-day average' }
  };
}
function availMets(A) { return MORDER.filter(function (k) { return MET[k].need.every(function (n) { return A.d[n]; }) && !(k === 'spend' && A.d.rev); }); }
function horizon() { return N >= 14 ? Math.min(30, N) : 0; }
function forecast(d, s) {
  var out = {}, e = 0.8, H = horizon();
  ['spend', 'leads', 'calls', 'rev'].forEach(function (k) {
    if (!d[k]) return;
    var a = d[k], n = a.length, xm = (n - 1) / 2, ym = sum(a) / n, num = 0, den = 0, i, f;
    a.forEach(function (y, i2) { num += (i2 - xm) * (y - ym); den += Math.pow(i2 - xm, 2); });
    var slope = den ? 0.6 * num / den : 0, w = Math.min(14, n), base = sum(a.slice(n - w)) / w, ctr = (n - w + n - 1) / 2;
    var m = k === 'spend' ? (1 + s) : Math.pow(1 + s, e);
    out[k] = [];
    for (f = 0; f < H; f++) out[k].push(Math.max(base * 0.5, base + slope * (n + f - ctr)) * m);
  });
  return out;
}
function svgBase(W, H) { return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" '; }
function tipMove(el, hv, tip, sv, W, px, X, html, ys) {
  var r = sv.getBoundingClientRect();
  hv.style.display = '';
  var ln = hv.querySelector('line'); ln.setAttribute('x1', px); ln.setAttribute('x2', px);
  var cs = hv.querySelectorAll('circle');
  ys.forEach(function (y, j) { if (cs[j]) { cs[j].setAttribute('cx', px); cs[j].setAttribute('cy', y); } });
  tip.innerHTML = html; tip.style.display = 'block';
  var tw = tip.offsetWidth, lx = px * r.width / W + 12;
  if (lx + tw > r.width) lx = px * r.width / W - tw - 12;
  tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = '20px';
}
function drawChart(el, d, scn, mk) {
  if (!el) return;
  var M = MET[mk];
  if (!M || !M.need.every(function (n) { return d[n]; })) { el.innerHTML = '<p class="msg">This metric is not tracked for this view yet.</p>'; return; }
  var f = forecast(d, scn), F = {}, H = horizon(), Nn = N + H;
  ['spend', 'leads', 'calls', 'rev'].forEach(function (k) { if (d[k]) F[k] = roll7(d[k].concat(f[k] || [])); });
  var s1 = M.a(F), s2 = M.b ? M.b(F) : null;
  var W = Math.max(300, el.clientWidth), Hh = W < 520 ? 220 : 280, m = { l: W < 520 ? 42 : 52, r: 14, t: 14, b: 28 };
  var iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  var mx = Math.max.apply(null, s1.concat(s2 || [])) * 1.08 || 1, st = niceStep(mx / 4), top = Math.ceil(mx / st) * st;
  function X(i) { return m.l + (Nn > 1 ? i * iw / (Nn - 1) : iw / 2); }
  function Y(v) { return m.t + ih - v / top * ih; }
  function path(a, from, to) { var p = '', i; for (i = from; i <= to; i++) p += (i === from ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(a[i]).toFixed(1); return p; }
  var g = '', v, t;
  for (v = 0; v <= top + 1e-9; v += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + M.fmt(v) + '</text>';
  for (t = 0; t < 5; t++) { var ix = Math.round(t * (Nn - 1) / 4); g += '<text class="ax" x="' + X(ix) + '" y="' + (Hh - 8) + '" text-anchor="' + (t === 0 ? 'start' : t === 4 ? 'end' : 'middle') + '">' + dstr(ix) + '</text>'; }
  var fx = X(N - 1);
  var proj = H ? '<rect x="' + fx + '" y="' + m.t + '" width="' + (W - m.r - fx) + '" height="' + ih + '" fill="var(--soft)" opacity=".9"/><text class="ax" x="' + (fx + 8) + '" y="' + (m.t + 14) + '">Projected</text>' : '';
  var svg = svgBase(W, Hh) + 'aria-label="' + esc(M.l) + ' trend">' + proj + g +
    '<path d="' + path(s1, 0, N - 1) + ' L' + X(N - 1) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + 'Z" fill="var(--c1)" opacity=".1"/>' +
    (s2 ? '<path d="' + path(s2, 0, N - 1) + '" fill="none" stroke="var(--c2)" stroke-width="2"/>' + (H ? '<path d="' + path(s2, N - 1, Nn - 1) + '" fill="none" stroke="var(--c2)" stroke-width="2" stroke-dasharray="5 4"/>' : '') : '') +
    '<path d="' + path(s1, 0, N - 1) + '" fill="none" stroke="var(--c1)" stroke-width="2.5"/>' + (H ? '<path d="' + path(s1, N - 1, Nn - 1) + '" fill="none" stroke="var(--c1)" stroke-width="2.5" stroke-dasharray="5 4"/>' : '') +
    '<circle cx="' + X(N - 1) + '" cy="' + Y(s1[N - 1]) + '" r="5" fill="var(--c3)" stroke="var(--panel)" stroke-width="2"/>' +
    '<g class="hv" style="display:none"><line y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--muted)" stroke-width="1"/><circle r="4" fill="var(--c1)"/>' + (s2 ? '<circle r="4" fill="var(--c2)"/>' : '') + '</g>' +
    '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
  el.innerHTML = svg + '<div class="tip"></div><div class="legend"><span><i style="background:var(--c1)"></i>' + M.n1 + '</span>' + (M.n2 ? '<span><i style="background:var(--c2)"></i>' + M.n2 + '</span>' : '') + (H ? '<span>Dashed = projection</span>' : '') + '<span>' + M.note + '</span></div>';
  var hit = el.querySelector('.hit'), hv = el.querySelector('.hv'), tip = el.querySelector('.tip'), sv = el.querySelector('svg');
  function mv(e) {
    var r = sv.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, i = Math.max(0, Math.min(Nn - 1, Math.round((px - m.l) / iw * (Nn - 1))));
    tipMove(el, hv, tip, sv, W, X(i), X, '<b>' + dstr(i) + (i >= N ? ' (projected)' : '') + '</b><br>' + M.n1 + ': ' + M.tf(s1[i]) + (s2 ? '<br>' + M.n2 + ': ' + M.tf(s2[i]) : ''), s2 ? [Y(s1[i]), Y(s2[i])] : [Y(s1[i])]);
  }
  hit.addEventListener('pointermove', mv); hit.addEventListener('pointerdown', mv);
  hit.addEventListener('pointerleave', function () { hv.style.display = 'none'; tip.style.display = 'none'; });
}

/* weekly bars (results) or line (cost per result) */
function weekChart(el, Wk, kind) {
  if (!el) return;
  var rows = Wk.map(function (w) { return { w: w, v: kind === 'bars' ? (w[RK] || 0) : (w[RK] ? w.spend / w[RK] : null) }; });
  var vals = rows.map(function (r) { return r.v; }).filter(function (v) { return v != null; });
  if (!vals.length) { el.innerHTML = '<p class="msg">No results in this range yet.</p>'; return; }
  var W = Math.max(280, el.clientWidth), Hh = 220, m = { l: kind === 'bars' ? 36 : 46, r: 10, t: 12, b: 28 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  var mx = Math.max.apply(null, vals) * 1.12 || 1, st = niceStep(mx / 4), top = Math.ceil(mx / st) * st;
  function Y(v) { return m.t + ih - v / top * ih; }
  var n = rows.length, band = iw / n;
  function X(i) { return m.l + band * (i + 0.5); }
  var g = '', v, i, step = band < 38 ? Math.ceil(38 / band) : 1;
  for (v = 0; v <= top + 1e-9; v += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + (kind === 'bars' ? int(v) : '$' + Math.round(v)) + '</text>';
  rows.forEach(function (r, j) { if (j % step === 0) g += '<text class="ax" x="' + X(j) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + dlab(r.w.mon > START ? r.w.mon : START + r.w.first * DAY) + '</text>'; });
  var body = '';
  if (kind === 'bars') {
    var bw = Math.max(4, band * 0.62);
    rows.forEach(function (r, j) { body += '<rect x="' + (X(j) - bw / 2) + '" y="' + Y(r.v) + '" width="' + bw + '" height="' + (Y(0) - Y(r.v)) + '" rx="3" fill="var(--c1)" opacity="' + (r.w.partial ? 0.4 : 1) + '"/>'; });
  } else {
    var p = '', started = false;
    rows.forEach(function (r, j) { if (r.v == null || r.w.partial) { started = false; return; } p += (started ? 'L' : 'M') + X(j).toFixed(1) + ' ' + Y(r.v).toFixed(1); started = true; });
    var avg = sum(rows.map(function (r) { return r.w.spend; })) / (sum(rows.map(function (r) { return r.w[RK] || 0; })) || 1);
    body += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(Math.min(avg, top)) + '" y2="' + Y(Math.min(avg, top)) + '" stroke="var(--muted)" stroke-dasharray="4 4"/><text class="ax" x="' + (W - m.r) + '" y="' + (Y(Math.min(avg, top)) - 5) + '" text-anchor="end">Average ' + money(avg) + '</text>';
    body += '<path d="' + p + '" fill="none" stroke="var(--c1)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    rows.forEach(function (r, j) { if (r.v != null) body += '<circle cx="' + X(j) + '" cy="' + Y(r.v) + '" r="3.5" fill="' + (r.w.partial ? 'var(--panel)' : 'var(--c1)') + '" stroke="var(--c1)" stroke-width="2"/>'; });
  }
  var hit = '';
  rows.forEach(function (r, j) { hit += '<rect class="wh" data-i="' + j + '" x="' + (m.l + band * j) + '" y="0" width="' + band + '" height="' + Hh + '" fill="transparent"/>'; });
  el.innerHTML = svgBase(W, Hh) + 'aria-label="' + (kind === 'bars' ? 'Results per week' : 'Cost per result per week') + '">' + g + body + hit + '</svg><div class="tip"></div>';
  var tip = el.querySelector('.tip'), sv = el.querySelector('svg');
  function show(e) {
    var j = +e.target.dataset.i, r = rows[j], rect = sv.getBoundingClientRect();
    tip.innerHTML = '<b>' + esc(r.w.label) + (r.w.partial ? ' (partial)' : '') + '</b><br>' + int(r.w[RK] || 0) + ' ' + esc(rlab().toLowerCase()) + '<br>' + (r.w[RK] ? money(r.w.spend / r.w[RK]) + ' each<br>' : '') + money(r.w.spend) + ' spend';
    tip.style.display = 'block';
    var px = (m.l + band * (j + 0.5)) * rect.width / W, tw = tip.offsetWidth, lx = px + 12;
    if (lx + tw > rect.width) lx = px - tw - 12;
    tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = '10px';
  }
  el.querySelectorAll('.wh').forEach(function (r) { r.addEventListener('pointermove', show); r.addEventListener('pointerdown', show); r.addEventListener('pointerleave', function () { tip.style.display = 'none'; }); });
}

/* spend by hour */
function hourChart(el) {
  if (!el) return;
  var H = (ITEMS.hours || []).slice().sort(function (a, b) { return +a.name - +b.name; });
  if (!H.length) { el.innerHTML = '<p class="msg">Hourly data is not available for this view.</p>'; return; }
  var W = Math.max(280, el.clientWidth), Hh = 220, m = { l: 46, r: 8, t: 12, b: 28 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  var mx = Math.max.apply(null, H.map(function (h) { return h.spend; })) * 1.1 || 1, st = niceStep(mx / 4), top = Math.ceil(mx / st) * st;
  function Y(v) { return m.t + ih - v / top * ih; }
  var band = iw / H.length, g = '', v;
  for (v = 0; v <= top + 1e-9; v += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + comp(v) + '</text>';
  var bars = '', hit = '';
  H.forEach(function (h, j) {
    var x = m.l + band * j;
    if (j % 4 === 0) g += '<text class="ax" x="' + (x + band / 2) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + hourLabel(h.name) + '</text>';
    bars += '<rect x="' + (x + band * 0.15) + '" y="' + Y(h.spend) + '" width="' + (band * 0.7) + '" height="' + (Y(0) - Y(h.spend)) + '" rx="2" fill="var(--c1)"/>';
    hit += '<rect class="wh" data-i="' + j + '" x="' + x + '" y="0" width="' + band + '" height="' + Hh + '" fill="transparent"/>';
  });
  el.innerHTML = svgBase(W, Hh) + 'aria-label="Spend by hour of day">' + g + bars + hit + '</svg><div class="tip"></div>';
  var tip = el.querySelector('.tip'), sv = el.querySelector('svg');
  function show(e) {
    var j = +e.target.dataset.i, h = H[j], rect = sv.getBoundingClientRect();
    tip.innerHTML = '<b>' + hourLabel(h.name) + ' to ' + hourLabel((+h.name + 1) % 24) + '</b><br>' + money(h.spend) + ' spend<br>' + int(h.clicks) + ' clicks<br>' + int(h[RK] || 0) + ' ' + esc(rlab().toLowerCase()) + (h[RK] ? '<br>' + money(h.spend / h[RK]) + ' each' : '');
    tip.style.display = 'block';
    var px = (m.l + band * (j + 0.5)) * rect.width / W, tw = tip.offsetWidth, lx = px + 12;
    if (lx + tw > rect.width) lx = px - tw - 12;
    tip.style.left = Math.max(0, lx) + 'px'; tip.style.top = '10px';
  }
  el.querySelectorAll('.wh').forEach(function (r) { r.addEventListener('pointermove', show); r.addEventListener('pointerdown', show); r.addEventListener('pointerleave', function () { tip.style.display = 'none'; }); });
}
