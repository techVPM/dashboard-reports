/* ===== Google and Meta: each platform's results on their own, side by side =====
   Google and Meta count results in different ways (different attribution windows, different
   definitions), so their results are never added together. Spend can be totaled, results cannot. */
var MP = null;                 // Meta data from the report, or null
var PLAT_VIEW = ['Google and Meta', 'Each platform\'s results, side by side'];
S.plat = 'both';
ICON.platforms = '<rect x="2.5" y="4" width="6.5" height="12" rx="1.5"/><rect x="11" y="4" width="6.5" height="12" rx="1.5"/>';

// Called with the raw report before the first render: adds or removes the tab.
function setPlatforms(P) {
  var m = P && P.platforms && P.platforms.meta;
  MP = m && (m.daily || m.error) ? m : null;
  // A Meta error is for the team. Clients only see the tab when there is Meta data to show.
  var show = MP && (MP.daily || S.team);
  var next = {};
  Object.keys(VIEWS).forEach(function (k) { if (k === 'platforms') return; next[k] = VIEWS[k]; if (k === 'overview' && show) next.platforms = PLAT_VIEW; });
  Object.keys(VIEWS).forEach(function (k) { delete VIEWS[k]; });
  Object.keys(next).forEach(function (k) { VIEWS[k] = next[k]; });
  if (!show && S.view === 'platforms') S.view = 'overview';
}

/* ---------- Meta totals for the selected range and the range before ---------- */
function metaAgg() {
  if (!MP || !MP.daily) return null;
  var from = (META.range && META.range.from) || iso(START), pf = (META.previous && META.previous.from) || '';
  var z = function () { return { spend: 0, impr: 0, clicks: 0, res: 0, rev: 0, plays: 0 }; };
  var cur = z(), pri = z(), byDay = {}, byCamp = {};
  MP.daily.forEach(function (d) {
    var o = d.date >= from ? cur : d.date >= pf ? pri : null; if (!o) return;
    o.spend += d.spend; o.impr += d.impressions; o.clicks += d.clicks; o.res += d.results; o.rev += d.revenue || 0; o.plays += d.thruplays || 0;
    if (o === cur) {
      var b = byDay[d.date] || (byDay[d.date] = { spend: 0, res: 0 }); b.spend += d.spend; b.res += d.results;
      var c = byCamp[d.campaign_id] || (byCamp[d.campaign_id] = z()); c.spend += d.spend; c.impr += d.impressions; c.clicks += d.clicks; c.res += d.results; c.plays += d.thruplays || 0;
    }
  });
  var days = [], i; for (i = 0; i < N; i++) { var k = iso(START + i * DAY); days.push(byDay[k] || { spend: 0, res: 0 }); }
  cur.reach = MP.reach ? MP.reach.now : 0; pri.reach = MP.reach ? MP.reach.prev : 0;
  cur.freq = MP.reach ? MP.reach.frequency : 0; pri.freq = MP.reach ? MP.reach.prev_frequency : 0;
  return { cur: cur, pri: pri, days: days, camps: byCamp };
}
function googleAgg() {
  var A = agg(list()), rk = A.d[RK] || A.d.conv, days = [], i;
  for (i = 0; i < N; i++) days.push({ spend: A.d.spend[i], res: rk[i] });
  var f = function (o) { return { spend: o.spend, impr: o.impr, clicks: o.clicks, res: o[RK] || 0, rev: o.rev || 0, plays: o.views || 0 }; };
  return { cur: f(A.cur), pri: f(A.pri), days: days };
}
function metaLabel() { return (MP && MP.label) || 'Results'; }
function metaGoal() { return MP && MP.goal ? MP.goal.cost_per_result : null; }
function googleGoal() { var g = META.goals || {}; return typeof g.cost_per_conversion === 'number' ? g.cost_per_conversion : null; }

