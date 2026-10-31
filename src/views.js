/* ===== views ===== */
var S = { view: 'overview', cid: null, type: 'all', scn: 0, met: { o: null, t: null, cd: null }, range: { mode: '30', from: '', to: '' }, page: {}, sort: { keywords: ['spend', -1], terms: ['spend', -1], 'keywords-d': ['spend', -1], 'terms-d': ['spend', -1], themes: ['spend', -1], landing: ['spend', -1] } };
var VIEWS = {
  overview: ['Overview', 'How ad spend turns into results'],
  weekly: ['Week by week', 'Every key number, one week at a time'],
  trends: ['Trends and outlook', 'Where results are heading and what a budget change would do'],
  campaigns: ['Campaigns', 'Select a campaign to see its audiences, videos and ads'],
  audiences: ['Audiences', 'Who responds, and at what price'],
  videos: ['Videos', 'Which video creatives to scale and which to cut'],
  ads: ['Ads and searches', 'Ads, keywords and the searches behind them'],
  insights: ['Insights and actions', 'What the numbers mean and what to do next']
};
var TYPE_LBL = { video: 'Video', search: 'Search', pmax: 'Performance Max', shopping: 'Shopping', display: 'Display', other: 'Other' };
var ICON = {
  overview: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="4" rx="1"/><rect x="3" y="11" width="6" height="4" rx="1"/><rect x="11" y="9" width="6" height="6" rx="1"/>',
  weekly: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
  trends: '<path d="M3 15l4-5 3 3 6-8"/><path d="M12 5h4v4"/>',
  campaigns: '<path d="M4 3v14"/><path d="M4 4h10l-2 3 2 3H4"/>',
  audiences: '<circle cx="8" cy="7" r="3"/><path d="M2.5 16c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5"/><path d="M13 4.5a2.5 2.5 0 010 5M15 12c1.5.6 2.4 1.8 2.7 3.5"/>',
  videos: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M8.5 7.8v4.4l4-2.2z"/>',
  ads: '<path d="M4 3.5h9l3 3V16.5H4z"/><path d="M7 9h6M7 12h6"/>',
  insights: '<path d="M7 14.5h6M8.2 17h3.6"/><path d="M10 2.5a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z"/>'
};
function list() { return C.filter(function (c) { return S.type === 'all' || c.type === S.type; }); }
function ids() { return list().map(function (c) { return c.id; }); }
function camp(id) { return C.filter(function (c) { return c.id === id; })[0]; }
function items(kind) { var L = ids(); return (ITEMS[kind] || []).filter(function (r) { return L.indexOf(r.cid) > -1; }); }
function prevLabel() { return 'previous ' + N + ' day' + (N === 1 ? '' : 's'); }
function panel(title, sub, body) { return '<div class="panel"><div class="ph"><div><h2>' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div></div>' + body + '</div>'; }
function msgPanel(title, text) { return panel(title, '', '<p class="msg">' + esc(text) + '</p>'); }
function unmapped() { return RK === 'leads' && LBL.leads === 'Conversions'; }

/* ---------- KPI cards ---------- */
function KPS() {
  var sl = sing(LBL.leads), sc = sing(LBL.calls), rev = HAS.rev;
  return [
    { k: 'spend', l: 'Spend', v: function (o) { return o.spend; }, f: money, g: 0, s: function (A) { return A.d.spend; } },
    { k: 'rev', l: 'Revenue', v: function (o) { return o.rev; }, f: money, g: 1, s: function (A) { return A.d.rev; } },
    { k: 'roas', l: 'ROAS', v: roasO, f: xf, g: 1, hero: rev, s: function (A) { return A.d.rev ? div(roll7(A.d.rev), roll7(A.d.spend)) : null; } },
    { k: 'leads', l: LBL.leads, v: function (o) { return o.leads; }, f: int, g: 1, s: function (A) { return A.d.leads; } },
    { k: 'cpl', l: 'Cost per ' + sl, v: cplO, f: money2, g: -1, hero: !rev && RK === 'leads', s: function (A) { return A.d.leads ? div(roll7(A.d.spend), roll7(A.d.leads)) : null; } },
    { k: 'calls', l: LBL.calls, v: function (o) { return o.calls; }, f: int, g: 1, s: function (A) { return A.d.calls; } },
    { k: 'cpc', l: 'Cost per ' + sc, v: cpcO, f: money, g: -1, hero: !rev && RK === 'calls', s: function (A) { return A.d.calls ? div(roll7(A.d.spend), roll7(A.d.calls)) : null; } }
  ];
}
function KPS2() {
  var rows = [
    { k: 'impr', l: 'Impressions', v: function (o) { return o.impr; }, f: int, g: 1 },
    { k: 'clicks', l: 'Clicks', v: function (o) { return o.clicks; }, f: int, g: 1 },
    { k: 'ctr', l: 'CTR', v: ctrO, f: pct, g: 1 },
    { k: 'cpclk', l: 'Avg. CPC', v: cpclkO, f: money2, g: -1 }
  ];
  if (!unmapped()) rows.push({ k: 'conv', l: 'Conversions (Google)', v: function (o) { return o.conv; }, f: int, g: 1 }, { k: 'cpv', l: 'Cost per conversion', v: cpvO, f: money2, g: -1 });
  rows.push({ k: 'cvr', l: 'Conversion rate', v: cvrO, f: pct, g: 1 });
  return rows;
}
function spark(a) {
  if (!a || a.length < 2) return '<span class="spark"></span>';
  var w = 84, h = 28, mn = Math.min.apply(null, a), mxv = Math.max.apply(null, a), r = (mxv - mn) || 1, p = '';
  a.forEach(function (v, i) { p += (i ? 'L' : 'M') + (i * w / (a.length - 1)).toFixed(1) + ' ' + (h - 3 - (v - mn) / r * (h - 8)).toFixed(1); });
  var ly = h - 3 - (a[a.length - 1] - mn) / r * (h - 8);
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><path d="' + p + '" fill="none" stroke="var(--c1)" stroke-width="2"/><circle cx="' + (w - 2) + '" cy="' + ly.toFixed(1) + '" r="3" fill="var(--c3)"/></svg>';
}
function kpiCards(A, defs, keys, small) {
  return '<div class="kpis' + (small ? ' sm' : '') + '">' + defs.filter(function (k) { return !keys || keys.indexOf(k.k) > -1; }).map(function (k) {
    var cu = k.v(A.cur);
    if (cu == null && (k.k === 'rev' || k.k === 'roas' || k.k === 'leads' || k.k === 'cpl' || k.k === 'calls' || k.k === 'cpc')) {
      var has = { rev: HAS.rev, roas: HAS.rev, leads: HAS.leads, cpl: HAS.leads, calls: HAS.calls, cpc: HAS.calls }[k.k];
      if (!has) return '';
    }
    if (cu == null) return '<div class="kpi"><div class="l">' + k.l + '</div><div class="row"><div class="v na">n/a</div>' + spark(null) + '</div><div class="dl">No results in this range</div></div>';
    var pr = k.v(A.pri), hasP = pr != null && pr !== 0, ch = hasP ? (cu - pr) / pr : 0, cls = k.g === 0 ? 'flat' : ((ch * k.g) >= 0 ? 'good' : 'bad');
    return '<div class="kpi' + (k.hero ? ' hero' : '') + '"><div class="l">' + k.l + '</div><div class="row"><div class="v">' + k.f(cu) + '</div>' + (k.s ? spark(k.s(A)) : '') + '</div>' +
      '<div class="dl">' + (hasP ? '<span class="delta ' + cls + '">' + (ch >= 0 ? '+' : '') + (ch * 100).toFixed(1) + '%</span> vs ' + prevLabel() : 'No previous period to compare') + '</div></div>';
  }).join('') + '</div>';
}
function chartCard(id, title, sub, A) {
  var av = availMets(A); if (av.indexOf(S.met[id]) < 0) S.met[id] = defaultMet(av);
  var tabs = av.map(function (k) { return '<button data-met="' + id + ':' + k + '" class="' + (S.met[id] === k ? 'on' : '') + '">' + MET[k].l + '</button>'; }).join('');
  return '<div class="panel"><div class="ph"><div><h2>' + title + '</h2><p class="sub">' + sub + '</p></div><div class="seg" style="flex-wrap:wrap">' + tabs + '</div></div><div class="chart" id="ch-' + id + '"></div></div>';
}
function defaultMet(av) { var want = HAS.rev ? 'rev' : (RK === 'calls' ? 'cpc' : 'cpl'); return av.indexOf(want) > -1 ? want : av[0]; }
var charts = [];
function paintCharts() { charts.forEach(function (c) { drawChart(document.getElementById('ch-' + c.id), c.A.d, S.scn, S.met[c.id]); }); }

/* ---------- tables ---------- */
function vOf(c, r) { return c.v(r); }
var TERM_PAGE = 8, AD_PAGE = 10;
function tbl(id, cols, rows, rowAttr, pageSize) {
  var st = S.sort[id] || ['verdict', -1];
  var c = cols.filter(function (x) { return x.k === st[0]; })[0];
  if (!c) { st = ['spend', -1]; c = cols.filter(function (x) { return x.k === 'spend'; })[0]; }
  if (c) rows = rows.slice().sort(function (a, b) { var x = vOf(c, a), y = vOf(c, b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * st[1]; });
  var total = rows.length, pg = 0, pages = 1;
  if (pageSize && total > pageSize) { pages = Math.ceil(total / pageSize); pg = Math.min(S.page[id] || 0, pages - 1); S.page[id] = pg; rows = rows.slice(pg * pageSize, (pg + 1) * pageSize); }
  var pager = pages > 1 ? '<div class="pager"><span>Showing ' + (pg * pageSize + 1) + ' to ' + (pg * pageSize + rows.length) + ' of ' + total + '</span><div><button type="button" data-page="' + id + ':-1"' + (pg === 0 ? ' disabled' : '') + '>&lsaquo; Previous</button><span class="pn">Page ' + (pg + 1) + ' of ' + pages + '</span><button type="button" data-page="' + id + ':1"' + (pg >= pages - 1 ? ' disabled' : '') + '>Next &rsaquo;</button></div></div>' : '';
  return '<div class="tw"><table class="t"><thead><tr>' + cols.map(function (c2) {
    var on = st[0] === c2.k; return '<th class="' + (c2.n ? 'n' : '') + '" aria-sort="' + (on ? (st[1] > 0 ? 'ascending' : 'descending') : 'none') + '"><button data-sort="' + id + ':' + c2.k + '">' + c2.l + (on ? (st[1] > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
  }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
    return '<tr' + (rowAttr ? rowAttr(r) : '') + '>' + cols.map(function (c2) { return '<td class="' + (c2.n ? 'n ' : '') + (c2.nm ? 'nm ' : '') + (c2.c ? c2.c(r) : '') + '">' + c2.f(r) + '</td>'; }).join('') + '</tr>';
  }).join('') + '</tbody></table></div>' + pager;
}
function col(k, l, f, v, opts) { return Object.assign({ k: k, l: l, n: 1, v: v, f: f }, opts || {}); }
function outCols() {
  var o = [], sl = sing(LBL.leads), sc = sing(LBL.calls);
  o.push(col('spend', 'Spend', function (r) { return money(r.spend); }, function (r) { return r.spend; }));
  if (HAS.leads) {
    o.push(col('leads', LBL.leads, function (r) { return int(r.leads); }, function (r) { return r.leads; }));
    o.push(col('cpl', 'Cost per ' + sl, function (r) { var v = cplO(r); return v == null ? NA() : money2(v); }, cplO, { c: function (r) { return RK === 'leads' ? costC(cplO(r)) : ''; } }));
  }
  if (HAS.calls) {
    o.push(col('calls', LBL.calls, function (r) { return int(r.calls); }, function (r) { return r.calls; }));
    o.push(col('cpc', 'Cost per ' + sc, function (r) { var v = cpcO(r); return v == null ? NA() : money(v); }, cpcO, { c: function (r) { return RK === 'calls' ? costC(cpcO(r)) : ''; } }));
  }
  if (HAS.deals && !HAS.rev) o.push(col('deals', LBL.deals, function (r) { return int(r.deals); }, function (r) { return r.deals; }));
  if (HAS.rev) {
    o.push(col('rev', 'Revenue', function (r) { return money(r.rev); }, function (r) { return r.rev; }));
    o.push(col('roas', 'ROAS', function (r) { var v = roasO(r); return v == null ? NA() : xf(v); }, roasO, { c: function (r) { return r.spend < thrItem() ? 'mut' : roasC(roasO(r)); } }));
  }
  return o;
}
function trafficCols() {
  return [
    col('clicks', 'Clicks', function (r) { return int(r.clicks); }, function (r) { return r.clicks; }),
    col('ctr', 'CTR', function (r) { var v = ctrO(r); return v == null ? NA() : pct(v); }, ctrO),
    col('cpclk', 'Avg. CPC', function (r) { var v = cpclkO(r); return v == null ? NA() : money2(v); }, cpclkO)
  ];
}
function verdictCol(kind, thr) {
  return [{ k: 'verdict', l: kind === 'camp' ? 'Status' : 'Verdict', v: function (r) { return HAS.rev ? roasO(r) : (r[RK] ? -r.spend / r[RK] : -1e9); }, f: function (r) { return pill(r, kind, thr); } }];
}
function campTable(rows) {
  var cols = [{ k: 'name', l: 'Campaign', nm: 1, v: function (r) { return r.name; }, f: function (r) { return '<b>' + esc(r.name) + '</b><br><span class="tag">' + (TYPE_LBL[r.type] || 'Other') + '</span>'; } }].concat(verdictCol('camp', thrCamp()), outCols(), trafficCols());
  rows = rows.map(function (c) { return Object.assign({}, c.cur, { id: c.id, name: c.name, type: c.type }); });
  return tbl('campaigns', cols, rows, function (r) { return ' data-camp="' + esc(r.id) + '" tabindex="0"'; });
}
function audTable(rows, showCamp) {
  var cols = [{ k: 'name', l: 'Audience', nm: 1, v: function (r) { return r.name; }, f: function (r) { return '<b>' + esc(r.name) + '</b>' + (r.detail ? '<br><span class="tag">' + esc(r.detail) + '</span>' : ''); } }];
  if (showCamp) cols.push({ k: 'camp', l: 'Campaign', v: function (r) { return r.camp; }, f: function (r) { return esc(r.camp); } });
  return tbl('audiences', cols.concat(outCols(), verdictCol('item', thrItem())), rows);
}
function thumb(r) {
  var img = r.vid && /^[A-Za-z0-9_-]{5,20}$/.test(r.vid) ? 'url(https://i.ytimg.com/vi/' + r.vid + '/mqdefault.jpg) center/cover no-repeat,' : '';
  return '<button type="button" class="thumb" data-vi="' + r.i + '" aria-label="Watch video: ' + esc(r.name) + '"><span class="th" style="background:' + img + 'linear-gradient(135deg,hsl(' + r.hue + ' 45% 32%),hsl(' + ((r.hue + 40) % 360) + ' 50% 20%))"><svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>' + (r.dur ? '<em>' + esc(r.dur) + '</em>' : '') + '</span><span class="tt"><b>' + esc(r.name) + '</b><small>Watch video</small></span></button>';
}
function vidTable(rows, showCamp) {
  var cols = [{ k: 'name', l: 'Video', nm: 1, c: function () { return 'vid'; }, v: function (r) { return r.name; }, f: thumb }];
  if (showCamp) cols.push({ k: 'camp', l: 'Campaign', v: function (r) { return r.camp; }, f: function (r) { return esc(r.camp); } });
  cols.push(col('views', 'Views', function (r) { return int(r.views); }, function (r) { return r.views; }),
    col('vr', 'View rate', function (r) { return r.impr ? pct(r.views / r.impr) : NA(); }, function (r) { return r.impr ? r.views / r.impr : null; }),
    col('cpv', 'Cost per view', function (r) { return r.views ? '$' + (r.spend / r.views).toFixed(3) : NA(); }, function (r) { return r.views ? r.spend / r.views : null; }));
  return tbl('videos', cols.concat(outCols(), verdictCol('item', thrItem())), rows);
}
function adTable(rows, showCamp) {
  var cols = [{ k: 'name', l: 'Ad', nm: 1, v: function (r) { return r.h1; }, f: function (r) {
    var inner = '<b>' + esc(r.h1) + '</b><small>' + esc(r.h2) + '</small>';
    return r.url && /^https?:\/\//i.test(r.url) ? '<button type="button" class="ad adbtn" data-ai="' + r.i + '" aria-label="View landing page for ad: ' + esc(r.h1) + '">' + inner + '<em>View landing page</em></button>' : '<div class="ad">' + inner + '</div>';
  } }];
  if (showCamp) cols.push({ k: 'camp', l: 'Campaign', v: function (r) { return r.camp; }, f: function (r) { return esc(r.camp); } });
  return tbl('ads', cols.concat(outCols(), trafficCols(), verdictCol('item', thrItem())), rows, null, AD_PAGE);
}
function termTable(id, label, rows) {
  var cols = [{ k: 'name', l: label, nm: 1, v: function (r) { return r.name; }, f: function (r) { return '<b>' + esc(r.name) + '</b>' + (r.detail ? '<br><span class="tag">' + esc(r.detail) + '</span>' : ''); } }];
  cols.push({ k: 'camp', l: 'Campaign', v: function (r) { return r.camp; }, f: function (r) { return esc(r.camp); } });
  var st = S.sort[id] || ['spend', -1];
  return tbl(id, cols.concat(outCols(), trafficCols(), verdictCol('item', thrItem())), rows, null, TERM_PAGE);
}

/* ---------- panels ---------- */
function splitPanel(L) {
  var G = [['scale', 'Earns money', 'good', 'Scale'], ['hold', 'Breaks even', 'warn', 'Hold'], ['fix', 'Loses money', 'bad', 'Fix or pause'], ['nodata', 'Needs outcome data', 'early', 'Track results']];
  if (!HAS.rev) { G[0][1] = 'Performing well'; G[1][1] = 'Acceptable'; G[2][1] = 'Needs work'; }
  var thr = thrCamp();
  var body = G.map(function (g) {
    var rows = L.filter(function (c) { var s = stat(c.cur, thr); return g[0] === 'hold' ? (s === 'hold' || s === 'early') : s === g[0]; });
    if (!rows.length) return '';
    return '<div class="group"><div class="gh ' + g[2] + '">' + g[1] + '<span>' + g[3] + ' (' + rows.length + ') · ' + money(sum(rows.map(function (c) { return c.cur.spend; }))) + ' spend</span></div>' +
      rows.map(function (c) {
        var mt = HAS.rev ? 'ROAS ' + xf(roasO(c.cur) || 0) : (c.cur[RK] ? money(c.cur.spend / c.cur[RK]) + ' per ' + sing(rlab()) : 'No ' + rlab().toLowerCase());
        return '<button class="gr" data-camp="' + esc(c.id) + '"><span class="nm">' + esc(c.name) + '</span><span class="mt">' + mt + ' · ' + money(c.cur.spend) + ' ›</span></button>';
      }).join('') + '</div>';
  }).join('');
  var t = target();
  var sub = HAS.rev ? 'Grouped by ROAS against a ' + T.be + 'x break-even and ' + T.roas + 'x target' : t ? 'Grouped by cost per ' + sing(rlab()) + ' against ' + ((RK === 'calls' ? T.cpc : T.cpl) ? 'your ' + money(t) + ' target' : 'the account average of ' + money(t)) : 'Add conversion tracking to group campaigns by results';
  return panel('Campaign split', sub, body || '<p class="msg">No campaigns with spend in this range.</p>');
}
function actionsPanel(maxN) {
  var D = computeInsights(), acts = D.actions.slice(0, maxN || 5);
  var li = acts.map(function (a, i) { return '<li><span class="n">' + (i + 1) + '</span><div><div class="t">' + esc(a.title) + ' <span class="pill ' + ({ High: 'bad', Medium: 'warn', Low: 'early' }[a.priority] || 'early') + '">' + esc(a.priority) + '</span></div><div class="d">' + esc(a.body) + '</div></div></li>'; }).join('');
  var clock = '';
  if (META.last_change_date) {
    var ld = Date.parse(META.last_change_date + 'T00:00:00Z');
    if (isFinite(ld)) {
      var day = Math.max(0, Math.min(14, Math.floor((Date.now() - ld) / DAY))), cir = 2 * Math.PI * 30;
      clock = '<div class="clock"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="36" cy="36" r="30" fill="none" stroke="var(--c3)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (cir * day / 14).toFixed(1) + ' ' + cir.toFixed(1) + '" transform="rotate(-90 36 36)"/></svg><div><b>Day ' + day + ' of 14</b><span>One change, then 14 days before the next.</span></div></div>';
    }
  }
  return panel('What we recommend next', 'The highest-impact steps first. <a href="#insights" class="lnk" data-go="insights">See all insights and actions</a>', '<ol class="steps">' + (li || '<li><div class="d">No actions yet. More data is needed.</div></li>') + '</ol>' + clock);
}
function insightCard(i, withTone) {
  return '<article class="ins ' + (i.tone || 'neutral') + '"><h3>' + esc(i.title) + '</h3><p>' + esc(i.body) + '</p></article>';
}

/* ---------- views ---------- */
function vOverview() {
  var L = list(), A = agg(L); charts = [{ id: 'o', A: A }];
  var D = computeInsights();
  return kpiCards(A, KPS()) + kpiCards(A, KPS2(), null, true) +
    chartCard('o', 'Spend, results and ' + (horizon() ? horizon() + '-day ' : '') + 'outlook', horizon() ? 'Solid line is what happened. Dashed line is where it is heading at the current pace.' : 'Daily trend for the selected range. Pick 14 days or more to see a projection.', A) +
    panel('Key insights', 'The short version. <a href="#insights" class="lnk" data-go="insights">Read all of it</a>', '<div class="inslist">' + D.insights.slice(0, 3).map(insightCard).join('') + '</div>') +
    '<div class="two">' + splitPanel(L) + actionsPanel(4) + '</div>';
}
function weeklyTable(A, Wk) {
  var sc = sing(LBL.calls), sl = sing(LBL.leads);
  var cols = [
    { k: 'label', l: 'Week', f: function (w) { return '<b>' + esc(w.label) + '</b>' + (w.partial ? ' <span class="tag">partial</span>' : ''); } },
    { k: 'spend', l: 'Cost', n: 1, f: function (w) { return money(w.spend); } },
    { k: 'ctr', l: 'CTR', n: 1, f: function (w) { return w.impr ? pct(w.clicks / w.impr) : NA(); } },
    { k: 'cpclk', l: 'CPC', n: 1, f: function (w) { return w.clicks ? money2(w.spend / w.clicks) : NA(); } },
    { k: 'conv', l: 'Conversions', n: 1, f: function (w) { return int(w.conv); } },
    { k: 'cpv', l: 'Cost / conversion', n: 1, f: function (w) { return w.conv ? money2(w.spend / w.conv) : NA(); } },
    { k: 'cvr', l: 'Conv. rate', n: 1, f: function (w) { return w.clicks ? pct(w.conv / w.clicks) : NA(); } }
  ];
  if (HAS.leads && !unmapped()) cols.push({ k: 'leads', l: LBL.leads, n: 1, f: function (w) { return int(w.leads); } }, { k: 'cpl', l: 'Cost / ' + sl, n: 1, f: function (w) { return w.leads ? money(w.spend / w.leads) : NA(); }, rk: 'leads' });
  if (HAS.calls) cols.push({ k: 'calls', l: LBL.calls, n: 1, f: function (w) { return int(w.calls); } }, { k: 'cpc', l: 'Cost / ' + sc, n: 1, f: function (w) { return w.calls ? money(w.spend / w.calls) : NA(); }, rk: 'calls' });
  if (HAS.rev) cols.push({ k: 'rev', l: 'Revenue', n: 1, f: function (w) { return money(w.rev); } }, { k: 'roas', l: 'ROAS', n: 1, f: function (w) { return w.spend ? xf(w.rev / w.spend) : NA(); } });
  var full = Wk.filter(function (w) { return w.days === 7 && w[RK] > 0; });
  var bestW = full.length > 2 ? full.slice().sort(function (a, b) { return a.spend / a[RK] - b.spend / b[RK]; })[0] : null;
  var worstW = full.length > 2 ? full.slice().sort(function (a, b) { return b.spend / b[RK] - a.spend / a[RK]; })[0] : null;
  var tot = { label: 'Total', days: 99, partial: false };
  KEYS.forEach(function (k) { tot[k] = A.cur[k]; });
  var head = '<thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '"><button style="cursor:default">' + c.l + '</button></th>'; }).join('') + '</tr></thead>';
  function row(w, isTot) {
    return '<tr' + (isTot ? ' class="tot"' : '') + '>' + cols.map(function (c) {
      var cls = (c.n ? 'n ' : '') + (!isTot && c.rk === RK ? (w === bestW ? 'good' : w === worstW ? 'bad' : '') : '');
      return '<td class="' + cls + '">' + (isTot && c.k === 'label' ? '<b>Total</b>' : c.f(w)) + '</td>';
    }).join('') + '</tr>';
  }
  return '<div class="tw"><table class="t">' + head + '<tbody>' + Wk.map(function (w) { return row(w, false); }).join('') + row(tot, true) + '</tbody></table></div>';
}
function dowTable(A) {
  var NM = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], rows = NM.map(function (n) { return { name: n, spend: 0, clicks: 0, conv: 0, r: 0 }; }), i;
  var rk = A.d[RK] || A.d.conv;
  for (i = 0; i < N; i++) { var wd = (new Date(START + i * DAY).getUTCDay() + 6) % 7; rows[wd].spend += A.d.spend[i]; rows[wd].clicks += A.d.clicks[i]; rows[wd].conv += A.d.conv[i]; rows[wd].r += rk[i]; }
  var q = rows.filter(function (r) { return r.r >= 3; }), best = null, worst = null;
  if (q.length >= 4) { q.sort(function (a, b) { return a.spend / a.r - b.spend / b.r; }); best = q[0]; worst = q[q.length - 1]; }
  return '<div class="tw"><table class="t"><thead><tr><th><button style="cursor:default">Day</button></th><th class="n"><button style="cursor:default">Cost</button></th><th class="n"><button style="cursor:default">Clicks</button></th><th class="n"><button style="cursor:default">' + esc(rlab()) + '</button></th><th class="n"><button style="cursor:default">Cost / ' + esc(sing(rlab())) + '</button></th></tr></thead><tbody>' +
    rows.map(function (r) { var c = r.r ? r.spend / r.r : null; return '<tr><td><b>' + r.name + '</b></td><td class="n">' + money(r.spend) + '</td><td class="n">' + int(r.clicks) + '</td><td class="n">' + int(r.r) + '</td><td class="n ' + (r === best ? 'good' : r === worst ? 'bad' : '') + '">' + (c == null ? NA() : money(c)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
}
function vWeekly() {
  var A = agg(list()), Wk = weeks(A);
  return panel('Week by week', 'Weeks start on Monday. ' + (HAS.calls || HAS.leads ? 'Green marks the best full week and red the weakest by cost per ' + sing(rlab()) + '.' : ''), weeklyTable(A, Wk)) +
    '<div class="two">' + panel(rlab() + ' per week', 'Faded bars are partial weeks', '<div class="chart" id="ch-wk1"></div>') + panel('Cost per ' + sing(rlab()), 'Dashed line is the average for the range. Hollow dots are partial weeks.', '<div class="chart" id="ch-wk2"></div>') + '</div>' +
    '<div class="two">' + panel('By day of week', 'Which days are cheapest for results', dowTable(A)) + panel('Spend by hour', 'Account time. Hover for clicks and results.', '<div class="chart" id="ch-hr"></div>') + '</div>';
}
function projTable(A) {
  var f = forecast(A.d, S.scn), c = A.cur, rows = [], H = horizon();
  if (!H) return '<p class="msg">Pick a range of 14 days or more to see a projection.</p>';
  var ps = sum(f.spend);
  function p(k) { return f[k] ? sum(f[k]) : null; }
  rows.push(['Spend', money(c.spend), money(ps), ps / (c.spend * H / N) - 1, 0]);
  var scl = H / N;
  if (f.leads && c.leads) { rows.push([LBL.leads, int(c.leads), int(p('leads')), p('leads') / (c.leads * scl) - 1, 1]); rows.push(['Cost per ' + sing(LBL.leads), money2(c.spend / c.leads), money2(ps / p('leads')), (ps / p('leads')) / (c.spend / c.leads) - 1, -1]); }
  if (f.calls && c.calls) { rows.push([LBL.calls, int(c.calls), int(p('calls')), p('calls') / (c.calls * scl) - 1, 1]); rows.push(['Cost per ' + sing(LBL.calls), money(c.spend / c.calls), money(ps / p('calls')), (ps / p('calls')) / (c.spend / c.calls) - 1, -1]); }
  if (f.rev && c.rev) { rows.push(['Revenue', money(c.rev), money(p('rev')), p('rev') / (c.rev * scl) - 1, 1]); rows.push(['ROAS', xf(c.rev / c.spend), xf(p('rev') / ps), (p('rev') / ps) / (c.rev / c.spend) - 1, 1]); }
  var h = function (t, n) { return '<th' + (n ? ' class="n"' : '') + '><button style="cursor:default">' + t + '</button></th>'; };
  return '<div class="tw"><table class="t"><thead><tr>' + h('Metric') + h('Last ' + N + ' days', 1) + h('Next ' + H + ' days', 1) + h('Change', 1) + '</tr></thead><tbody>' +
    rows.map(function (r) { var cls = r[4] === 0 ? 'mut' : (r[3] * r[4] >= 0 ? 'good' : 'bad'); return '<tr><td><b>' + r[0] + '</b></td><td class="n">' + r[1] + '</td><td class="n">' + r[2] + '</td><td class="n ' + cls + '">' + (r[3] >= 0 ? '+' : '') + (r[3] * 100).toFixed(1) + '%</td></tr>'; }).join('') + '</tbody></table></div>';
}
function scnText() { var s = S.scn; return s === 0 ? 'Current pace' : (s > 0 ? '+' : '') + Math.round(s * 100) + '% spend'; }
function scnNote() {
  var A = agg(list()), f = forecast(A.d, S.scn), b = forecast(A.d, 0), el = document.getElementById('scnnote'); if (!el) return;
  if (!horizon()) { el.textContent = ''; return; }
  if (S.scn === 0) { el.textContent = 'Showing the current pace. Move the slider to test a budget change.'; return; }
  var t = [];
  if (f.rev && b.rev) t.push('projected ROAS moves from ' + xf(sum(b.rev) / sum(b.spend)) + ' to ' + xf(sum(f.rev) / sum(f.spend)));
  if (f.leads && b.leads) t.push(LBL.leads.toLowerCase() + ' move from ' + int(sum(b.leads)) + ' to ' + int(sum(f.leads)));
  if (f.calls && b.calls) t.push(LBL.calls.toLowerCase() + ' move from ' + int(sum(b.calls)) + ' to ' + int(sum(f.calls)));
  el.textContent = (t.length ? t.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + '. ' : '') + 'The model assumes each extra dollar returns about 80% as much as the last.';
}
function vTrends() {
  var A = agg(list()); charts = [{ id: 't', A: A }];
  if (!horizon()) return msgPanel('Trends and outlook', 'The outlook needs a range of 14 days or more. Pick 30 or 90 days above.');
  return '<div class="panel"><div class="scn"><label for="scn">If monthly spend changes by</label><input type="range" id="scn" min="-30" max="50" step="10" value="' + Math.round(S.scn * 100) + '"><output id="scnout" for="scn">' + scnText() + '</output></div><p class="note" id="scnnote"></p></div>' +
    chartCard('t', 'Trend and projection', 'Projection uses the last 14 days plus the slope across the range. Extra spend returns less than the spend before it.', A) +
    panel('Next ' + horizon() + ' days', null, '<div id="proj">' + projTable(A) + '</div>');
}
function vCampaigns() {
  var sub = 'Selected range';
  if (HAS.rev) sub += ' · colors compare each metric to your targets: ROAS ' + T.roas + 'x';
  else if (target()) sub += ' · colors compare cost per ' + sing(rlab()) + ' with ' + ((RK === 'calls' ? T.cpc : T.cpl) ? 'your ' + money(target()) + ' target' : 'the account average of ' + money(target()));
  return panel('All campaigns', sub, list().length ? campTable(list()) : '<p class="msg">No campaigns in this view.</p>');
}
function bars(data) {
  var d = data.filter(function (x) { return x[RK] > 0; }).map(function (x) { return [x.name, x.spend / x[RK]]; }).sort(function (a, b) { return a[1] - b[1]; });
  if (!d.length) return '<p class="msg">Not available yet.</p>';
  var t = target(), max = Math.max.apply(null, d.map(function (x) { return x[1]; }).concat(t ? [t] : [])) * 1.1;
  return '<div class="bars">' + d.map(function (x) {
    var cl = costC(x[1]) || 'good';
    return '<div class="bar"><span>' + esc(x[0]) + '</span><div class="tr"><div class="fl" style="width:' + (x[1] / max * 100) + '%;background:var(--' + cl + ')"></div>' + (t ? '<div class="tg" style="left:' + (t / max * 100) + '%"></div>' : '') + '</div><b>$' + Math.round(x[1]) + '</b></div>';
  }).join('') + '</div>';
}
function vAudiences() {
  var rows = items('audiences'), out = '';
  out += rows.length ? panel('Audience segments', 'Selected range', audTable(rows, true)) : panel('Audience segments', 'Selected range', '<p class="msg">No audience data for this view. Audience results appear for campaigns that report on audiences.</p>');
  var L = ids(), t = target();
  var sub = 'Selected campaigns. ' + (t ? 'Line marks ' + ((RK === 'calls' ? T.cpc : T.cpl) ? 'your ' + money(t) + ' target.' : 'the account average of ' + money(t) + '.') : '');
  var age = groupBy('age', L), gen = groupBy('gender', L), dev = groupBy('device', L);
  var cn = 'Cost per ' + sing(rlab());
  if (age.length || gen.length || dev.length) out += '<div class="two">' + panel(cn + ' by age', sub, bars(age)) + panel(cn + ' by gender', sub, bars(gen)) + '</div>' + panel(cn + ' by device', sub, bars(dev));
  return out;
}
function vVideos() {
  var rows = items('videos');
  return panel('Video creatives', 'Selected range · scale the best, cut the worst', rows.length ? vidTable(rows, true) : '<p class="msg">No per-video results for this view. Google reports per-video results for YouTube and Demand Gen video ads. Performance Max does not break results out by video.</p>');
}
function vAds() {
  var ads = items('ads'), kw = items('keywords'), tm = items('terms'), out = '';
  out += panel('Ads', 'Selected range', ads.length ? adTable(ads, true) : '<p class="msg">No ads in this view.</p>');
  // Summaries first (themes, landing pages), then the long lists, 15 rows at a time.
  if (tm.length && TERMG.length) {
    var gs = TERMG.map(function (g) { return { name: g[0], re: g[1], detail: '', camp: '', cid: '', spend: 0, impr: 0, clicks: 0, views: 0, conv: 0, leads: 0, calls: 0, deals: 0, rev: 0 }; }), oth = { name: 'Everything else', detail: '', camp: '', cid: '', spend: 0, impr: 0, clicks: 0, views: 0, conv: 0, leads: 0, calls: 0, deals: 0, rev: 0 };
    tm.forEach(function (t) { var g = gs.filter(function (x) { return x.re.test(t.name); })[0] || oth; KEYS.forEach(function (k) { g[k] += t[k]; }); });
    var gr = gs.concat([oth]).filter(function (g) { return g.spend > 0; });
    var cols = [{ k: 'name', l: 'Search theme', nm: 1, v: function (r) { return r.name; }, f: function (r) { return '<b>' + esc(r.name) + '</b>'; } }].concat(outCols(), trafficCols());
    out += panel('Search terms by theme', 'Groups of related searches from the search terms below', tbl('themes', cols, gr));
  }
  var lp = groupBy('landing', ids());
  if (lp.length) {
    var lcols = [{ k: 'name', l: 'Landing page', nm: 1, v: function (r) { return r.name; }, f: function (r) { return '<b>' + esc(r.name) + '</b>'; } }].concat(outCols(), trafficCols());
    out += panel('Landing pages', 'Where clicks land', tbl('landing', lcols, lp));
  }
  if (kw.length) out += panel('Keywords', 'Top keywords by spend', termTable('keywords', 'Keyword', kw));
  if (tm.length) out += panel('Search terms', 'The searches that triggered your ads, highest spend first. Google hides low-volume terms, so this is only part of Search spend.', termTable('terms', 'Search term', tm));
  return out;
}
var GROUPS = [
  ['perf', 'Performance and trends', 'How results are moving'],
  ['camp', 'Campaigns and budget', 'Where the money works hardest'],
  ['search', 'Searches and keywords', 'What people type and what it costs'],
  ['aud', 'Who responds best', 'Age, gender and device']
];
function vInsights() {
  var D = computeInsights(), out = '';
  out += panel('Wins', 'Good news in the selected range', D.wins.length ? '<div class="inslist wins">' + D.wins.map(function (w) { return '<article class="ins good win"><h3>' + esc(w.title) + '</h3><p>' + esc(w.body) + '</p></article>'; }).join('') + '</div>' : '<p class="msg">No standout wins in this range yet. See the recommended actions below.</p>');
  if (D.team.length) out += panel('From your Video Power Marketing team', '', '<div class="inslist">' + D.team.map(function (n) { return insightCard({ tone: 'team', title: n.title, body: n.body }); }).join('') + '</div>');
  out += panel('Recommended actions', 'In priority order. Each one is meant to lower cost per ' + sing(rlab()) + ' or add volume without wasting spend.',
    '<ol class="steps big">' + D.actions.map(function (a, i) { return '<li><span class="n">' + (i + 1) + '</span><div><div class="t">' + esc(a.title) + ' <span class="pill ' + ({ High: 'bad', Medium: 'warn', Low: 'early' }[a.priority] || 'early') + '">' + esc(a.priority) + '</span></div><div class="d">' + esc(a.body) + '</div></div></li>'; }).join('') + '</ol>');
  var gp = GROUPS.map(function (g) {
    var rows = D.insights.filter(function (i) { return (i.g || 'perf') === g[0]; });
    return rows.length ? panel(g[1], g[2], '<div class="inslist">' + rows.map(insightCard).join('') + '</div>') : '';
  }).filter(Boolean);
  if (gp.length) out += '<div class="masonry">' + gp.join('') + '</div>';
  if (D.notes.length) out += '<details class="panel fold"><summary>Also worth knowing <span>(' + D.notes.length + ')</span></summary><div class="inslist">' + D.notes.map(function (n) { return insightCard({ tone: 'neutral', title: n.title, body: n.body }); }).join('') + '</div></details>';
  return out;
}
function vDetail() {
  var c = camp(S.cid);
  if (!c) return '<div class="panel"><p class="msg">Campaign not found.</p></div>';
  var A = agg([c]); charts = [{ id: 'cd', A: A }];
  var out = '<button class="back" data-go="campaigns">‹ All campaigns</button><div class="panel"><div class="ph"><div><h2>' + esc(c.name) + '</h2><p class="sub">' + (TYPE_LBL[c.type] || 'Other') + ' campaign' + (c.budget ? ' · budget ' + money(c.budget) + ' a day' : '') + (c.is != null ? ' · wins ' + pct0(c.is) + ' of eligible searches (' + pct0(c.lostB || 0) + ' lost to budget, ' + pct0(c.lostR || 0) + ' to ad rank)' : '') + '</p></div>' + pill(c.cur, 'camp', thrCamp()) + '</div></div>' +
    kpiCards(A, KPS()) + kpiCards(A, KPS2(), null, true) + chartCard('cd', 'Campaign trend and outlook', 'Same view as the overview, for this campaign only.', A);
  function mine(k) { return (ITEMS[k] || []).filter(function (r) { return r.cid === c.id; }); }
  var au = mine('audiences'), vi = mine('videos'), ad = mine('ads'), kw = mine('keywords'), tm = mine('terms');
  if (au.length) out += panel('Audiences', 'Who this campaign reached', audTable(au, false));
  if (vi.length) out += panel('Videos', 'Creative inside this campaign', vidTable(vi, false));
  if (ad.length) out += panel('Ads', 'Ads inside this campaign', adTable(ad, false));
  if (kw.length) out += panel('Keywords', 'Top keywords by spend', termTable('keywords-d', 'Keyword', kw));
  if (tm.length) out += panel('Search terms', 'Highest-spend searches', termTable('terms-d', 'Search term', tm));
  return out;
}
