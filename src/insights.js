/* ===== insights engine: plain-English findings and next steps, computed from the data ===== */
function rlab() { return RK === 'conv' ? 'Conversions' : LBL[RK]; }
function chgWord(a, b) {
  if (!b) return a ? 'new' : 'flat';
  var d = (a - b) / b;
  if (Math.abs(d) < 0.02) return 'flat';
  return (d > 0 ? 'up ' : 'down ') + Math.round(Math.abs(d) * 100) + '%';
}
function chgPct(a, b) { return b ? (a - b) / b : null; }
function listNames(rows, f, n) { return rows.slice(0, n).map(f).join(', '); }
function groupBy(kind, list) {
  var m = {}, out = [];
  (ITEMS[kind] || []).forEach(function (r) {
    if (list && list.indexOf(r.cid) < 0) return;
    var o = m[r.name];
    if (!o) { o = m[r.name] = { name: r.name, spend: 0, impr: 0, clicks: 0, views: 0, conv: 0, leads: 0, calls: 0, deals: 0, rev: 0 }; out.push(o); }
    KEYS.forEach(function (k) { o[k] += r[k]; });
  });
  return out;
}

function computeInsights() {
  var A = agg(C), cur = A.cur, pri = A.pri, ins = [], acts = [], notes = [];
  var U = sing(rlab()), UP = rlab().toLowerCase(), R = cur[RK] || 0, PR = pri[RK] || 0;
  var cpr = cprO(cur), pcpr = pri[RK] ? pri.spend / pri[RK] : null;
  var hasPri = pri.spend > 0;
  var W = weeks(A), FW = W.filter(function (w) { return w.days === 7; });

  /* 1. headline */
  (function () {
    var tone = 'neutral', body;
    var title = R ? int(R) + ' ' + UP + ' on ' + money(cur.spend) + ', ' + money(cpr) + ' each' : money(cur.spend) + ' spent and no ' + UP + ' recorded';
    if (hasPri) {
      if (cpr != null && pcpr != null) { var d = (cpr - pcpr) / pcpr; tone = d < -0.05 ? 'good' : d > 0.05 ? 'bad' : 'neutral'; }
      body = 'Compared with the previous ' + N + ' days, spend is ' + chgWord(cur.spend, pri.spend) + ', ' + UP + ' are ' + chgWord(R, PR) + ' and cost per ' + U + ' is ' + chgWord(cpr || 0, pcpr || 0) + '.';
    } else body = 'There is no earlier period to compare with yet.';
    if (HAS.rev && cur.spend) body += ' Revenue of ' + money(cur.rev) + ' on ' + money(cur.spend) + ' of spend is a ' + xf(cur.rev / cur.spend) + ' return.';
    ins.push({ g: 'perf', title: title, body: body, tone: tone });
  })();

  /* 2. momentum across full weeks */
  if (FW.length >= 5) {
    var last3 = FW.slice(-3), earlier = FW.slice(0, -3);
    var sL = sum(last3.map(function (w) { return w.spend; })), rL = sum(last3.map(function (w) { return w[RK] || 0; }));
    var sE = sum(earlier.map(function (w) { return w.spend; })), rE = sum(earlier.map(function (w) { return w[RK] || 0; }));
    var cL = rL ? sL / rL : null, cE = rE ? sE / rE : null;
    var wk = FW.filter(function (w) { return w[RK] > 0; }).map(function (w) { return { w: w, c: w.spend / w[RK] }; }).sort(function (a, b) { return a.c - b.c; });
    var zero = FW.filter(function (w) { return !w[RK]; });
    if (cL != null && cE != null && (cL < cE * 0.85 || cL > cE * 1.15)) {
      var better = cL < cE;
      ins.push({
        g: 'perf', tone: better ? 'good' : 'bad',
        title: better ? 'Efficiency has improved recently' : 'Efficiency has slipped recently',
        body: 'Cost per ' + U + ' was ' + money(cL) + ' across the last three full weeks (' + int(rL) + ' ' + UP + ' on ' + money(sL) + '), against ' + money(cE) + ' in the ' + earlier.length + ' weeks before. ' +
          (wk.length > 1 ? 'Best week: ' + wk[0].w.label + ' at ' + money(wk[0].c) + '. Weakest week with results: ' + wk[wk.length - 1].w.label + ' at ' + money(wk[wk.length - 1].c) + '.' : '') +
          (zero.length ? ' ' + zero.length + ' full week' + (zero.length > 1 ? 's' : '') + ' had no ' + UP + '.' : '') +
          (META.last_change_date ? ' The last account change was logged on ' + dlab(dms(META.last_change_date)) + ', so weeks on either side of that date are not like for like.' : '')
      });
    }
  }

  /* 3. traffic quality */
  if (hasPri && pri.impr && pri.clicks && cur.impr) {
    var dCvr = chgPct(cvrO(cur) || 0, cvrO(pri) || 0), dImp = chgPct(cur.impr, pri.impr), dCpc = chgPct(cpclkO(cur) || 0, cpclkO(pri) || 0);
    var t3 = 'Traffic is steady', tone3 = 'neutral';
    if (dImp != null && dImp > 0.1 && dCvr != null && dCvr < -0.1) { t3 = 'Reach grew, but clicks convert less often'; tone3 = 'bad'; }
    else if (dCvr != null && dCvr > 0.1) { t3 = 'More of your clicks are turning into results'; tone3 = 'good'; }
    else if (dCvr != null && dCvr < -0.1) { t3 = 'Clicks are converting less often'; tone3 = 'bad'; }
    else if (dCpc != null && dCpc < -0.1) { t3 = 'Clicks are getting cheaper'; tone3 = 'good'; }
    ins.push({
      g: 'perf', tone: tone3, title: t3,
      body: 'Impressions are ' + chgWord(cur.impr, pri.impr) + ' and clicks are ' + chgWord(cur.clicks, pri.clicks) + '. CTR moved from ' + pct(ctrO(pri) || 0) + ' to ' + pct(ctrO(cur) || 0) + ', average CPC from ' + money2(cpclkO(pri) || 0) + ' to ' + money2(cpclkO(cur) || 0) +
        ', and conversion rate (conversions divided by clicks) from ' + pct(cvrO(pri) || 0) + ' to ' + pct(cvrO(cur) || 0) + '.' +
        (dCpc != null && dCpc < -0.1 && dCvr != null && dCvr < -0.1 ? ' Cheaper, broader clicks usually convert less often, which is why cost per ' + U + ' may not fall as fast as CPC.' : '')
    });
  }

  /* 4. campaign leaders and laggards */
  var live = C.filter(function (c) { return c.cur.spend >= Math.max(thrCamp() * 0.5, cur.spend * 0.05); });
  live.forEach(function (c) { c._cpr = c.cur[RK] ? c.cur.spend / c.cur[RK] : Infinity; });
  var rank = live.slice().sort(function (a, b) { return HAS.rev ? (b.cur.rev / (b.cur.spend || 1)) - (a.cur.rev / (a.cur.spend || 1)) : a._cpr - b._cpr; });
  var best = rank[0], worst = rank[rank.length - 1];
  if (live.length >= 2 && best && worst && best !== worst && best._cpr !== Infinity) {
    var bs = best.cur.spend / cur.spend, ws = worst.cur.spend / cur.spend;
    ins.push({
      g: 'camp', tone: 'neutral', title: best.name + ' leads, ' + worst.name + ' lags',
      body: best.name + ' costs ' + money(best._cpr) + ' per ' + U + ' on ' + pct0(bs) + ' of spend' + (HAS.rev && best.cur.spend ? ' (' + xf(best.cur.rev / best.cur.spend) + ' return)' : '') + '. ' +
        worst.name + (worst._cpr === Infinity ? ' has produced no ' + UP : ' costs ' + money(worst._cpr) + ' per ' + U) + ' on ' + pct0(ws) + ' of spend. ' +
        (ws >= 0.1 ? 'Shifting budget from ' + worst.name + ' toward ' + best.name + ' is the first lever to test.' : '')
    });
  }

  /* 5. conversion tracking check */
  var mapped = !(RK === 'leads' && LBL.leads === 'Conversions') && RK !== 'conv';
  var trackGap = null;
  if (mapped && R && cur.conv > R * 1.15) {
    var gaps = C.map(function (c) { return { c: c, g: c.cur.conv - (c.cur[RK] || 0) }; }).sort(function (a, b) { return b.g - a.g; });
    trackGap = gaps[0];
    ins.push({
      g: 'camp', tone: 'warn', title: 'Google counts more conversions than ' + UP,
      body: 'Google Ads reports ' + int(cur.conv) + ' conversions, but only ' + int(R) + ' are ' + UP + '. The biggest gap is in ' + gaps[0].c.name + ' (about ' + int(gaps[0].g) + ' extra). Extra conversion actions, such as logins or follow-on video views, make cost per conversion look better than it is and can steer bidding toward the wrong action. Cost per ' + U + ' is the number to manage to.'
    });
  }

  /* 6. wasted search terms */
  var terms = ITEMS.terms || [], wasted = [];
  if (terms.length >= 10) {
    var tSp = sum(terms.map(function (t) { return t.spend; }));
    wasted = terms.filter(function (t) { return !t[RK]; }).sort(function (a, b) { return b.spend - a.spend; });
    var wSp = sum(wasted.map(function (t) { return t.spend; }));
    var searchSp = sum(C.filter(function (c) { return c.type === 'search'; }).map(function (c) { return c.cur.spend; }));
    if (wSp >= Math.max(20, tSp * 0.03)) {
      ins.push({
        g: 'search', tone: wSp / tSp > 0.5 ? 'bad' : 'warn', title: money(wSp) + ' went to search terms with no ' + UP,
        body: 'Of the ' + money(tSp) + ' spent on the ' + terms.length + ' highest-spend search terms Google shows, ' + money(wSp) + ' (' + pct0(wSp / tSp) + ') went to terms with no ' + UP + '. Largest: ' +
          listNames(wasted, function (t) { return '"' + t.name + '" (' + money(t.spend) + ')'; }, 4) + '. Google hides low-volume terms, so these terms cover about ' + (searchSp ? pct0(Math.min(1, tSp / searchSp)) : 'part') + ' of Search spend.'
      });
    }
    if (TERMG.length) {
      var gs = TERMG.map(function (g) { return { n: g[0], re: g[1], spend: 0, r: 0 }; }), other = { n: 'Everything else', spend: 0, r: 0 };
      terms.forEach(function (t) {
        var g = gs.filter(function (x) { return x.re.test(t.name); })[0] || other;
        g.spend += t.spend; g.r += t[RK] || 0;
      });
      var lines = gs.concat([other]).filter(function (g) { return g.spend > 0; }).map(function (g) {
        return g.n + ': ' + money(g.spend) + ' (' + pct0(g.spend / tSp) + ' of term spend), ' + int(g.r) + ' ' + (g.r === 1 ? U : UP) + (g.r ? ' at ' + money(g.spend / g.r) + ' each' : '');
      });
      if (lines.length > 1) ins.push({ g: 'search', tone: 'neutral', title: 'What people are searching for', body: lines.join('. ') + '. Check that the groups bringing ' + UP + ' are also the ones that turn into customers.' });
    }
  }

  /* 7. keywords */
  var kws = ITEMS.keywords || [], zeroKw = [];
  if (kws.length >= 5) {
    zeroKw = kws.filter(function (k) { return !k[RK] && k.spend >= thrItem(); }).sort(function (a, b) { return b.spend - a.spend; });
    var win = kws.filter(function (k) { return k[RK] >= 2; }).sort(function (a, b) { return a.spend / a[RK] - b.spend / b[RK]; });
    var parts = [];
    if (win.length) parts.push('Best keywords: ' + listNames(win, function (k) { return '"' + k.name + '" (' + k.detail.toLowerCase() + ', ' + money(k.spend / k[RK]) + ' per ' + U + ')'; }, 3));
    if (zeroKw.length) parts.push('Keywords with at least ' + money(Math.round(thrItem() / 5) * 5) + ' of spend and no ' + UP + ': ' + listNames(zeroKw, function (k) { return '"' + k.name + '" (' + money(k.spend) + ')'; }, 4) + ', ' + money(sum(zeroKw.map(function (k) { return k.spend; }))) + ' together');
    if (parts.length) ins.push({ g: 'search', tone: zeroKw.length ? 'warn' : 'good', title: 'Keyword winners and wasted spend', body: parts.join('. ') + '.' });
  }

  /* 8. audience segments */
  var seg = [];
  [['age', 'Age'], ['gender', 'Gender'], ['device', 'Device']].forEach(function (p) {
    var g = groupBy(p[0]).filter(function (x) { return x[RK] >= 3 && x.spend >= cur.spend * 0.06; });
    if (g.length < 2) return;
    g.forEach(function (x) { x._c = x.spend / x[RK]; });
    g.sort(function (a, b) { return a._c - b._c; });
    var b = g[0], w = g[g.length - 1];
    if (w._c / b._c >= 1.25) seg.push(p[1].toLowerCase() + ': ' + b.name + ' is the most efficient at ' + money(b._c) + ' per ' + U + ' and ' + w.name + ' the least at ' + money(w._c));
  });
  var dev = groupBy('device').sort(function (a, b) { return b.spend - a.spend; });
  if (dev.length) { var dsum = sum(dev.map(function (d) { return d.spend; })); if (dsum && dev[0].spend / dsum >= 0.6) seg.push(dev[0].name.toLowerCase() + ' takes ' + pct0(dev[0].spend / dsum) + ' of spend'); }
  if (seg.length) ins.push({ g: 'aud', tone: 'neutral', title: 'Who responds best', body: seg.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join('. ') + '.' });

  /* 9. day of week */
  if (N >= 28) {
    var dw = [0, 1, 2, 3, 4, 5, 6].map(function (d) { return { d: d, spend: 0, r: 0 }; });
    for (var i = 0; i < N; i++) { var wd = new Date(START + i * DAY).getUTCDay(); dw[wd].spend += A.d.spend[i]; dw[wd].r += (A.d[RK] || A.d.conv)[i]; }
    var q = dw.filter(function (x) { return x.r >= 3; }); q.forEach(function (x) { x.c = x.spend / x.r; }); q.sort(function (a, b) { return a.c - b.c; });
    var NM = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (q.length >= 4 && q[q.length - 1].c / q[0].c >= 1.3) ins.push({ g: 'perf', tone: 'neutral', title: NM[q[0].d] + ' is the strongest day', body: NM[q[0].d] + ' costs ' + money(q[0].c) + ' per ' + U + ' and ' + NM[q[q.length - 1].d] + ' costs ' + money(q[q.length - 1].c) + '. If this holds for a few more weeks, test lower bids or tighter budgets on the weakest days.' });
  }

  /* 10. search impression share */
  var sc = C.filter(function (c) { return c.type === 'search' && c.is != null && c.cur.spend > 0; });
  var isLostB = 0, isLostR = 0;
  if (sc.length) {
    var ssp = sum(sc.map(function (c) { return c.cur.spend; }));
    var wavg = function (k) { return sum(sc.map(function (c) { return (c[k] || 0) * c.cur.spend; })) / ssp; };
    var ISv = wavg('is'); isLostB = wavg('lostB'); isLostR = wavg('lostR');
    ins.push({
      g: 'camp', tone: 'neutral', title: 'Search wins about ' + pct0(ISv) + ' of the impressions it could',
      body: 'Across Search campaigns, roughly ' + pct0(isLostB) + ' of eligible impressions are lost to budget and ' + pct0(isLostR) + ' to ad rank (bids and quality). ' +
        (isLostB >= 0.2 ? 'Budget is capping reach, so adding budget to the campaigns with the best cost per ' + U + ' can add volume.' : isLostR >= 0.4 ? 'Ad rank is the bigger limit, so ad relevance, quality and landing page matter more than budget.' : 'Neither limit is large, so growth will come from better conversion more than from more spend.')
    });
  }

  /* 11. video vs the rest */
  var vids = C.filter(function (c) { return c.type === 'video'; });
  if (vids.length && vids.length < C.length) {
    var vs = sum(vids.map(function (c) { return c.cur.spend; })), vr = sum(vids.map(function (c) { return c.cur[RK] || 0; }));
    var os = cur.spend - vs, orr = R - vr;
    ins.push({
      g: 'camp', tone: 'neutral', title: 'Video is ' + pct0(vs / cur.spend) + ' of spend',
      body: 'Video campaigns spent ' + money(vs) + ' and produced ' + int(vr) + ' ' + UP + (vr ? ' (' + money(vs / vr) + ' each)' : '') + ', against ' + int(orr) + ' ' + UP + (orr ? ' at ' + money(os / orr) + ' each' : '') + ' from the rest of the account. ' +
        (vs / cur.spend < 0.15 ? 'Video is still a small test. Give it a set budget and time window before judging it, and compare it on cost per ' + U + ' rather than views.' : 'Compare creative inside video on cost per ' + U + ', not views.')
    });
  }

  /* ----- actions ----- */
  (META.actions || []).forEach(function (a) { acts.push({ title: a.title, body: a.body, priority: a.priority || 'High', team: true }); });
  if (trackGap) acts.push({ priority: 'High', title: 'Fix conversion tracking before shifting budget', body: 'Make ' + UP + ' the main goal in every campaign and remove extra actions (logins, follow-on views) from campaign goals, starting with ' + trackGap.c.name + '. Then bidding and this report agree on what a result is.' });
  C.filter(function (c) { return stat(c.cur, thrCamp()) === 'fix'; }).sort(function (a, b) { return b.cur.spend - a.cur.spend; }).slice(0, 1).forEach(function (c) {
    acts.push({ priority: 'High', title: 'Fix or pause ' + c.name, body: (c._cpr && c._cpr !== Infinity ? 'It costs ' + money(c._cpr) + ' per ' + U : 'It has produced no ' + UP) + ' on ' + money(c.cur.spend) + ' of spend' + (HAS.rev && c.cur.spend ? ' (' + xf(c.cur.rev / c.cur.spend) + ' return)' : '') + '. Rework its targeting and creative, or move the budget to stronger campaigns.' });
  });
  if (best && best._cpr !== Infinity && stat(best.cur, thrCamp()) === 'scale') {
    var limited = (best.lostB || 0) >= 0.2;
    acts.push({ priority: limited ? 'High' : 'Medium', title: 'Add budget to ' + best.name, body: 'It has the best cost per ' + U + ' (' + money(best._cpr) + ')' + (limited ? ' and is losing about ' + pct0(best.lostB) + ' of eligible impressions to budget' : '') + '. Raise its daily budget about 20% and watch cost per ' + U + ' for a week before the next step.' });
  }
  if (wasted.length) acts.push({ priority: 'Medium', title: 'Add negative keywords for terms with no results', body: 'Start with ' + listNames(wasted, function (t) { return '"' + t.name + '"'; }, 5) + '. Together the top terms with no ' + UP + ' cost ' + money(sum(wasted.slice(0, 5).map(function (t) { return t.spend; }))) + '. Review them before adding, since some may be broad but still worth keeping.' });
  if (zeroKw.length) acts.push({ priority: 'Medium', title: 'Pause or rework keywords that are not producing', body: listNames(zeroKw, function (k) { return '"' + k.name + '"'; }, 4) + ' spent ' + money(sum(zeroKw.slice(0, 4).map(function (k) { return k.spend; }))) + ' with no ' + UP + '. Move that budget to the winning keywords.' });
  var adsL = (ITEMS.ads || []).filter(function (a) { return stat(a, thrItem()) === 'fix'; }).sort(function (a, b) { return b.spend - a.spend; });
  if (adsL.length) acts.push({ priority: 'Medium', title: 'Replace the weakest ads', body: listNames(adsL, function (a) { return '"' + a.h1 + '" (' + money(a.spend) + ')'; }, 3) + ' cost the most per ' + U + '. Write new versions modeled on your best ad and test them.' });
  var vidL = (ITEMS.videos || []).filter(function (v) { return v[RK] >= 1 && v.spend >= thrItem(); }).sort(function (a, b) { return a.spend / a[RK] - b.spend / b[RK]; })[0];
  if (vidL) acts.push({ priority: 'Medium', title: 'Make new versions of "' + vidL.name + '"', body: 'It has the lowest cost per ' + U + ' among videos (' + money(vidL.spend / vidL[RK]) + '). Test two new openings and keep the rest of the video the same.' });
  if (!HAS.deals) acts.push({ priority: 'Medium', title: 'Check ' + U + ' quality before scaling', body: 'Compare ' + UP + ' with show rate and closed sales by campaign and search term. Cheap ' + UP + ' that never close are not a win, and this tells you where to put more budget.' });
  if (!HAS.rev) acts.push({ priority: 'Medium', title: 'Import closed sales as offline conversions', body: 'Sending closed sales and their value back to Google lets campaigns be judged on revenue and return, and lets bidding learn which clicks become customers.' });
  var land = (ITEMS.landing || []);
  if (land.length) { var lc = sum(land.map(function (l) { return l.clicks; })); if (lc >= 200 && land[0].clicks / lc >= 0.9) acts.push({ priority: 'Low', title: 'Test a dedicated landing page', body: pct0(land[0].clicks / lc) + ' of clicks land on one page (' + land[0].name + '). A page matched to the ad message, tested against it, can lift conversion rate and lower cost per ' + U + ' without touching bids.' }); }
  var po = { High: 0, Medium: 1, Low: 2 };
  acts.forEach(function (a, i) { a._i = i; });
  acts.sort(function (a, b) { return (b.team ? 1 : 0) - (a.team ? 1 : 0) || (po[a.priority] || 1) - (po[b.priority] || 1) || a._i - b._i; });

  /* ----- notes ----- */
  notes.push({ title: 'How to read this report', body: 'Conversion rate is conversions divided by clicks. Cost per conversion is spend divided by conversions. "' + rlab() + '" are the actions counted as results for this account' + (mapped ? ', which can be fewer than every conversion Google counts.' : '.') + ' Changes are measured against the previous ' + N + ' days (' + dlab(dms(META.previous ? META.previous.from : iso(START - N * DAY))) + ' to ' + dlab(dms(META.previous ? META.previous.to : iso(START - DAY))) + ').' });
  var tzToday = ''; try { tzToday = new Date().toLocaleDateString('en-CA', { timeZone: META.timezone || 'America/Denver' }); } catch (e) { /* ignore */ }
  if (tzToday && META.range && META.range.to >= tzToday) notes.push({ title: 'Today is still in progress', body: 'This range includes today, so the last day is partial and will keep filling in.' });
  if (W.length && W[W.length - 1].partial && !(META.range.to >= tzToday)) notes.push({ title: 'The last week is partial', body: 'The final week in the weekly table has fewer than seven days, so compare it with care.' });
  notes.push({ title: 'Small delays in the newest numbers', body: 'Google Ads can adjust the last day or two as clicks and conversions finish processing. Older days do not change much.' });
  if (!HAS.rev) notes.push({ title: 'Revenue is not connected', body: 'Results are counted in ' + UP + ', so ROAS is not shown. Importing closed sales and their value from your CRM adds revenue and return to this report.' });
  if (META.warnings && META.warnings.length) notes.push({ title: 'Some detail could not be loaded', body: 'Parts of the account could not be loaded just now (' + META.warnings.map(function (w) { return String(w).split(':')[0]; }).join(', ') + '). The rest of the report is complete. It will fill in on the next refresh.' });
  if (!C.some(function (c) { return c.type === 'video'; })) notes.push({ title: 'No video campaigns in this view', body: 'Video and YouTube results appear here when video or Demand Gen campaigns are running.' });

  return { insights: ins, actions: acts, notes: notes, team: META.notes || [], wins: findWins({ cur: cur, pri: pri, hasPri: hasPri, R: R, PR: PR, cpr: cpr, pcpr: pcpr, U: U, UP: UP, FW: FW, best: best, live: live }) };
}

