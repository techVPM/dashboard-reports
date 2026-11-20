/* ===== client journey editor for the team (mounted on Clients and goals, "Client journey" tab) =====
   VPMJourney.mount(element, token, { pw, onAuth }) draws and edits one client's journey. */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return v == null ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'); }
  function money2(v) { return v == null ? 'n/a' : '$' + (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)); }
  function int(v) { return v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'); }
  function dlab(s) { return s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; }
  function tlab(ms) { return ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function sing(s) { return String(s || '').toLowerCase().replace(/s$/, ''); }

  // one modal and one progress bar for the whole page
  var M = null, BAR = null, PEND = null;
  function ui() {
    if (M) return;
    BAR = document.createElement('div'); BAR.className = 'jbar'; BAR.innerHTML = '<i></i>'; document.body.appendChild(BAR);
    M = document.createElement('div'); M.className = 'vpm tm jmw'; M.hidden = true; M.setAttribute('role', 'dialog'); M.setAttribute('aria-modal', 'true');
    M.innerHTML = '<form class="jmbox" novalidate><div class="jmhead"><h2></h2><button type="button" class="jmx" data-close="1" aria-label="Close">&times;</button></div><div class="jmbody"></div><p class="err jmerr" hidden></p><div class="jmfoot"><button type="button" class="obtn" data-close="1">Cancel</button><button type="submit" class="mbtn jmsave">Save</button></div></form>';
    document.body.appendChild(M);
    M.addEventListener('click', function (e) {
      if (e.target === M || e.target.closest('[data-close]')) return close();
      var d = e.target.closest('[data-jdel]'); if (d && PEND) { var fn = PEND.del; close(); fn(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !M.hidden) close(); });
    M.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault(); if (!PEND || !PEND.save) return close();
      var F = {}; Array.prototype.forEach.call(e.target.elements, function (el) { if (el.name) F[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'radio' ? (el.checked ? el.value : F[el.name]) : el.value.trim(); });
      var body = PEND.save(F); if (!body) return;
      var fn = PEND.after; close(); fn(body);
    });
  }
  function open(title, html, save, after, opts) {
    ui(); opts = opts || {};
    M.querySelector('h2').textContent = title; M.querySelector('.jmbody').innerHTML = html; M.querySelector('.jmerr').hidden = true;
    var sb = M.querySelector('.jmsave'); sb.hidden = !save; sb.textContent = opts.label || 'Save'; M.querySelector('.jmfoot [data-close]').textContent = save ? 'Cancel' : 'Close';
    var f = M.querySelector('.jmfoot'), old = f.querySelector('.jmdel'); if (old) old.remove();
    if (opts.del) f.insertAdjacentHTML('afterbegin', '<button type="button" class="obtn jmdel" data-jdel="1">' + esc(opts.delLabel || 'Delete') + '</button>');
    PEND = { save: save, after: after, del: opts.del }; M.hidden = false;
    var x = M.querySelector('.jmbody input:not([type=checkbox]):not([type=radio]),.jmbody textarea,.jmbody select'); if (x) x.focus();
  }
  function close() { if (M) M.hidden = true; PEND = null; }
  function err(m) { var e = M.querySelector('.jmerr'); e.textContent = m; e.hidden = false; return null; }
  var busyN = 0;
  function busy(on) { ui(); busyN = Math.max(0, busyN + (on ? 1 : -1)); BAR.classList.toggle('on', busyN > 0); }
  function toast(m, bad) { Array.prototype.forEach.call(document.querySelectorAll('.btoast'), function (x) { x.remove(); }); var t = document.createElement('div'); t.className = 'btoast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3000); }
  function fld(label, html, wide) { return '<label class="jf' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function chk(name, on, label) { return '<label class="jchk"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '><span>' + label + '</span></label>'; }

  function mount(el, token, opts) {
    opts = opts || {};
    var J = null, OPEN = {}, POLL = null, alive = true, SHOWREM = false;
    function api(method, qs, body) {
      return fetch('/api/journey' + (qs || ''), { method: method, headers: { 'x-admin-key': opts.pw, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) { if (opts.onAuth) opts.onAuth(); throw new Error('auth'); } if (!r.ok) throw new Error(j.error || 'Something went wrong.'); return j; }); });
    }
    function load(quiet) {
      if (!alive) return;
      if (!J && !quiet) el.innerHTML = '<div class="panel"><p class="msg">Loading the journey and the Google Ads history</p></div>';
      busy(true);
      return api('GET', '?token=' + encodeURIComponent(token)).then(function (j) { busy(false); if (!alive) return; J = j; draw(); clearTimeout(POLL); if (Object.keys(J.reports).some(function (d) { return J.reports[d].status === 'working'; })) POLL = setTimeout(function () { load(true); }, 5000); if (opts.onLoad) opts.onLoad(J); })
        .catch(function (e) { busy(false); if (e.message !== 'auth' && alive) el.innerHTML = '<div class="panel"><p class="err">' + esc(e.message) + '</p></div>'; });
    }
    // save, keep the page where it is, then quietly refresh
    function post(body, okMsg) {
      body.token = token; busy(true);
      return api('POST', '', body).then(function () { busy(false); if (okMsg !== false) toast(okMsg || 'Saved'); return load(true); })
        .catch(function (e) { busy(false); if (e.message !== 'auth') { toast(e.message, 1); load(true); } });
    }
    function itemBy(id) { return J.items.filter(function (i) { return i.id === id; })[0]; }
    function winBy(id) { return J.wins.filter(function (w) { return String(w.id) === String(id); })[0]; }

    function draw() {
      if (!J || !alive) return;
      var y = window.scrollY, U = J.label || 'Results', out = '', SG = J.suggest || {};
      if (J.test) out += '<p class="jtest">Test client: everything here is separate from the real client. Their report link shows this test journey.</p>';
      // dates
      out += '<div class="panel jset"><div class="jrow">' +
        '<label class="jf"><span>Kickoff call</span><input type="date" data-d="kickoff" value="' + esc(J.kickoff) + '"></label>' +
        '<label class="jf"><span>Ads launched' + (J.launch && !J.launch_set ? ' <em>found in Google Ads</em>' : '') + '</span><input type="date" data-d="launch" value="' + esc(J.launch_set ? J.launch : '') + '"></label>' +
        '<button type="button" class="mbtn sm" data-act="dates">Save dates</button></div>' +
        (!J.kickoff && SG.kickoff ? '<p class="jsug">GoHighLevel has a start date of <b>' + esc(dlab(SG.kickoff)) + '</b>. <button type="button" class="tlink" data-act="usekick">Use it as the kickoff date</button></p>' : '') +
        (J.launch && !J.launch_set ? '<p class="sub small">Google Ads shows the first spend after kickoff on ' + esc(dlab(J.launch)) + '. Set a date only if VPM\'s launch was different.</p>' : '') +
        (J.history_error ? '<p class="err small">Could not read Google Ads: ' + esc(J.history_error) + '</p>' : '') + '</div>';
      // settings
      var V = J.value_settings || {};
      out += '<div class="panel"><div class="jog">' +
        '<div>' + fld('Link to their strategy and roadmap', '<input data-in="rmap" type="url" placeholder="https://docs.google.com/..." value="' + esc(J.roadmap_url || '') + '">') + '<p class="small sub">Shows as a button at the top of their journey.</p><button type="button" class="obtn sm" data-act="rmap">Save link</button></div>' +
        '<div><label class="sw"><input type="checkbox" data-in="von"' + (V.on ? ' checked' : '') + '><span class="swt" aria-hidden="true"></span><span><b>Show return in dollars</b><small>Sales brought in by the ads, next to what was spent.</small></span></label>' +
        '<div class="vsrc"' + (V.on ? '' : ' hidden') + '><label class="rad"><input type="radio" name="vsrc_' + esc(token) + '" value="ads"' + (V.source !== 'estimate' ? ' checked' : '') + '> Sales value recorded in Google Ads' + (J.ads_has_value ? '' : ' <em>(none recorded)</em>') + '</label>' +
        '<label class="rad"><input type="radio" name="vsrc_' + esc(token) + '" value="estimate"' + (V.source === 'estimate' ? ' checked' : '') + '> Estimate: results x close rate x average sale</label>' +
        '<div class="jrow">' + fld('Close rate %', '<input data-in="vcr" type="number" min="0" max="100" step="1" value="' + esc(V.close_rate || '') + '">') + fld('Average sale $', '<input data-in="vas" type="number" min="0" step="1" value="' + esc(V.avg_sale || '') + '">') + '</div>' +
        (V.on && J.value ? '<p class="small sub">Showing ' + money(J.value.amount) + (J.value.estimate ? ' (estimate)' : '') + ', ' + J.value.roi.toFixed(1) + 'x return since launch.</p>' : V.on ? '<p class="small err">Not enough to calculate: ' + (V.source === 'estimate' ? 'add the close rate and average sale.' : 'no sales value in Google Ads. Use the estimate instead.') + '</p>' : '') +
        '<button type="button" class="obtn sm" data-act="value">Save</button></div></div></div></div>';
      if (!J.kickoff && !J.launch) { el.innerHTML = out + '<div class="panel"><p class="msg">Set the kickoff date to start this client\'s journey. Wins and reports are found from that date on.</p></div>'; return; }
      var T = J.totals;
      if (T) out += '<div class="kpis bzk">' + tile('Invested since launch', money(T.spend)) + tile(U, int(T.results)) + tile('Cost per ' + sing(U), money2(T.cost_per_result), J.goal && J.goal.cost ? 'goal ' + money2(J.goal.cost) : '') + tile('Days together', int((Date.parse(J.today) - Date.parse(J.kickoff || J.launch)) / 864e5)) + '</div>';

      // reports
      var ks = Object.keys(J.reports).sort(function (a, b) { return a - b; });
      out += '<div class="panel"><div class="ph2"><h2>Check-in reports</h2></div><p class="sub">Each report compares its period with the same length just before it (30 days against the 30 before, 90 against the 90 before). Written by Claude in the VPM voice as Progress, Problems and Plans, with charts. The client sees it after you switch on Show to client.</p><div class="jrgrid">' + ks.map(function (d) {
        var r = J.reports[d], due = r.due, ready = due && due <= J.today;
        var head = '<b>' + esc(r.name) + '</b><span class="small sub">' + (due ? 'Due ' + esc(dlab(due)) : 'After launch') + '</span>';
        if (r.status === 'working') return '<div class="jrc wk">' + head + '<div class="jspin"><i></i></div><p class="small sub">Writing the report, about a minute</p></div>';
        if (r.text) return '<div class="jrc on">' + head + '<p class="jh">' + esc(r.text.headline) + '</p><p class="small sub">Made ' + esc(tlab(r.generated_at)) + (r.by === 'claude' ? ' by Claude' : ' from set phrases') + (r.early ? ' · early' : '') + (r.error ? ' · last try failed: ' + esc(r.error) : '') + '</p>' +
          '<label class="sw small"><input type="checkbox" data-share="' + d + '"' + (r.shared ? ' checked' : '') + '><span class="swt" aria-hidden="true"></span><span><b>Show to client</b></span></label>' +
          '<div class="jrb"><button type="button" class="tlink" data-rview="' + d + '">View</button><button type="button" class="tlink" data-redit="' + d + '">Reword</button><button type="button" class="tlink" data-rgen="' + d + '">Make again</button><a class="tlink" href="/jreport.html?token=' + encodeURIComponent(token) + '&d=' + d + '" target="_blank" rel="noopener">Download PDF</a></div></div>';
        return '<div class="jrc">' + head + (r.status === 'error' || r.error ? '<p class="err small">' + esc(r.error || 'Failed') + '</p>' : '') + '<button type="button" class="' + (ready ? 'mbtn' : 'obtn') + ' sm" data-rgen="' + d + '"' + (J.launch ? '' : ' disabled') + '>' + (ready ? 'Generate report' : 'Generate early') + '</button></div>';
      }).join('') + '</div></div>';

      // wins
      out += '<div class="panel"><div class="ph2"><h2>Wins</h2><button type="button" class="obtn sm" data-act="addwin">Add a win</button></div><p class="sub">Found in Google Ads, plus any you add. Edit the wording of any win, or hide it from the client.</p>' +
        (J.wins.length ? '<ul class="jwl">' + J.wins.map(function (w) {
          return '<li class="' + (w.hidden ? 'off' : '') + '"><div><b>' + esc(w.title) + '</b><span class="small sub">' + esc(dlab(w.date)) + (w.auto ? (w.edited ? ' · found automatically, reworded' : ' · found automatically') : ' · added by the team') + (w.detail ? ' · ' + esc(w.detail) : '') + '</span></div><div class="jact">' +
            '<button type="button" class="tlink" data-wedit="' + esc(w.id) + '">Edit</button>' + (w.auto ? '<button type="button" class="eye' + (w.hidden ? '' : ' on') + '" data-whide="' + esc(w.id) + '" title="Who sees this win">' + (w.hidden ? 'Hidden' : 'Client') + '</button>' : '') + '</div></li>';
        }).join('') + '</ul>' : '<p class="msg">No wins yet. They appear here as the numbers come in.</p>') + '</div>';

      // notes
      out += '<div class="panel"><div class="ph2"><h2>Notes</h2><button type="button" class="obtn sm" data-note="">Add a note</button></div>' + (J.notes.length ? notesHtml(J.notes) : '<p class="small sub">Notes about the partnership as a whole. Notes on one milestone are in the timeline.</p>') + '</div>';

      // timeline
      var stage = J.stage || 0;
      out += '<div class="panel"><div class="ph2"><h2>Timeline</h2><button type="button" class="tlink" data-act="showrem">' + (SHOWREM ? 'Hide removed steps' : 'Show removed steps') + '</button></div><p class="sub">Tick milestones off with a date. Remove any that do not apply to this client, or add your own. <span class="eye on">Client</span> steps show on their page.</p>';
      J.phases.forEach(function (p, idx) {
        var its = J.items.filter(function (i) { return i.phase === p.id && (SHOWREM || !i.removed); });
        var live = its.filter(function (i) { return !i.removed; }), nd = live.filter(function (i) { return i.done; }).length;
        var isNow = idx === stage, op = OPEN[p.id] != null ? OPEN[p.id] : isNow || (nd < live.length && idx < stage);
        out += '<div class="jphase' + (isNow ? ' now' : idx < stage ? ' past' : '') + '"><button type="button" class="jpt" data-ph="' + p.id + '" aria-expanded="' + op + '"><b>' + esc(p.name) + '</b>' + (isNow ? '<span class="jhere">Client is here</span>' : '') + '<span>' + esc(p.sub) + '</span><em>' + nd + ' of ' + live.length + ' done</em></button>';
        if (op) out += '<ul class="jitems">' + its.map(itemHtml).join('') + '<li class="jadd"><button type="button" class="tlink" data-addev="' + p.id + '">+ Add a step or event</button></li></ul>';
        out += '</div>';
      });
      out += '</div>';
      el.innerHTML = out;
      window.scrollTo(0, y);
    }
    function tile(l, v, s) { return '<div class="kpi"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (s ? '<div class="ksub">' + esc(s) + '</div>' : '') + '</div>'; }
    function notesHtml(list) {
      return '<ul class="jnl">' + list.map(function (n) { return '<li><span class="eye' + (n.public ? ' on' : '') + '">' + (n.public ? 'Client' : 'Team') + '</span><p>' + esc(n.text).replace(/\n/g, '<br>') + '</p><span class="small sub">' + esc(tlab(n.at)) + '</span><button type="button" class="tlink" data-nedit="' + esc(n.id) + '">Edit</button></li>'; }).join('') + '</ul>';
    }
    function itemHtml(i) {
      if (i.removed) return '<li class="jit rem"><div class="jmid"><b>' + esc(i.title) + '</b><span class="small sub">Removed for this client</span></div><div class="jact"><button type="button" class="tlink" data-restore="' + esc(i.id) + '">Put back</button></div></li>';
      return '<li class="jit' + (i.done ? ' done' : '') + '">' +
        '<label class="jck"><input type="checkbox" data-done="' + esc(i.id) + '"' + (i.done ? ' checked' : '') + ' aria-label="Done: ' + esc(i.title) + '"><span></span></label>' +
        '<div class="jmid"><b>' + esc(i.title) + '</b>' + (i.auto ? ' <em class="auto" title="Fills in from Google Ads or the reports">auto</em>' : '') + (i.win ? ' <span class="pill good">win</span>' : '') +
        '<span class="small sub">' + (i.date ? 'Done ' + esc(dlab(i.date)) : i.due ? 'Planned ' + esc(dlab(i.due)) : 'Not done yet') + (i.auto_date && i.date !== i.auto_date ? ' · Google Ads says ' + esc(dlab(i.auto_date)) : '') + '</span>' +
        (i.notes.length ? notesHtml(i.notes) : '') + '</div>' +
        '<div class="jact"><button type="button" class="eye' + (i.client ? ' on' : '') + '" data-vis="' + esc(i.id) + '" title="Who sees this step">' + (i.client ? 'Client' : 'Team') + '</button>' +
        '<button type="button" class="tlink" data-iedit="' + esc(i.id) + '">Edit</button><button type="button" class="tlink" data-note="' + esc(i.id) + '">+ Note</button></div></li>';
    }

    /* forms */
    function noteForm(item, n) {
      var it = item ? itemBy(item) : null;
      open(n ? 'Edit note' : 'Add a note' + (it ? ' to "' + it.title + '"' : ''), fld('Note', '<textarea name="text" rows="5">' + esc(n ? n.text : '') + '</textarea>', 1) + chk('public', n ? n.public : false, 'Show to client'),
        function (F) { if (!F.text) return err('Write the note first.'); return { action: 'note', id: n ? n.id : undefined, item: item || null, text: F.text, public: F.public }; }, post,
        n ? { del: function () { post({ action: 'note_delete', id: n.id }, 'Note deleted'); }, delLabel: 'Delete note' } : null);
    }
    function findNote(id) { var all = J.notes.slice(); J.items.forEach(function (i) { all = all.concat(i.notes.map(function (n) { return Object.assign({ item: i.id }, n); })); }); return all.filter(function (n) { return n.id === id; })[0]; }
    function phaseSel(cur) { return '<select name="phase">' + J.phases.map(function (p) { return '<option value="' + p.id + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>'; }
    function itemForm(i) {
      if (i.custom) return customForm(i.phase, i);
      open('Edit milestone', '<div class="jgrid">' + fld('Name on the timeline', '<input name="title" value="' + esc(i.title) + '">', 1) + fld('Why it matters (shown to the client)', '<input name="why" value="' + esc(i.why || '') + '">', 1) +
        fld('Date done', '<input type="date" name="date" value="' + esc(i.date) + '">') + fld('Planned for', '<input type="date" name="due" value="' + esc(i.due) + '">') + '</div>' +
        '<div class="jchks">' + chk('done', i.done, 'Done') + chk('client', i.client, 'Show to client') + '</div>' +
        (i.auto ? '<p class="sub small">Fills in by itself' + (i.auto_date ? ' (' + dlab(i.auto_date) + ')' : '') + '. Clear the date and untick Done to go back to automatic.</p>' : ''),
        function (F) { return { action: 'item', id: i.id, title: F.title, why: F.why, date: F.date, due: F.due, done: i.auto && !F.done && !F.date ? null : F.done, client: F.client }; }, post,
        { del: function () { post({ action: 'item', id: i.id, removed: true }, 'Removed for this client'); }, delLabel: 'Remove for this client' });
    }
    function customForm(phase, c, win) {
      var isWin = c ? c.win : !!win;
      open(c ? 'Edit ' + (isWin ? 'win' : 'step') : isWin ? 'Add a win' : 'Add a step or event', '<div class="jgrid">' + fld('Title', '<input name="title" value="' + esc(c ? c.title : '') + '" placeholder="' + (isWin ? 'Biggest sales day ever' : 'Video shoot') + '">', 1) +
        fld('Stage', phaseSel(c ? c.phase : phase)) + fld('Date', '<input type="date" name="date" value="' + esc(c ? c.date : isWin ? J.today : '') + '">') +
        fld('Planned for (if not done yet)', '<input type="date" name="due" value="' + esc(c ? c.due : '') + '">') + fld('Detail (one line)', '<input name="detail" value="' + esc(c && c.detail || '') + '">') + '</div>' +
        '<div class="jchks">' + chk('done', c ? c.done : true, 'Done') + chk('client', c ? c.client : true, 'Show to client') + chk('win', isWin, 'Count it as a win') + '</div>',
        function (F) { if (!F.title) return err('Give it a title.'); return { action: 'custom', id: c ? c.id : undefined, phase: F.phase, title: F.title, date: F.date, due: F.due, done: F.done, client: F.client, win: F.win, detail: F.detail }; }, post,
        c ? { del: function () { post({ action: 'custom_delete', id: c.id }, 'Deleted'); } } : null);
    }
    function winForm(w) {
      if (!w.auto) { var c = J.items.filter(function (i) { return i.custom && i.id === w.id; })[0]; if (c) return customForm(c.phase, c); }
      open('Edit win', fld('Title', '<input name="title" value="' + esc(w.title) + '">', 1) + fld('Detail', '<input name="detail" value="' + esc(w.detail || '') + '">', 1) + '<p class="small sub">Found automatically on ' + esc(dlab(w.date)) + '. Your wording replaces it everywhere the client sees it.</p>',
        function (F) { if (!F.title) return err('Give the win a title.'); return { action: 'win', id: w.id, title: F.title, detail: F.detail }; }, post,
        w.edited ? { del: function () { post({ action: 'win', id: w.id, title: '', detail: '', reset: true }, 'Back to the original wording'); }, delLabel: 'Use the original wording' } : null);
    }
    var lines = function (arr) { return (arr || []).map(function (x) { return typeof x === 'string' ? x : x.title + (x.detail ? ': ' + x.detail : ''); }).join('\n'); };
    var unlines = function (s) { return String(s || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { var i = l.indexOf(': '); return i > 0 ? { title: l.slice(0, i), detail: l.slice(i + 2) } : { title: l, detail: '' }; }); };
    function reportEdit(d) {
      var r = J.reports[d], t = r.text;
      open('Reword the ' + r.name + ' report', fld('Headline', '<input name="headline" value="' + esc(t.headline) + '">', 1) + fld('Summary', '<textarea name="summary" rows="3">' + esc(t.summary) + '</textarea>', 1) +
        fld('Progress (one per line, "Title: detail")', '<textarea name="progress" rows="4">' + esc(lines(t.progress || t.wins)) + '</textarea>', 1) +
        fld('Problems (one per line)', '<textarea name="problems" rows="3">' + esc(lines(t.problems || t.opportunities)) + '</textarea>', 1) +
        fld('Plans (one per line)', '<textarea name="plans" rows="4">' + esc(lines(t.plans || t.next_steps)) + '</textarea>', 1),
        function (F) { return { action: 'report_edit', days: Number(d), text: { headline: F.headline, summary: F.summary, progress: unlines(F.progress), problems: unlines(F.problems), plans: unlines(F.plans) } }; }, post, { label: 'Save wording' });
    }
    function reportView(d) {
      var r = J.reports[d];
      open(r.name + ' report', '<div class="jrview">' + (window.JR ? JR.report(Object.assign({ name: r.name }, r), { label: J.label }) : '') + '</div>', null, null, { label: 'Close' });
      M.querySelector('.jmbox').classList.add('wide');
    }

    el.onclick = function (e) {
      var t = e.target.closest('button,[data-act]'); if (!t || !J) return;
      var ds = t.dataset;
      if (M) M.querySelector('.jmbox').classList.remove('wide');
      if (ds.act === 'dates') { var k = el.querySelector('[data-d=kickoff]').value, l = el.querySelector('[data-d=launch]').value; return post({ action: 'dates', kickoff: k, launch: l }, 'Dates saved'); }
      if (ds.act === 'usekick') return post({ action: 'dates', kickoff: J.suggest.kickoff }, 'Kickoff date set');
      if (ds.act === 'rmap') return post({ action: 'roadmap', url: el.querySelector('[data-in=rmap]').value.trim() }, 'Link saved');
      if (ds.act === 'value') { var src = el.querySelector('input[name="vsrc_' + token + '"]:checked'); return post({ action: 'value', value: { on: el.querySelector('[data-in=von]').checked, source: src ? src.value : 'ads', close_rate: el.querySelector('[data-in=vcr]').value, avg_sale: el.querySelector('[data-in=vas]').value } }); }
      if (ds.act === 'addwin') return customForm('d30', null, true);
      if (ds.act === 'showrem') { SHOWREM = !SHOWREM; return draw(); }
      if (ds.ph) { OPEN[ds.ph] = t.getAttribute('aria-expanded') !== 'true'; return draw(); }
      if (ds.vis) { var i = itemBy(ds.vis); if (!i) return; i.client = !i.client; draw(); return i.custom ? post({ action: 'custom', id: i.id, phase: i.phase, title: i.title, date: i.date, due: i.due, done: i.done, client: i.client, win: i.win, detail: i.detail }, false) : post({ action: 'item', id: i.id, client: i.client }, false); }
      if (ds.iedit) { var it = itemBy(ds.iedit); if (it) itemForm(it); return; }
      if (ds.restore) return post({ action: 'item', id: ds.restore, removed: false }, 'Put back');
      if (ds.note != null) return noteForm(ds.note || null);
      if (ds.nedit) { var n = findNote(ds.nedit); if (n) noteForm(n.item || null, n); return; }
      if (ds.addev) return customForm(ds.addev);
      if (ds.wedit) { var w = winBy(ds.wedit); if (w) winForm(w); return; }
      if (ds.whide) { var w2 = winBy(ds.whide); if (!w2) return; w2.hidden = !w2.hidden; draw(); return post({ action: 'win', id: w2.id, hidden: w2.hidden }, false); }
      if (ds.rview) return reportView(ds.rview);
      if (ds.redit) return reportEdit(ds.redit);
      if (ds.rgen) {
        var r = J.reports[ds.rgen];
        if (r.text && !confirm('Replace the current ' + r.name + ' report with a new one?')) return;
        J.reports[ds.rgen] = Object.assign({}, r, { status: 'working', text: null }); draw(); busy(true);
        return api('POST', '', { token: token, action: 'report', days: Number(ds.rgen) }).then(function () { busy(false); load(true); }).catch(function (er) { busy(false); toast(er.message, 1); load(true); });
      }
    };
    el.onchange = function (e) {
      var t = e.target; if (!J) return;
      if (t.dataset.in === 'von') { var vs = el.querySelector('.vsrc'); if (vs) vs.hidden = !t.checked; return; }
      if (t.dataset.done) {
        // tick it straight away; the save happens in the background
        var i = itemBy(t.dataset.done); if (!i) return; var on = t.checked;
        i.done = on; i.date = on ? (i.date || J.today) : ''; draw();
        return i.custom ? post({ action: 'custom', id: i.id, phase: i.phase, title: i.title, date: i.date, due: i.due, done: on, client: i.client, win: i.win, detail: i.detail }, false)
          : post({ action: 'item', id: i.id, done: on, date: i.date }, false);
      }
      if (t.dataset.share) return post({ action: 'report_share', days: Number(t.dataset.share), shared: t.checked }, t.checked ? 'The client can see this report' : 'Report hidden from the client');
    };
    load();
    return { destroy: function () { alive = false; clearTimeout(POLL); el.onclick = el.onchange = null; }, reload: function () { load(true); }, setEnabled: function (on) { return post({ action: 'enabled', enabled: on }, on ? 'The client can see their journey' : 'Journey hidden from the client'); } };
  }
  window.VPMJourney = { mount: mount };
})();
