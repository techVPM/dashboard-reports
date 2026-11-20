/* ===== check-in report view, shared by the client report, the team editor and the PDF page ===== */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m0(v) { return v == null ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'); }
  function m2(v) { return v == null ? 'n/a' : '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)); }
  function n0(v) { return v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'); }
  function dl(s, y) { return s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: y ? 'numeric' : undefined, timeZone: 'UTC' }) : ''; }
  function sing(s) { return String(s || '').toLowerCase().replace(/ies$/, 'y').replace(/s$/, ''); }
  function pct(a, z) { return a == null || z == null || !a ? null : Math.round((z - a) / a * 100); }
  function chg(a, z, lowerBetter, P) {
    var p = pct(a, z); if (p == null) return '<span class="jr-ch">No earlier period to compare</span>';
    if (!p) return '<span class="jr-ch">Same as the ' + P + ' days before</span>';
    var good = lowerBetter ? p < 0 : p > 0;
    return '<span class="jr-ch ' + (good ? 'up' : 'dn') + '">' + (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '%</span><span class="jr-ch"> vs the ' + P + ' days before</span>';
  }
  // bars: this period, with the period before as a faint bar behind each one
  function barChart(now, before, key, fmt, unit) {
    var W = 640, H = 200, pad = { l: 44, r: 10, t: 12, b: 26 };
    var n = now.length; if (!n) return '';
    var vals = now.map(function (x) { return x[key] || 0; }).concat(before.map(function (x) { return x[key] || 0; }));
    var max = Math.max.apply(null, vals.concat([1])), step = (W - pad.l - pad.r) / n, bw = Math.max(4, step * 0.56);
    var y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - v / max); };
    var g = '';
    for (var t = 0; t <= 2; t++) { var v = max * t / 2, yy = y(v); g += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '" class="jr-grid"/><text x="' + (pad.l - 6) + '" y="' + (yy + 4) + '" class="jr-ax" text-anchor="end">' + fmt(v) + '</text>'; }
    now.forEach(function (x, i) {
      var cx = pad.l + step * i + step / 2, b = before[i];
      if (b) g += '<rect x="' + (cx - bw / 2 - 3) + '" y="' + y(b[key] || 0) + '" width="' + bw + '" height="' + (H - pad.b - y(b[key] || 0)) + '" rx="3" class="jr-b0"><title>' + esc(unit) + ' ' + dl(b.from) + ': ' + fmt(b[key] || 0) + '</title></rect>';
      g += '<rect x="' + (cx - bw / 2 + 3) + '" y="' + y(x[key] || 0) + '" width="' + bw + '" height="' + (H - pad.b - y(x[key] || 0)) + '" rx="3" class="jr-b1"><title>' + esc(unit) + ' ' + dl(x.from) + ': ' + fmt(x[key] || 0) + '</title></rect>';
      if (n <= 14 || i % Math.ceil(n / 7) === 0) g += '<text x="' + cx + '" y="' + (H - 8) + '" class="jr-ax" text-anchor="middle">' + dl(x.from) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="jr-svg" role="img" aria-label="' + esc(unit) + ' over time">' + g + '</svg>';
  }
  // lines: cost per result, this period and the period before, with the goal
  function lineChart(now, before, goal) {
    var W = 640, H = 200, pad = { l: 52, r: 10, t: 12, b: 26 };
    var n = Math.max(now.length, before.length); if (n < 2) return '';
    var vals = now.concat(before).map(function (x) { return x.cost; }).filter(function (v) { return v != null; });
    if (!vals.length) return '';
    var max = Math.max.apply(null, vals.concat([goal || 0])) * 1.1, min = 0;
    var x = function (i) { return pad.l + (W - pad.l - pad.r) * (n === 1 ? 0.5 : i / (n - 1)); }, y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min)); };
    var path = function (arr) { var d = '', on = false; arr.forEach(function (p, i) { if (p.cost == null) { on = false; return; } d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.cost).toFixed(1) + ' '; on = true; }); return d; };
    var g = '';
    for (var t = 0; t <= 2; t++) { var v = max * t / 2, yy = y(v); g += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '" class="jr-grid"/><text x="' + (pad.l - 6) + '" y="' + (yy + 4) + '" class="jr-ax" text-anchor="end">' + m0(v) + '</text>'; }
    if (goal) g += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(goal) + '" y2="' + y(goal) + '" class="jr-goal"/><text x="' + (W - pad.r) + '" y="' + (y(goal) - 5) + '" class="jr-ax jr-goalt" text-anchor="end">Goal ' + m0(goal) + '</text>';
    g += '<path d="' + path(before) + '" class="jr-l0"/><path d="' + path(now) + '" class="jr-l1"/>';
    now.forEach(function (p, i) { if (p.cost != null) g += '<circle cx="' + x(i) + '" cy="' + y(p.cost) + '" r="3.5" class="jr-dot"><title>' + dl(p.from) + ': ' + m2(p.cost) + '</title></circle>'; if (n <= 14 || i % Math.ceil(n / 7) === 0) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="jr-ax" text-anchor="middle">' + dl(p.from) + '</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="jr-svg" role="img" aria-label="Cost per result over time">' + g + '</svg>';
  }
  function list(arr, cls, numbered) {
    if (!arr || !arr.length) return '';
    return '<ul class="jr-list ' + cls + '">' + arr.map(function (x, i) { var t = typeof x === 'string' ? { title: x, detail: '' } : x; return '<li>' + (numbered ? '<span class="jr-n">' + (i + 1) + '</span>' : '<span class="jr-ic"></span>') + '<div><b>' + esc(t.title) + '</b>' + (t.detail ? '<p>' + esc(t.detail) + '</p>' : '') + '</div></li>'; }).join('') + '</ul>';
  }
  // r: the saved report. Returns the inside of the report (no page header).
  function report(r, opts) {
    opts = opts || {};
    var n = r.numbers || {}, b = n.before || {}, c = n.now || {}, t = r.text || {}, U = n.label || opts.label || 'Results', P = n.period_days || r.days || 30;
    var prog = t.progress || t.wins || [], prob = t.problems || t.opportunities || [], plans = t.plans || t.next_steps || [];
    var S = n.series || null, per = S && S.step > 7 ? 'month' : 'week';
    var h = '<div class="jr">';
    h += '<div class="jr-top"><p class="jr-k">' + esc(r.name || (P + '-day')) + ' check-in · ' + dl(c.from) + ' to ' + dl(c.to, 1) + '</p><h2 class="jr-h">' + esc(t.headline) + '</h2>' + (t.summary ? '<p class="jr-sum">' + esc(t.summary) + '</p>' : '') + '</div>';
    h += '<div class="jr-cards"><div class="jr-card"><span class="jr-l">' + esc(U) + '</span><b>' + n0(c.results) + '</b>' + chg(b.results, c.results, 0, P) + '</div>' +
      '<div class="jr-card"><span class="jr-l">Cost per ' + esc(sing(U)) + '</span><b>' + m2(c.cost_per_result) + '</b>' + chg(b.cost_per_result, c.cost_per_result, 1, P) + '</div>' +
      (n.value ? '<div class="jr-card jr-val"><span class="jr-l">' + (n.value.now.estimate ? 'Estimated sales' : 'Sales from the ads') + '</span><b>' + m0(n.value.now.amount) + '</b><span class="jr-ch">' + n.value.now.roi.toFixed(1) + 'x return on ad spend</span></div>'
        : '<div class="jr-card"><span class="jr-l">Invested in ads</span><b>' + m0(c.spend) + '</b>' + chg(b.spend, c.spend, 0, P) + '</div>') + '</div>';
    if (S && S.now && S.now.length > 1) {
      h += '<div class="jr-charts"><div class="jr-chart"><div class="jr-ct"><b>' + esc(U) + ' by ' + per + '</b><span class="jr-key"><i class="k1"></i>These ' + P + ' days <i class="k0"></i>The ' + P + ' days before</span></div>' + barChart(S.now, S.before || [], 'results', n0, U) + '</div>' +
        '<div class="jr-chart"><div class="jr-ct"><b>Cost per ' + esc(sing(U)) + ' by ' + per + '</b><span class="jr-key"><i class="k1"></i>These ' + P + ' days <i class="k0 dash"></i>Before</span></div>' + lineChart(S.now, S.before || [], n.goal && n.goal.cost_per_result) + '</div></div>';
    }
    h += '<div class="jr-3p">' +
      '<section class="jr-p jr-prog"><h3><span>1</span>Progress</h3><p class="jr-ps">What got better</p>' + (prog.length ? list(prog, 'pg') : '<p class="jr-none">Nothing to report yet.</p>') + '</section>' +
      '<section class="jr-p jr-prob"><h3><span>2</span>Problems</h3><p class="jr-ps">What the data says is not working yet</p>' + (prob.length ? list(prob, 'pb') : '<p class="jr-none">Nothing holding us back right now.</p>') + '</section>' +
      '<section class="jr-p jr-plan"><h3><span>3</span>Plans</h3><p class="jr-ps">What we will do next</p>' + list(plans, 'pl', 1) + '</section></div>';
    var row = function (l, f, a, z) { return '<tr><td>' + l + '</td><td>' + (a != null ? f(a) : 'n/a') + '</td><td>' + (z != null ? f(z) : 'n/a') + '</td></tr>'; };
    if (b.from) h += '<details class="jr-more"' + (opts.openTable ? ' open' : '') + '><summary>All the numbers</summary><table class="jr-t"><thead><tr><th></th><th>The ' + P + ' days before<small>' + dl(b.from) + ' to ' + dl(b.to, 1) + '</small></th><th>These ' + P + ' days<small>' + dl(c.from) + ' to ' + dl(c.to, 1) + '</small></th></tr></thead><tbody>' +
      row('Ad spend', m0, b.spend, c.spend) + row(esc(U), n0, b.results, c.results) + row('Cost per ' + esc(sing(U)), m2, b.cost_per_result, c.cost_per_result) + row('Clicks', n0, b.clicks, c.clicks) + row('Cost per click', m2, b.cpc, c.cpc) +
      (n.value ? row(n.value.now.estimate ? 'Estimated sales' : 'Sales from the ads', m0, n.value.before ? n.value.before.amount : null, n.value.now.amount) : (c.roas || b.roas) ? row('Return on ad spend', function (v) { return v.toFixed(1) + 'x'; }, b.roas, c.roas) : '') + '</tbody></table></details>';
    return h + '</div>';
  }
  window.JR = { report: report };
})();
