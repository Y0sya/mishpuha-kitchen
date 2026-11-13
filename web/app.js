// Kitchen dashboard — chores.
// Data: Supabase (window.KD_ENV = {supabaseUrl, supabaseKey}) when configured, else this browser only.
// Every write goes to a local outbox first, so a Wi-Fi blip never loses a tap.
(function () {
  'use strict';

  var ENV = window.KD_ENV || {};
  var CFG = window.KD_CONFIG || { family: [], chores: [] };
  var REMOTE = !!(ENV.supabaseUrl && ENV.supabaseKey);
  var LOG_DAYS = 35;

  // ---------- tiny helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  // ---------- state ----------
  var state = {
    family: load('kd.family', null) || CFG.family.map(function (p, i) { return { id: p.name, name: p.name, color: p.color, sort: i }; }),
    chores: load('kd.chores', null) || CFG.chores.map(function (c, i) { return { id: c, name: c, sort: i }; }),
    log: load('kd.log', []),          // [{id, chore_id, person_id, done_at}]
    outbox: load('kd.outbox', []),    // [{op:'add'|'del', row}]
  };
  if (!REMOTE) {
    // Local mode: config.js is the source of truth for people and chores.
    state.family = CFG.family.map(function (p, i) { return { id: p.name, name: p.name, color: p.color, sort: i }; });
    state.chores = CFG.chores.map(function (c, i) { return { id: c, name: c, sort: i }; });
  }
  function persist() { save('kd.log', state.log); save('kd.outbox', state.outbox); }
  function person(id) { for (var i = 0; i < state.family.length; i++) if (state.family[i].id === id) return state.family[i]; return null; }
  function chore(id) { for (var i = 0; i < state.chores.length; i++) if (state.chores[i].id === id) return state.chores[i]; return null; }

  // ---------- Supabase REST ----------
  function api(method, path, body, prefer) {
    var h = { apikey: ENV.supabaseKey, Authorization: 'Bearer ' + ENV.supabaseKey, 'Content-Type': 'application/json' };
    if (prefer) h.Prefer = prefer;
    return fetch(ENV.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path, {
      method: method, headers: h, body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status);
      return r.status === 204 || method !== 'GET' ? null : r.json();
    });
  }

  var flushing = false;
  function flush() {
    if (!REMOTE || flushing || !state.outbox.length) return Promise.resolve();
    flushing = true;
    var job = state.outbox[0];
    var p = job.op === 'add'
      ? api('POST', 'chore_log?on_conflict=id', job.row, 'resolution=ignore-duplicates,return=minimal')
      : api('DELETE', 'chore_log?id=eq.' + encodeURIComponent(job.row.id));
    return p.then(function () {
      state.outbox.shift(); persist(); flushing = false; return flush();
    }, function () { flushing = false; });
  }

  function pull() {
    if (!REMOTE) return Promise.resolve();
    var since = new Date(Date.now() - LOG_DAYS * 864e5).toISOString();
    return Promise.all([
      api('GET', 'family?select=id,name,color,sort&order=sort'),
      api('GET', 'chores?select=id,name,sort&active=is.true&order=sort'),
      api('GET', 'chore_log?select=id,chore_id,person_id,done_at&done_at=gte.' + since + '&order=done_at.desc&limit=2000'),
    ]).then(function (res) {
      state.family = res[0]; state.chores = res[1];
      save('kd.family', res[0]); save('kd.chores', res[1]);
      // Keep anything still waiting in the outbox on screen.
      var pendingAdd = {}, pendingDel = {};
      state.outbox.forEach(function (j) { (j.op === 'add' ? pendingAdd : pendingDel)[j.row.id] = j.row; });
      var seen = {};
      var log = res[2].filter(function (r) { seen[r.id] = 1; return !pendingDel[r.id]; });
      Object.keys(pendingAdd).forEach(function (id) { if (!seen[id]) log.push(pendingAdd[id]); });
      state.log = log; persist(); render();
    }).catch(function () { /* offline: keep the cached copy */ });
  }

  // ---------- actions ----------
  function record(choreId, personId) {
    var row = { id: uuid(), chore_id: choreId, person_id: personId, done_at: new Date().toISOString() };
    state.log.unshift(row);
    state.outbox.push({ op: 'add', row: row });
    persist(); render(choreId); flush();
    return row;
  }
  function undo(row) {
    state.log = state.log.filter(function (r) { return r.id !== row.id; });
    // If it never left the tablet, just drop it; otherwise queue a delete.
    var before = state.outbox.length;
    state.outbox = state.outbox.filter(function (j) { return !(j.op === 'add' && j.row.id === row.id); });
    if (state.outbox.length === before) state.outbox.push({ op: 'del', row: { id: row.id } });
    persist(); render(); flush();
  }

  // ---------- time words ----------
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function ago(iso) {
    var t = new Date(iso), now = new Date(), min = Math.round((now - t) / 6e4);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    var days = Math.round((startOfDay(now) - startOfDay(t)) / 864e5);
    if (days === 0) return Math.floor(min / 60) + ' h ago';
    if (days === 1) return 'yesterday';
    if (days < 7) return DAYS[t.getDay()];
    return days + ' days ago';
  }
  function weekStart() { var d = startOfDay(new Date()); d.setDate(d.getDate() - d.getDay()); return d; } // Sunday

  // ---------- render ----------
  function renderClock() {
    var d = new Date();
    $('clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('date').textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function render(flashId) {
    var last = {};
    state.log.forEach(function (r) { if (!last[r.chore_id] || r.done_at > last[r.chore_id].done_at) last[r.chore_id] = r; });
    var today = startOfDay(new Date()).getTime();

    var tiles = $('tiles');
    tiles.innerHTML = '';
    state.chores.forEach(function (c) {
      var b = el('button', 'tile');
      b.type = 'button';
      b.appendChild(el('span', 'name', c.name));
      var line = el('span', 'last');
      var r = last[c.id], p = r && person(r.person_id);
      if (r) {
        var dot = el('i', 'dot'); dot.style.background = p ? p.color : 'var(--muted)';
        line.appendChild(dot);
        line.appendChild(el('b', null, p ? p.name : '?'));
        line.appendChild(document.createTextNode(' · ' + ago(r.done_at)));
        if (new Date(r.done_at).getTime() >= today) { b.classList.add('today'); b.style.setProperty('--tc', p ? p.color : 'var(--ok)'); }
      } else {
        line.textContent = 'Not yet';
      }
      b.appendChild(line);
      if (flashId === c.id) b.classList.add('flash');
      b.addEventListener('click', function () { openPicker(c); });
      tiles.appendChild(b);
    });

    var ws = weekStart().getTime(), counts = {};
    state.log.forEach(function (r) { if (new Date(r.done_at).getTime() >= ws) counts[r.person_id] = (counts[r.person_id] || 0) + 1; });
    var week = $('week');
    week.innerHTML = '';
    week.appendChild(el('span', 'label', 'This week'));
    state.family.forEach(function (p) {
      var w = el('span', 'who');
      var dot = el('i', 'dot'); dot.style.background = p.color;
      w.appendChild(dot);
      w.appendChild(document.createTextNode(p.name + ' '));
      w.appendChild(el('span', 'n', String(counts[p.id] || 0)));
      week.appendChild(w);
    });
  }

  // ---------- picker ----------
  var pickerTimer = null;
  function openPicker(c) {
    $('picker-title').textContent = c.name;
    var box = $('people');
    box.innerHTML = '';
    state.family.forEach(function (p) {
      var b = el('button', 'person');
      b.type = 'button';
      var av = el('span', 'avatar', p.name.charAt(0).toUpperCase()); av.style.background = p.color;
      b.appendChild(av);
      b.appendChild(el('span', 'pname', p.name));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closePicker();
        var row = record(c.id, p.id);
        toast(c.name + ' · ' + p.name, row);
      });
      box.appendChild(b);
    });
    $('picker').hidden = false;
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(closePicker, 20000);
  }
  function closePicker() { $('picker').hidden = true; clearTimeout(pickerTimer); }
  $('picker').addEventListener('click', function (ev) { if (ev.target === $('picker')) closePicker(); });

  // ---------- toast ----------
  var toastTimer = null, toastRow = null;
  function toast(text, row) {
    toastRow = row;
    $('toast-text').textContent = '✓ ' + text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; toastRow = null; }, 6000);
  }
  $('undo').addEventListener('click', function () {
    if (toastRow) undo(toastRow);
    $('toast').hidden = true; toastRow = null; clearTimeout(toastTimer);
  });

  // No long-press menus, no pinch, no accidental text selection.
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- burn-in care ----------
  var awakeUntil = 0;
  function isNight() {
    var n = CFG.night; if (!n) return false;
    var h = new Date().getHours();
    return n.from > n.to ? (h >= n.from || h < n.to) : (h >= n.from && h < n.to);
  }
  function sleepCheck() { $('sleep').hidden = !(isNight() && Date.now() > awakeUntil); }
  $('sleep').addEventListener('click', function () { awakeUntil = Date.now() + 120000; sleepCheck(); });
  document.addEventListener('click', function () { if (isNight()) awakeUntil = Date.now() + 120000; }, true);
  function drift() {   // move everything a few pixels so no pixel shows the same thing all day
    var x = Math.round(Math.random() * 8 - 4), y = Math.round(Math.random() * 8 - 4);
    document.body.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  // ---------- go ----------
  renderClock(); render(); sleepCheck();
  setInterval(sleepCheck, 15000);
  setInterval(drift, 5 * 60000);
  setInterval(renderClock, 10000);
  setInterval(function () { render(); }, 60000);   // refresh "x min ago"
  setInterval(function () { flush().then(pull); }, 30000);
  window.addEventListener('online', function () { flush().then(pull); });
  flush().then(pull);
})();