/* ---------- small pieces ---------- */
function pdelta(cu, pr, good) {
  if (cu == null || pr == null || !pr) return '<span class="mut">No earlier period to compare</span>';
  var ch = (cu - pr) / pr, cls = good === 0 ? 'flat' : (ch * good >= 0 ? 'good' : 'bad');
  return '<span class="delta ' + cls + '">' + (ch >= 0 ? '+' : '') + (ch * 100).toFixed(1) + '%</span> vs ' + prevLabel();
}
function pstat(l, cu, pr, f, good, extra) {
  return '<div class="pst"><div class="l">' + l + '</div><div class="v' + (cu == null ? ' na' : '') + '">' + (cu == null ? 'n/a' : f(cu)) + '</div><div class="dl">' + (extra || pdelta(cu, pr, good)) + '</div></div>';
}
function goalLine(cost, goal, one) {
  if (!goal || cost == null) return '';
  var ok = cost <= goal;
  return '<p class="pgoal ' + (ok ? 'good' : 'bad') + '">' + (ok ? 'Within' : 'Above') + ' the goal of ' + money2(goal) + ' per ' + esc(one) + '</p>';
}
var PLAT = {
  google: { name: 'Google Ads', cls: 'pg', mark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3.5l-4.5 8a2.6 2.6 0 104.5 2.6L11.5 6A2.6 2.6 0 007 3.5z"/><circle cx="15" cy="14" r="2.6"/></svg>' },
  meta: { name: 'Meta (Facebook and Instagram)', cls: 'pm', mark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 12.5c0-4 2-7 4-7 3 0 4.5 9 7.5 9 1.6 0 3.5-1.5 3.5-4.5s-1.9-4.5-3.5-4.5c-3 0-4.5 9-7.5 9-2 0-4-1-4-2z"/></svg>' }
};
function platCard(k, P, label, goal, extraRows) {
  var c = P.cur, p = P.pri, one = sing(label);
  var cost = c.res ? c.spend / c.res : null, pcost = p.res ? p.spend / p.res : null;
  var body = '<div class="pbig">' +
      pstat('Spend', c.spend, p.spend, money, 0) +
      pstat(esc(label), c.res, p.res, int, 1) +
      pstat('Cost per ' + esc(one), cost, pcost, money2, -1) +
    '</div>' + goalLine(cost, goal, one) +
    '<div class="psmall">' +
      pstat('Clicks', c.clicks, p.clicks, int, 1) +
      pstat('Click rate', c.impr ? c.clicks / c.impr : null, p.impr ? p.clicks / p.impr : null, pct, 1) +
      pstat('Cost per click', c.clicks ? c.spend / c.clicks : null, p.clicks ? p.spend / p.clicks : null, money2, -1) +
      pstat('Cost per 1,000 views', c.impr ? c.spend / c.impr * 1000 : null, p.impr ? p.spend / p.impr * 1000 : null, money2, -1) +
      (extraRows || '') +
    '</div>';
  return '<div class="panel pcard ' + PLAT[k].cls + '"><div class="phd"><span class="pmark">' + PLAT[k].mark + '</span><div><h2>' + PLAT[k].name + '</h2><p class="sub">Results as ' + (k === 'google' ? 'Google' : 'Meta') + ' counts them: ' + esc(label.toLowerCase()) + '</p></div></div>' + body + '</div>';
}
function metaExtra(M) {
  return pstat('People reached', M.cur.reach || null, M.pri.reach || null, int, 1) +
    pstat('Times each person saw an ad', M.cur.freq || null, M.pri.freq || null, function (v) { return v.toFixed(1); }, 0, M.cur.freq ? (M.cur.freq > 4 ? '<span class="delta bad">High</span> people may be tiring of the ads' : 'A healthy level is under 4') : '');
}

/* ---------- a two-line chart: daily results for each platform, smoothed over 7 days ---------- */
function dualChart(series, opts) {
  var W = 760, H = 220, L = 44, R = 12, Tp = 14, B = 28, n = series[0].v.length;
  if (n < 2) return '<p class="msg">Pick a longer range to see the trend.</p>';
  var mx = 0; series.forEach(function (s) { s.v.forEach(function (x) { if (x != null && x > mx) mx = x; }); });
  if (!mx) return '<p class="msg">No results in this range yet.</p>';
  var st = niceStep(mx / 4), top = Math.ceil(mx / st) * st, X = function (i) { return L + i * (W - L - R) / (n - 1); }, Y = function (v) { return Tp + (H - Tp - B) * (1 - v / top); };
  var g = '', y;
  for (y = 0; y <= top + 1e-9; y += st) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(y).toFixed(1) + '" y2="' + Y(y).toFixed(1) + '" class="gl"/><text x="' + (L - 6) + '" y="' + (Y(y) + 4).toFixed(1) + '" text-anchor="end" class="ax">' + (opts && opts.money ? '$' + Math.round(y) : (st < 1 ? y.toFixed(1) : Math.round(y))) + '</text>';
  var ticks = [0, Math.floor((n - 1) / 2), n - 1].map(function (i) { return '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '" class="ax">' + dstr(i) + '</text>'; }).join('');
  var lines = series.map(function (s) {
    var d = '', on = false;
    s.v.forEach(function (v, i) { if (v == null) { on = false; return; } d += (on ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); on = true; });
    return '<path d="' + d + '" fill="none" stroke="' + s.c + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  }).join('');
  return '<svg class="dchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts && opts.aria || 'Trend') + '">' + g + ticks + lines + '</svg>' +
    '<div class="dkey">' + series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + esc(s.n) + '</span>'; }).join('') + '</div>';
}
function smooth(a) { return roll7(a); }
function costSeries(days) {
  // 7-day cost per result; empty where there were no results that week
  return days.map(function (_, i) { var s = Math.max(0, i - 6), sp = 0, r = 0, j; for (j = s; j <= i; j++) { sp += days[j].spend; r += days[j].res; } return r ? sp / r : null; });
}

/* ---------- Meta campaigns and ads ---------- */
function metaCampTable(M) {
  var rows = (MP.campaigns || []).map(function (c) { var o = M.camps[c.id]; return o && o.spend ? { c: c, o: o } : null; }).filter(Boolean).sort(function (a, b) { return b.o.spend - a.o.spend; });
  if (!rows.length) return '<p class="msg">No Meta spend in this range.</p>';
  var one = sing(metaLabel()), goal = metaGoal();
  return '<div class="tw"><table class="t"><thead><tr><th><button style="cursor:default">Campaign</button></th><th class="n"><button style="cursor:default">Spend</button></th><th class="n"><button style="cursor:default">' + esc(metaLabel()) + '</button></th><th class="n"><button style="cursor:default">Cost / ' + esc(one) + '</button></th><th class="n"><button style="cursor:default">Clicks</button></th><th class="n"><button style="cursor:default">Click rate</button></th></tr></thead><tbody>' +
    rows.map(function (r) {
      var cpr = r.o.res ? r.o.spend / r.o.res : null, cls = cpr == null || !goal ? '' : cpr <= goal ? 'good' : cpr <= goal * 1.3 ? 'warn' : 'bad';
      return '<tr><td><b>' + esc(r.c.name) + '</b>' + (r.c.objective ? ' <span class="tag">' + esc(r.c.objective) + '</span>' : '') + '</td><td class="n">' + money(r.o.spend) + '</td><td class="n">' + int(r.o.res) + '</td><td class="n ' + cls + '">' + (cpr == null ? NA() : money2(cpr)) + '</td><td class="n">' + int(r.o.clicks) + '</td><td class="n">' + (r.o.impr ? pct(r.o.clicks / r.o.impr) : NA()) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function metaAds() {
  var ads = (MP.ads || []).filter(function (a) { return a.spend > 0; });
  if (!ads.length) return '<p class="msg">No Meta ads with spend in this range.</p>';
  var one = sing(metaLabel());
  return '<div class="mads">' + ads.slice(0, 12).map(function (a) {
    var cpr = a.results ? a.spend / a.results : null;
    var img = a.thumb ? '<img src="' + esc(a.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : (a.video ? '' : '<span class="noimg">Ad</span>');
    var inner = '<div class="mimg">' + img + (a.video ? '<span class="play" aria-hidden="true"></span>' : '') + '</div><div class="mtx"><b>' + esc(a.name) + '</b>' + (a.body ? '<p>' + esc(a.body.length > 110 ? a.body.slice(0, 107) + '...' : a.body) + '</p>' : '') +
      '<div class="mnum"><span>' + money(a.spend) + ' spent</span><span>' + int(a.results) + ' ' + esc(metaLabel().toLowerCase()) + '</span><span>' + (cpr == null ? 'n/a' : money2(cpr)) + ' per ' + esc(one) + '</span></div></div>';
    return a.post ? '<a class="mad" href="' + esc(a.post) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<div class="mad">' + inner + '</div>';
  }).join('') + '</div>';
}

/* ---------- the view ---------- */
function vPlatforms() {
  var sw = '<div class="pswitch"><span>Show</span><div class="seg">' + [['both', 'Side by side'], ['google', 'Google only'], ['meta', 'Meta only']].map(function (o) { return '<button data-plat="' + o[0] + '" class="' + (S.plat === o[0] ? 'on' : '') + '" aria-pressed="' + (S.plat === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>';
  if (MP && MP.error && !MP.daily) return sw + panel('Meta', '', '<p class="msg">' + esc(MP.error) + '</p><p class="msg small">Only the VPM team sees this message.</p>');
  var G = googleAgg(), M = metaAgg(), gl = rlab(), ml = metaLabel();
  var gCard = platCard('google', G, gl, googleGoal()), mCard = platCard('meta', M, ml, metaGoal(), metaExtra(M));
  var note = '<p class="pnote">Google and Meta each count results their own way, so we show them side by side and never add them together.' + (HASMIX && S.scope !== 'all' ? ' The campaign filter above applies to Google only.' : '') + '</p>';
  var gc = 'var(--c1)', mc = 'var(--c3)';
  if (S.plat === 'google') {
    return sw + gCard + panel('Daily ' + esc(gl.toLowerCase()) + ' on Google', 'Averaged over 7 days to smooth out busy and quiet days', dualChart([{ n: 'Google: ' + gl, c: gc, v: smooth(G.days.map(function (d) { return d.res; })) }], { aria: 'Google results per day' })) +
      '<div class="panel plinks"><b>More Google detail</b><div><button class="obtn2" data-go="campaigns">Campaigns</button><button class="obtn2" data-go="creative">Ads and creative</button><button class="obtn2" data-go="weekly">Week by week</button></div></div>';
  }
  if (S.plat === 'meta') {
    return sw + mCard +
      '<div class="two">' + panel('Daily ' + esc(ml.toLowerCase()) + ' on Meta', 'Averaged over 7 days', dualChart([{ n: 'Meta: ' + ml, c: mc, v: smooth(M.days.map(function (d) { return d.res; })) }], { aria: 'Meta results per day' })) +
        panel('Cost per ' + esc(sing(ml)) + ' on Meta', 'Over the last 7 days, day by day' + (metaGoal() ? '. Goal: ' + money2(metaGoal()) : ''), dualChart([{ n: 'Meta cost per ' + sing(ml), c: mc, v: costSeries(M.days) }], { money: 1, aria: 'Meta cost per result' })) + '</div>' +
      panel('Meta campaigns', 'Selected range', metaCampTable(M)) +
      panel('Meta ads', 'Top ads by spend.' + ((MP.ads || []).some(function (a) { return a.post; }) ? ' Click an ad to see the post.' : ''), metaAds());
  }
  // side by side
  var tot = G.cur.spend + M.cur.spend, gs = tot ? G.cur.spend / tot : 0;
  var split = tot ? '<div class="panel"><div class="ph"><div><h2>Where the budget went</h2><p class="sub">Total ad spend across both platforms: <b>' + money(tot) + '</b></p></div></div>' +
    '<div class="psplit"><div class="pg" style="width:' + (gs * 100).toFixed(1) + '%"></div><div class="pm" style="width:' + ((1 - gs) * 100).toFixed(1) + '%"></div></div>' +
    '<div class="dkey"><span><i style="background:' + gc + '"></i>Google ' + money(G.cur.spend) + ' (' + pct0(gs) + ')</span><span><i style="background:' + mc + '"></i>Meta ' + money(M.cur.spend) + ' (' + pct0(1 - gs) + ')</span></div></div>' : '';
  return sw + note + '<div class="two pcards">' + gCard + mCard + '</div>' + split +
    '<div class="two">' + panel('Results per day', 'Each platform\'s own results, averaged over 7 days', dualChart([{ n: 'Google: ' + gl, c: gc, v: smooth(G.days.map(function (d) { return d.res; })) }, { n: 'Meta: ' + ml, c: mc, v: smooth(M.days.map(function (d) { return d.res; })) }], { aria: 'Results per day on each platform' })) +
      panel('Cost per result', 'Over the last 7 days, day by day', dualChart([{ n: 'Google: cost per ' + sing(gl), c: gc, v: costSeries(G.days) }, { n: 'Meta: cost per ' + sing(ml), c: mc, v: costSeries(M.days) }], { money: 1, aria: 'Cost per result on each platform' })) + '</div>';
}
// The top of Overview when Meta is running: both platforms at a glance, results kept apart
function metaStrip() {
  if (!MP || !MP.daily) return '';
  var G = googleAgg(), M = metaAgg(), gl = rlab(), ml = metaLabel();
  var cell = function (k, P, label, goal) {
    var c = P.cur, p = P.pri, cost = c.res ? c.spend / c.res : null, pc = p.res ? p.spend / p.res : null;
    return '<div class="gcell ' + PLAT[k].cls + '"><div class="gtop"><span class="pmark">' + PLAT[k].mark + '</span><b>' + (k === 'google' ? 'Google Ads' : 'Meta') + '</b><span class="gsp">' + money(c.spend) + ' spent</span></div>' +
      '<div class="gnums">' + pstat(esc(label), c.res, p.res, int, 1) + pstat('Cost per ' + esc(sing(label)), cost, pc, money2, -1) + '</div>' + goalLine(cost, goal, sing(label)) + '</div>';
  };
  var tot = G.cur.spend + M.cur.spend, ptot = G.pri.spend + M.pri.spend;
  return '<div class="panel glance2"><div class="ph"><div><h2>Both platforms at a glance</h2><p class="sub">Total invested in ads: <b>' + money(tot) + '</b> · ' + pdelta(tot, ptot, 0) + '</p></div><button class="obtn2" data-go="platforms">Compare Google and Meta</button></div>' +
    '<div class="two">' + cell('google', G, gl, googleGoal()) + cell('meta', M, ml, metaGoal()) + '</div>' +
    '<p class="gfoot">Results are shown per platform, never added together, because Google and Meta each count results their own way. <b>Everything below this box is Google Ads.</b></p></div>';
}
