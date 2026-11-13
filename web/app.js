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
  // tiles: [{id, name, mode: 'single'|'split'|'choose', chores: [{id, name, color}]}]
  function localTiles() {
    return (CFG.tiles || []).map(function (t) {
      var chores = t.chores && t.chores.length
        ? t.chores.map(function (c) { return { id: t.name + '/' + c.name, name: c.name, color: c.color }; })
        : [{ id: t.name, name: t.name, color: t.color }];
      return { id: t.name, name: t.name, mode: t.mode || 'single', chores: chores };
    });
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
      api('GET', 'tiles?select=id,name,mode&active=is.true&order=sort'),
      api('GET', 'chores?select=id,tile_id,name,color&active=is.true&order=sort'),
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

  // Bottom of a tile: "● Dad & Mom" then "Recycling · 2 h ago". Marks the tile done today.
  function lastBlock(box, choreIds, names) {
    var info = latest(choreIds), wrap = el('span', 'last');
    if (!info) { wrap.appendChild(el('span', 'when', 'Not yet')); return wrap; }
    var who = el('span', 'who');
    info.people.forEach(function (p) { var d = el('i', 'dot'); d.style.background = p.color; who.appendChild(d); });
    who.appendChild(el('b', null, joinNames(info.people.map(function (p) { return p.name; })) || '?'));
    wrap.appendChild(who);
    var what = names ? info.what.map(function (id) { return names[id]; }).filter(Boolean).join(', ') : '';
    if (what) wrap.appendChild(el('span', 'what', what));
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
        box.appendChild(el('span', 'name', t.name));
        var halves = el('div', 'halves');
        t.chores.forEach(function (c) {
          var h = el('button', 'half');
          h.type = 'button';
          h.style.background = tint(c.color, 0.10);
          var label = el('span', 'hname', c.name); label.style.color = c.color;
          h.appendChild(label);
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
      b.appendChild(el('span', 'name', t.name));
      var names = null;
      if (t.mode === 'choose') { names = {}; t.chores.forEach(function (c) { names[c.id] = c.name; }); }
      b.appendChild(lastBlock(b, ids, names));
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

  // ---------- picker: (which ones?) → who? → ✓ ----------
  var pickerTimer = null;
  function poke() { clearTimeout(pickerTimer); pickerTimer = setTimeout(closePicker, 30000); }

  // choices: [{id, label, color, avatar?}] → calls done(selectedIds) when ✓ is tapped.
  function step(title, hint, choices, done) {
    $('picker-title').textContent = title;
    $('picker-hint').textContent = hint;
    var box = $('options'), ok = $('confirm'), picked = [];
    box.innerHTML = '';
    ok.disabled = true;
    choices.forEach(function (ch) {
      var b = el('button', 'option');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.style.setProperty('--oc', ch.color || 'var(--ink2)');
      var badge = el('span', ch.avatar ? 'avatar' : 'swatch', ch.avatar || '');
      badge.style.background = ch.color || 'var(--ink2)';
      b.appendChild(badge);
      b.appendChild(el('span', 'oname', ch.label));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation(); poke();
        var i = picked.indexOf(ch.id);
        if (i < 0) picked.push(ch.id); else picked.splice(i, 1);
        b.setAttribute('aria-pressed', i < 0 ? 'true' : 'false');
        ok.disabled = !picked.length;
      });
      box.appendChild(b);
    });
    ok.onclick = function (ev) {
      ev.stopPropagation();
      if (!picked.length) return;
      // Keep the on-screen order, not the tap order.
      done(choices.map(function (c) { return c.id; }).filter(function (id) { return picked.indexOf(id) >= 0; }));
    };
    $('picker').hidden = false;
    poke();
  }

  function openFlow(tile, chores) {
    var title = tile.mode === 'split' && chores ? tile.name + ' · ' + chores[0].name : tile.name;
    function askWho(picked) {
      step(title, 'Who did it?', state.family.map(function (p) {
        return { id: p.id, label: p.name, color: p.color, avatar: p.name.charAt(0).toUpperCase() };
      }), function (people) {
        closePicker();
        var rows = record(picked.map(function (c) { return c.id; }), people);
        var what = tile.mode === 'choose' ? picked.map(function (c) { return c.name; }).join(', ') : title;
        toast(what + ' · ' + joinNames(people.map(function (id) { return person(id).name; })), rows);
      });
    }
    if (chores) { askWho(chores); return; }
    step(tile.name, 'Which ones?', tile.chores.map(function (c) {
      return { id: c.id, label: c.name, color: c.color };
    }), function (ids) {
      askWho(tile.chores.filter(function (c) { return ids.indexOf(c.id) >= 0; }));
    });
  }
  function closePicker() { $('picker').hidden = true; clearTimeout(pickerTimer); }
  $('picker').addEventListener('click', function (ev) { if (ev.target === $('picker')) closePicker(); });

  // ---------- toast ----------
  var toastTimer = null, toastRows = null;
  function toast(text, rows) {
    toastRows = rows;
    $('toast-text').textContent = '✓ ' + text;
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
