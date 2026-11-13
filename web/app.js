// Kitchen dashboard — chores.
// Data: Supabase (window.KD_ENV = {supabaseUrl, supabaseKey}) when configured, else this browser only.
// Every write goes to a local outbox first, so a Wi-Fi blip never loses a tap.
(function () {
  'use strict';

  var ENV = window.KD_ENV || {};
  var CFG = window.KD_CONFIG || { family: [], tiles: [] };
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
  function tint(hex, a) {   // '#rrggbb' → rgba(), for soft backgrounds
    var n = parseInt((hex || '#898781').slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function joinNames(list) {
    return list.length <= 2 ? list.join(' & ') : list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1];
  }

  // ---------- state ----------
  // tiles: [{id, name, icon, mode: 'single'|'split'|'choose', chores: [{id, name, icon, color}]}]
  function localTiles() {
    return (CFG.tiles || []).map(function (t) {
      var chores = t.chores && t.chores.length
        ? t.chores.map(function (c) { return { id: t.name + '/' + c.name, name: c.name, icon: c.icon, color: c.color }; })
        : [{ id: t.name, name: t.name, icon: t.icon, color: t.color }];
      return { id: t.name, name: t.name, icon: t.icon, mode: t.mode || 'single', chores: chores };
    });
  }
  // An icon from icons.js (falls back to the word if the icon is missing).
  function icon(key, label, cls) {
    var s = el('span', 'ic' + (cls ? ' ' + cls : ''));
    var svg = (window.KD_ICONS || {})[key];
    if (svg) s.innerHTML = svg; else s.textContent = label;
    s.setAttribute('aria-label', label);
    return s;
  }
  function localFamily() {
    return (CFG.family || []).map(function (p) { return { id: p.name, name: p.name, color: p.color }; });
  }
  var state = {
    family: REMOTE ? load('kd.family', []) : localFamily(),
    tiles: REMOTE ? load('kd.tiles', []) : localTiles(),
    log: load('kd.log', []),          // [{id, chore_id, person_id, done_at}]
    outbox: load('kd.outbox', []),    // [{op:'add'|'del', row}]
  };
  function persist() { save('kd.log', state.log); save('kd.outbox', state.outbox); }
  function person(id) { for (var i = 0; i < state.family.length; i++) if (state.family[i].id === id) return state.family[i]; return null; }

  // ---------- Supabase REST ----------
  function api(method, path, body, prefer) {
    var h = { apikey: ENV.supabaseKey, Authorization: 'Bearer ' + ENV.supabaseKey, 'Content-Type': 'application/json' };
    if (prefer) h.Prefer = prefer;
    return fetch(ENV.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path, {
      method: method, headers: h, body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error(method + ' ' + path + ' → ' + r.status);
      return method === 'GET' ? r.json() : null;
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
      api('GET', 'family?select=id,name,color&order=sort'),
      api('GET', 'tiles?select=id,name,icon,mode&active=is.true&order=sort'),
      api('GET', 'chores?select=id,tile_id,name,icon,color&active=is.true&order=sort'),
      api('GET', 'chore_log?select=id,chore_id,person_id,done_at&done_at=gte.' + since + '&order=done_at.desc&limit=3000'),
    ]).then(function (res) {
      var tiles = res[1].map(function (t) {
        return { id: t.id, name: t.name, mode: t.mode, chores: res[2].filter(function (c) { return c.tile_id === t.id; }) };
      }).filter(function (t) { return t.chores.length; });
      state.family = res[0]; state.tiles = tiles;
      save('kd.family', res[0]); save('kd.tiles', tiles);
      // Keep anything still waiting in the outbox on screen.
      var pendingAdd = {}, pendingDel = {};
      state.outbox.forEach(function (j) { (j.op === 'add' ? pendingAdd : pendingDel)[j.row.id] = j.row; });
      var seen = {};
      var log = res[3].filter(function (r) { seen[r.id] = 1; return !pendingDel[r.id]; });
      Object.keys(pendingAdd).forEach(function (id) { if (!seen[id]) log.push(pendingAdd[id]); });
      state.log = log; persist(); render();
    }).catch(function () { /* offline: keep the cached copy */ });
  }

  // ---------- actions ----------
  function record(choreIds, personIds) {
    var now = new Date().toISOString(), rows = [];
    choreIds.forEach(function (c) {
      personIds.forEach(function (p) {
        var row = { id: uuid(), chore_id: c, person_id: p, done_at: now };
        rows.push(row);
        state.log.unshift(row);
        state.outbox.push({ op: 'add', row: row });
      });
    });
    persist(); render(choreIds); flush();
    return rows;
  }
  function undo(rows) {
    rows.forEach(function (row) {
      state.log = state.log.filter(function (r) { return r.id !== row.id; });
      // If it never left the tablet, just drop it; otherwise queue a delete.
      var before = state.outbox.length;
      state.outbox = state.outbox.filter(function (j) { return !(j.op === 'add' && j.row.id === row.id); });
      if (state.outbox.length === before) state.outbox.push({ op: 'del', row: { id: row.id } });
    });
    persist(); render(); flush();
  }

  // ---------- time words ----------
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function ago(iso) {   // short: now, 5m, 3h, 2d
    var t = new Date(iso), now = new Date(), min = Math.round((now - t) / 6e4);
    if (min < 1) return 'now';
    if (min < 60) return min + 'm';
    var days = Math.round((startOfDay(now) - startOfDay(t)) / 864e5);
    if (days === 0) return Math.floor(min / 60) + 'h';
    return days + 'd';
  }
  function weekStart() { var d = startOfDay(new Date()); d.setDate(d.getDate() - d.getDay()); return d; } // Sunday

  // ---------- render ----------
  function renderClock() {
    var d = new Date();
    $('clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('date').textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  // Latest entry among these chores: who (everyone logged in that same tap), what, when.
  function latest(choreIds) {
    var ids = {}; choreIds.forEach(function (c) { ids[c] = 1; });
    var top = null;
    state.log.forEach(function (r) { if (ids[r.chore_id] && (!top || r.done_at > top.done_at)) top = r; });
    if (!top) return null;
    var t = new Date(top.done_at).getTime(), people = [], what = [];
    state.log.forEach(function (r) {
      if (!ids[r.chore_id] || Math.abs(new Date(r.done_at).getTime() - t) > 60000) return;
      if (people.indexOf(r.person_id) < 0) people.push(r.person_id);
      if (what.indexOf(r.chore_id) < 0) what.push(r.chore_id);
    });
    var fam = state.family.map(function (p) { return p.id; });
    people.sort(function (a, b) { return fam.indexOf(a) - fam.indexOf(b); });
    what.sort(function (a, b) { return choreIds.indexOf(a) - choreIds.indexOf(b); });
    return { at: top.done_at, people: people.map(person).filter(Boolean), what: what };
  }

  // A person's coloured initial.
  function badge(p, cls) {
    var b = el('span', cls || 'badge', p.name.charAt(0).toUpperCase());
    b.style.background = p.color;
    b.title = p.name;
    return b;
  }

  // Bottom of a tile: who (coloured initials), what (small icons, trash only), how long ago.
  // Also rings the tile in the person's colour if it was done today.
  function lastBlock(box, choreIds, chores) {
    var info = latest(choreIds), wrap = el('span', 'last');
    if (!info) return wrap;
    info.people.forEach(function (p) { wrap.appendChild(badge(p)); });
    if (chores) info.what.forEach(function (id) {
      var c = chores[id]; if (!c) return;
      var i = icon(c.icon, c.name, 'mini'); i.style.color = c.color; wrap.appendChild(i);
    });
    wrap.appendChild(el('span', 'when', ago(info.at)));
    if (new Date(info.at) >= startOfDay(new Date())) {
      box.classList.add('today');
      box.style.setProperty('--tc', info.people[0] ? info.people[0].color : 'var(--ok)');
    }
    return wrap;
  }

  function render(flashIds) {
    var flash = {}; (flashIds || []).forEach(function (id) { flash[id] = 1; });
    var tiles = $('tiles');
    tiles.innerHTML = '';
    state.tiles.forEach(function (t) {
      var ids = t.chores.map(function (c) { return c.id; });
      if (t.mode === 'split') {
        var box = el('div', 'tile split');
        box.setAttribute('aria-label', t.name);
        box.appendChild(icon(t.icon, t.name, 'head'));
        var halves = el('div', 'halves');
        t.chores.forEach(function (c) {
          var h = el('button', 'half');
          h.type = 'button';
          h.setAttribute('aria-label', t.name + ' ' + c.name);
          h.style.background = tint(c.color, 0.12);
          var ic = icon(c.icon, c.name, 'hicon'); ic.style.color = c.color;
          h.appendChild(ic);
          h.appendChild(lastBlock(h, [c.id]));
          if (flash[c.id]) h.classList.add('flash');
          h.addEventListener('click', function () { openFlow(t, [c]); });
          halves.appendChild(h);
        });
        box.appendChild(halves);
        tiles.appendChild(box);
        return;
      }
      var b = el('button', 'tile');
      b.type = 'button';
      b.setAttribute('aria-label', t.name);
      b.appendChild(icon(t.icon, t.name, 'main'));
      var byId = null;
      if (t.mode === 'choose') { byId = {}; t.chores.forEach(function (c) { byId[c.id] = c; }); }
      b.appendChild(lastBlock(b, ids, byId));
      if (ids.some(function (id) { return flash[id]; })) b.classList.add('flash');
      b.addEventListener('click', function () { openFlow(t, t.mode === 'choose' ? null : t.chores); });
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
  // Trash: tap bins (several allowed) → ✓ → tap a name. Everything else: tap a name. Done.
  var pickerTimer = null;
  function poke() { clearTimeout(pickerTimer); pickerTimer = setTimeout(closePicker, 30000); }

  // What the sheet is about, as icons: [tile icon, chore icon...]
  function setTitle(tile, chores) {
    var t = $('picker-title');
    t.innerHTML = '';
    t.appendChild(icon(tile.icon, tile.name, 'big'));
    (chores || []).forEach(function (c) {
      if (c.icon === tile.icon) return;
      var i = icon(c.icon, c.name, 'big'); i.style.color = c.color; t.appendChild(i);
    });
  }
  function showSheet() { $('picker').hidden = false; poke(); }

  function chooseBins(tile, done) {
    setTitle(tile, null);
    var box = $('options'), ok = $('confirm'), picked = [];
    box.innerHTML = '';
    box.className = 'bins';
    ok.hidden = false; ok.disabled = true;
    tile.chores.forEach(function (c) {
      var b = el('button', 'option bin');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', c.name);
      b.style.setProperty('--oc', c.color || 'var(--ink2)');
      var i = icon(c.icon, c.name, 'opt'); i.style.color = c.color; b.appendChild(i);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation(); poke();
        var k = picked.indexOf(c.id);
        if (k < 0) picked.push(c.id); else picked.splice(k, 1);
        b.setAttribute('aria-pressed', k < 0 ? 'true' : 'false');
        ok.disabled = !picked.length;
      });
      box.appendChild(b);
    });
    ok.onclick = function (ev) {
      ev.stopPropagation();
      if (picked.length) done(tile.chores.filter(function (c) { return picked.indexOf(c.id) >= 0; }));
    };
    showSheet();
  }

  function chooseWho(tile, chores) {
    setTitle(tile, tile.mode === 'single' ? null : chores);
    var box = $('options');
    box.innerHTML = '';
    box.className = 'people';
    $('confirm').hidden = true;
    state.family.forEach(function (p) {
      var b = el('button', 'option person');
      b.type = 'button';
      b.appendChild(badge(p, 'avatar'));
      b.appendChild(el('span', 'oname', p.name));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closePicker();
        var rows = record(chores.map(function (c) { return c.id; }), [p.id]);
        toast(tile, chores, p, rows);
      });
      box.appendChild(b);
    });
    showSheet();
  }

  function openFlow(tile, chores) {
    if (chores) chooseWho(tile, chores);
    else chooseBins(tile, function (picked) { chooseWho(tile, picked); });
  }
  function closePicker() { $('picker').hidden = true; clearTimeout(pickerTimer); }
  $('picker').addEventListener('click', function (ev) { if (ev.target === $('picker')) closePicker(); });

  // ---------- toast: ✓ [icons] (P) Papa  [undo] ----------
  var toastTimer = null, toastRows = null;
  function toast(tile, chores, p, rows) {
    toastRows = rows;
    var t = $('toast-text');
    t.innerHTML = '';
    t.appendChild(el('span', 'tick', '✓'));
    t.appendChild(icon(tile.icon, tile.name, 'tic'));
    if (tile.mode !== 'single') chores.forEach(function (c) {
      var i = icon(c.icon, c.name, 'tic'); i.style.color = c.color; t.appendChild(i);
    });
    t.appendChild(badge(p));
    t.appendChild(el('span', 'tname', p.name));
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; toastRows = null; }, 6000);
  }
  $('undo').addEventListener('click', function () {
    if (toastRows) undo(toastRows);
    $('toast').hidden = true; toastRows = null; clearTimeout(toastTimer);
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