/* ===== wins: up to three good things that happened in the selected range ===== */
function findWins(x) {
  var w = [], cur = x.cur, pri = x.pri, U = x.U, UP = x.UP;
  function add(p, title, body) { w.push({ p: p, title: title, body: body }); }
  var sp = function (a, b) { return 'Spend was ' + money(a) + (b ? ', ' + chgWord(a, b) + ' on the previous ' + N + ' days' : '') + '.'; };
  if (x.hasPri && x.PR && x.R && (x.R - x.PR) / x.PR >= 0.05) add(1, int(x.R) + ' ' + UP + ', up ' + Math.round((x.R - x.PR) / x.PR * 100) + '%', 'That is ' + (Math.round(x.R) - Math.round(x.PR)) + ' more than the previous ' + N + ' days (' + int(x.PR) + '). ' + sp(cur.spend, pri.spend));
  if (x.hasPri && x.cpr != null && x.pcpr != null && (x.cpr - x.pcpr) / x.pcpr <= -0.05) add(2, 'Cost per ' + U + ' fell to ' + money(x.cpr), 'Down ' + Math.round((x.pcpr - x.cpr) / x.pcpr * 100) + '% from ' + money(x.pcpr) + ' in the previous ' + N + ' days, so each result costs less.');
  if (x.hasPri && HAS.rev && cur.spend && pri.spend && pri.rev) {
    var r1 = cur.rev / cur.spend, r0 = pri.rev / pri.spend;
    if (r1 / r0 >= 1.05) add(1, 'Return on ad spend rose to ' + xf(r1), 'Up from ' + xf(r0) + '. ' + money(cur.rev) + ' of revenue on ' + money(cur.spend) + ' of spend.');
  }
  if (x.hasPri) {
    var dCv = chgPct(cvrO(cur) || 0, cvrO(pri) || 0), dCp = chgPct(cpclkO(cur) || 0, cpclkO(pri) || 0);
    if (dCv != null && dCv >= 0.1) add(3, 'More clicks are turning into results', 'Conversion rate (conversions divided by clicks) went from ' + pct(cvrO(pri) || 0) + ' to ' + pct(cvrO(cur) || 0) + '.');
    if (dCp != null && dCp <= -0.1 && cur.clicks >= pri.clicks * 0.9) add(4, 'Clicks are getting cheaper', 'Average cost per click fell from ' + money2(cpclkO(pri) || 0) + ' to ' + money2(cpclkO(cur) || 0) + ' without losing traffic.');
  }
  var b = x.best;
  if (b && b._cpr !== Infinity && b.cur[RK] >= 3 && x.live.length >= 2 && stat(b.cur, thrCamp()) === 'scale') add(3, b.name + ' is the most efficient campaign', money(b._cpr) + ' per ' + U + ' on ' + money(b.cur.spend) + ' of spend (' + int(b.cur[RK]) + ' ' + UP + ')' + (HAS.rev && b.cur.spend ? ', a ' + xf(b.cur.rev / b.cur.spend) + ' return' : '') + '.');
  var fw = x.FW.filter(function (k) { return k[RK] > 0; });
  if (fw.length >= 3) {
    var avg = sum(fw.map(function (k) { return k.spend; })) / sum(fw.map(function (k) { return k[RK]; }));
    var bw = fw.slice().sort(function (p, q) { return p.spend / p[RK] - q.spend / q[RK]; })[0];
    if (bw.spend / bw[RK] <= avg * 0.85) add(5, 'Best week: ' + bw.label, int(bw[RK]) + ' ' + UP + ' at ' + money(bw.spend / bw[RK]) + ' each, against ' + money(avg) + ' across the range.');
  }
  var ad = (ITEMS.ads || []).filter(function (a) { return a[RK] >= 3 && a.spend >= thrItem(); }).sort(function (p, q) { return p.spend / p[RK] - q.spend / q[RK]; })[0];
  if (ad) add(6, 'Top ad: "' + ad.h1 + '"', money(ad.spend / ad[RK]) + ' per ' + U + ' (' + int(ad[RK]) + ' ' + UP + ' on ' + money(ad.spend) + ').');
  var vd = (ITEMS.videos || []).filter(function (v) { return v[RK] >= 3 && v.spend >= thrItem(); }).sort(function (p, q) { return p.spend / p[RK] - q.spend / q[RK]; })[0];
  if (vd) add(6, 'Top video: "' + vd.name + '"', money(vd.spend / vd[RK]) + ' per ' + U + ' (' + int(vd[RK]) + ' ' + UP + ' on ' + money(vd.spend) + ').');
  var kw = (ITEMS.keywords || []).filter(function (k) { return k[RK] >= 3; }).sort(function (p, q) { return p.spend / p[RK] - q.spend / q[RK]; })[0];
  if (kw) add(7, 'Top keyword: "' + kw.name + '"', money(kw.spend / kw[RK]) + ' per ' + U + ' (' + int(kw[RK]) + ' ' + UP + ').');
  if (!w.length && x.R) add(9, int(x.R) + ' ' + UP + ' in this range', money(cur.spend) + ' of spend, ' + money(x.cpr) + ' per ' + U + '.');
  w.sort(function (p, q) { return p.p - q.p; });
  return w.slice(0, 3);
}
