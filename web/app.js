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
        ? t.chores.map(function (c) { return { id: t.name + '/' + c.name, name: c.name, icon: c.icon, color: c.color, actions: c.actions }; })
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
    return (CFG.family || []).map(function (p) { return { id: p.name, name: p.name, color: p.color, initials: p.initials }; });
  }
  var state = {
    family: REMOTE ? load('kd.family', []) : localFamily(),
    tiles: REMOTE ? load('kd.tiles', []) : localTiles(),
    log: load('kd.log', []),          // [{id, chore_id, person_id, done_at}]
    outbox: load('kd.outbox', []),    // chores: {op:'add'|'del', row}; groceries: {table:'shopping', op:'put'|'drop', row}
    shop: load('kd.shop', []),        // open grocery rows [{id, item, people:[ids], kind:'finished'|'request', source, added_at, bought_at}]
    seen: load('kd.shopnames', {}),   // every item ever listed → {name, n}, for suggestions
  };
  function persist() {
    save('kd.log', state.log); save('kd.outbox', state.outbox);
    save('kd.shop', state.shop); save('kd.shopnames', state.seen);
  }
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
    var job = state.outbox[0], p;
    if (job.table === 'shopping') {
      p = job.op === 'put'
        ? api('POST', 'shopping?on_conflict=id', job.row, 'resolution=merge-duplicates,return=minimal')
        : api('DELETE', 'shopping?id=eq.' + encodeURIComponent(job.row.id));
    } else {
      p = job.op === 'add'
        ? api('POST', 'chore_log?on_conflict=id', job.row, 'resolution=ignore-duplicates,return=minimal')
        : api('DELETE', 'chore_log?id=eq.' + encodeURIComponent(job.row.id));
    }
    return p.then(function () {
      state.outbox.shift(); persist(); flushing = false; return flush();
    }, function () { flushing = false; });
  }

  function pull() {
    if (!REMOTE) return Promise.resolve();
    var since = new Date(Date.now() - LOG_DAYS * 864e5).toISOString();
    return Promise.all([
      api('GET', 'family?select=id,name,color,initials&order=sort'),
      api('GET', 'tiles?select=id,name,icon,mode&active=is.true&order=sort'),
      api('GET', 'chores?select=id,tile_id,name,icon,color,actions&active=is.true&order=sort'),
      api('GET', 'chore_log?select=id,chore_id,person_id,action,done_at&done_at=gte.' + since + '&order=done_at.desc&limit=3000'),
      api('GET', 'shopping?select=id,item,people,kind,source,added_at,bought_at&bought_at=is.null&order=added_at'),
    ]).then(function (res) {
      var tiles = res[1].map(function (t) {
        return { id: t.id, name: t.name, icon: t.icon, mode: t.mode, chores: res[2].filter(function (c) { return c.tile_id === t.id; }) };
      }).filter(function (t) { return t.chores.length; });
      state.family = res[0]; state.tiles = tiles;
      save('kd.family', res[0]); save('kd.tiles', tiles);
      // Keep anything still waiting in the outbox on screen.
      var pendingAdd = {}, pendingDel = {};
      state.outbox.forEach(function (j) { if (!j.table) (j.op === 'add' ? pendingAdd : pendingDel)[j.row.id] = j.row; });
      var seen = {};
      var log = res[3].filter(function (r) { seen[r.id] = 1; return !pendingDel[r.id]; });
      Object.keys(pendingAdd).forEach(function (id) { if (!seen[id]) log.push(pendingAdd[id]); });
      state.log = log;
      // Groceries: the server's open list, with this tablet's unsent changes on top.
      var mine = {};
      state.outbox.forEach(function (j) { if (j.table === 'shopping') mine[j.row.id] = j; });
      var shop = res[4].filter(function (r) { return !mine[r.id]; }).map(function (r) { r.people = r.people || []; return r; });
      Object.keys(mine).forEach(function (id) { if (mine[id].op === 'put' && !mine[id].row.bought_at) shop.push(mine[id].row); });
      shop.forEach(function (r) { if (!state.seen[norm(r.item)]) remember(r.item); });
      state.shop = shop;
      persist(); render(); renderGrocery();
    }).catch(function () { /* offline: keep the cached copy */ });
  }

  // ---------- actions ----------
  // actions: e.g. ['Unload', 'Reload'] for the dishwasher (one row each); omit for most chores.
  // The same person logging the same thing again within 5 minutes is a double tap: ignored.
  var REPEAT_MS = 5 * 60000;
  function isRepeat(c, p, a) {
    var cutoff = Date.now() - REPEAT_MS;
    return state.log.some(function (r) {
      return r.chore_id === c && r.person_id === p && (r.action || null) === (a || null) &&
        new Date(r.done_at).getTime() > cutoff;
    });
  }
  function record(choreIds, personIds, actions) {
    var now = new Date().toISOString(), rows = [];
    choreIds.forEach(function (c) {
      personIds.forEach(function (p) {
        (actions && actions.length ? actions : [null]).forEach(function (a) {
          if (isRepeat(c, p, a)) return;
          var row = { id: uuid(), chore_id: c, person_id: p, done_at: now };
          if (a) row.action = a;
          rows.push(row);
          state.log.unshift(row);
          state.outbox.push({ op: 'add', row: row });
        });
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
  // When it was done, as short as possible: "14:17" today, "Thu" this week, "Nov 3" before.
  function stamp(iso) {
    var t = new Date(iso);
    var days = Math.round((startOfDay(new Date()) - startOfDay(t)) / 864e5);
    if (days === 0) return t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0');
    if (days < 7) return DAYS[t.getDay()].slice(0, 3);
    return MONTHS[t.getMonth()].slice(0, 3) + ' ' + t.getDate();
  }

  // ---------- render ----------
  function renderClock() {
    var d = new Date();
    $('clock').textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('date').textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  // Latest entry among these chores: who, what, when. Entries up to `windowMs` before it count
  // as the same go: 1 s (one tap) normally; for the dishwasher a few hours, so Unload then
  // Reload shows as Both.
  function latest(choreIds, windowMs) {
    var ids = {}; choreIds.forEach(function (c) { ids[c] = 1; });
    var top = null, win = windowMs || 1000;
    state.log.forEach(function (r) { if (ids[r.chore_id] && (!top || r.done_at > top.done_at)) top = r; });
    if (!top) return null;
    var t = new Date(top.done_at).getTime(), people = [], what = [], acts = [];
    state.log.forEach(function (r) {
      var rt = new Date(r.done_at).getTime();
      if (!ids[r.chore_id] || rt > t + 1000 || rt < t - win) return;
      if (people.indexOf(r.person_id) < 0) people.push(r.person_id);
      if (what.indexOf(r.chore_id) < 0) what.push(r.chore_id);
      if (r.action && acts.indexOf(r.action) < 0) acts.push(r.action);
    });
    var fam = state.family.map(function (p) { return p.id; });
    people.sort(function (a, b) { return fam.indexOf(a) - fam.indexOf(b); });
    what.sort(function (a, b) { return choreIds.indexOf(a) - choreIds.indexOf(b); });
    return { at: top.done_at, people: people.map(person).filter(Boolean), what: what, actions: acts };
  }

  // A person's coloured initial.
  function badge(p, cls) {
    var ini = (p.initials || p.name.charAt(0)).toUpperCase();
    var b = el('span', (cls || 'badge') + (ini.length > 1 ? ' two' : ''), ini);
    b.style.background = p.color;
    b.title = p.name;
    return b;
  }

  // Bottom of a tile: who (coloured initials), what (small icons, trash only), how long ago.
  // Also rings the tile in the person's colour if it was done today.
  var CYCLE_MS = 3 * 3600e3;   // dishwasher Unload + Reload, or trash bins, within 3 h show together
  function lastBlock(box, choreIds, chores, windowMs) {
    var info = latest(choreIds, windowMs), wrap = el('span', 'last');
    if (!info) return wrap;
    info.people.forEach(function (p) { wrap.appendChild(badge(p)); });
    if (chores) info.what.forEach(function (id) {
      var c = chores[id]; if (!c) return;
      var i = icon(c.icon, c.name, 'mini'); i.style.color = c.color; wrap.appendChild(i);
    });
    var ak = actionIcon(info.actions);
    if (ak) wrap.appendChild(icon(ak, info.actions.join(' & '), 'mini act'));
    wrap.appendChild(el('span', 'when', stamp(info.at)));
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
          h.appendChild(lastBlock(h, [c.id], null, c.actions && c.actions.length ? CYCLE_MS : 0));
          if (flash[c.id]) h.classList.add('flash');
          holdable(h, function () { openHistory(t, [c]); });
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
      b.appendChild(lastBlock(b, ids, byId, t.mode === 'choose' ? CYCLE_MS : 0));   // trash: bins taken out together
      if (ids.some(function (id) { return flash[id]; })) b.classList.add('flash');
      holdable(b, function () { openHistory(t, t.chores); });
      b.addEventListener('click', function () { openFlow(t, t.mode === 'choose' ? null : t.chores); });
      tiles.appendChild(b);
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
    $('entry').hidden = true;
    $('picker').classList.remove('top');
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

  // Unload / Reload / Both (dishwasher): one tap, then on to who.
  var ACTION_ICON = { unload: 'unload', reload: 'reload', both: 'both' };
  function actionIcon(acts) {
    if (!acts || !acts.length) return null;
    return acts.length > 1 ? 'both' : ACTION_ICON[String(acts[0]).toLowerCase()] || null;
  }
  // Sheet title: the tile's icon(s), then the chore in plain words.
  function titleWith(tile, chores, text) {
    var t = $('picker-title');
    t.innerHTML = '';
    t.appendChild(icon(tile.icon, tile.name, 'tin'));
    if (tile.mode === 'split') (chores || []).forEach(function (c) {
      var i = icon(c.icon, c.name, 'tin'); i.style.color = c.color; t.appendChild(i);
    });
    t.appendChild(el('span', 'ptitle', text));
  }

  function chooseAction(tile, chore, done) {
    titleWith(tile, [chore], tile.name + ' · ' + chore.name);
    $('entry').hidden = true;
    $('confirm').hidden = true;
    $('picker').classList.remove('top');
    var box = $('options');
    box.innerHTML = '';
    box.className = 'acts';
    chore.actions.concat(chore.actions.length > 1 ? ['Both'] : []).forEach(function (a) {
      var b = el('button', 'option act');
      b.type = 'button';
      var i = icon(ACTION_ICON[a.toLowerCase()] || 'both', a, 'opt'); i.style.color = chore.color; b.appendChild(i);
      b.appendChild(el('span', 'oname', a));
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        done(a === 'Both' ? chore.actions.slice() : [a]);
      });
      box.appendChild(b);
    });
    showSheet();
  }

  // onPick(person) replaces the default (record the chores) — used by groceries.
  function chooseWho(tile, chores, onPick, actions) {
    if (!onPick) {
      // Spell the chore out here, in case an icon on the tile isn't obvious.
      var parts = [tile.name];
      if (tile.mode !== 'single') parts.push(chores.map(function (c) { return c.name; }).join(', '));
      if (actions && actions.length) parts.push(actions.join(' & '));
      titleWith(tile, chores, parts.join(' · '));
    }
    $('entry').hidden = true;
    $('picker').classList.remove('top');
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
        if (onPick) { onPick(p); return; }
        var rows = record(chores.map(function (c) { return c.id; }), [p.id], actions);
        toast(tile, chores, p, rows, actions);
      });
      box.appendChild(b);
    });
    showSheet();
  }

  function openFlow(tile, chores) {
    if (chores && chores.length === 1 && chores[0].actions && chores[0].actions.length) {
      chooseAction(tile, chores[0], function (acts) { chooseWho(tile, chores, null, acts); });
    } else if (chores) chooseWho(tile, chores);
    else chooseBins(tile, function (picked) { chooseWho(tile, picked); });
  }
  function closePicker() { $('picker').hidden = true; clearTimeout(pickerTimer); }
  $('picker').addEventListener('click', function (ev) { if (ev.target === $('picker')) closePicker(); });

  // ---------- toast: ✓ [icons] (P) Papa  [undo] ----------
  var toastTimer = null, toastUndo = null;
  function showToast(undoFn) {
    toastUndo = undoFn;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; toastUndo = null; }, 6000);
  }
  function toast(tile, chores, p, rows, actions) {
    var t = $('toast-text');
    t.innerHTML = '';
    t.appendChild(el('span', 'tick', '✓'));
    t.appendChild(icon(tile.icon, tile.name, 'tic'));
    if (tile.mode !== 'single') chores.forEach(function (c) {
      var i = icon(c.icon, c.name, 'tic'); i.style.color = c.color; t.appendChild(i);
    });
    var ak = actionIcon(actions);
    if (ak) t.appendChild(icon(ak, actions.join(' & '), 'tic'));
    t.appendChild(badge(p));
    t.appendChild(el('span', 'tname', p.name));
    showToast(function () { undo(rows); });
  }
  $('undo').addEventListener('click', function () {
    if (toastUndo) toastUndo();
    $('toast').hidden = true; toastUndo = null; clearTimeout(toastTimer);
  });

  // No long-press menus, no pinch, no accidental text selection.
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- hold a tile: recent entries, remove one ----------
  // Calls onHold after ~0.6 s of pressing, and swallows the tap that follows the release.
  function holdable(node, onHold) {
    var timer = null, held = false;
    node.addEventListener('pointerdown', function () {
      held = false;
      clearTimeout(timer);
      timer = setTimeout(function () { held = true; if (navigator.vibrate) navigator.vibrate(25); onHold(); }, 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) {
      node.addEventListener(e, function () { clearTimeout(timer); });
    });
    node.addEventListener('click', function (ev) {
      if (held) { held = false; ev.stopImmediatePropagation(); ev.preventDefault(); }
    });
  }

  function when(iso) {   // "Today 14:17", "Thu 14:17", "Nov 3 14:17"
    var d = new Date(iso), days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);
    var day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? DAYS[d.getDay()].slice(0, 3)
      : MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
    return day + ' ' + hhmm(iso);
  }

  function openHistory(tile, chores) {
    var ids = {}, names = {};
    chores.forEach(function (c) { ids[c.id] = 1; names[c.id] = c.name; });
    var title = tile.name + (tile.mode === 'split' ? ' · ' + chores[0].name : '');
    var rows = state.log.filter(function (r) { return ids[r.chore_id]; })
      .sort(function (a, b) { return a.done_at < b.done_at ? 1 : -1; }).slice(0, 10);

    titleWith(tile, chores, title);
    $('entry').hidden = true;
    $('confirm').hidden = true;
    $('picker').classList.remove('top');
    var box = $('options');
    box.innerHTML = '';
    box.className = 'history';
    if (!rows.length) box.appendChild(el('div', 'hempty', 'Nothing yet'));
    rows.forEach(function (r) {
      var p = person(r.person_id) || { name: '?', color: 'var(--muted)' };
      var line = el('div', 'hrow');
      line.appendChild(badge(p));
      line.appendChild(el('span', 'hname', p.name));
      var what = [tile.mode === 'choose' ? names[r.chore_id] : '', r.action || ''].filter(Boolean).join(' · ');
      if (what) line.appendChild(el('span', 'hwhat', what));
      line.appendChild(el('span', 'hwhen', when(r.done_at)));
      var x = el('button', 'hdel', 'Remove');
      x.type = 'button';
      x.addEventListener('click', function (ev) {
        ev.stopPropagation(); poke();
        askRemove(tile, chores, r, p, (what ? what + ' · ' : '') + when(r.done_at));
      });
      line.appendChild(x);
      box.appendChild(line);
    });
    showSheet();
  }

  function askRemove(tile, chores, row, p, what) {
    var box = $('options');
    box.innerHTML = '';
    box.className = 'history';
    var q = el('div', 'hask');
    q.appendChild(el('div', 'hq', 'Are you sure?'));
    var sum = el('div', 'hsum');
    sum.appendChild(badge(p));
    sum.appendChild(el('span', null, p.name + ' · ' + what));
    q.appendChild(sum);
    var btns = el('div', 'hbtns');
    var no = el('button', 'hno', 'Cancel'); no.type = 'button';
    var yes = el('button', 'hyes', 'Remove'); yes.type = 'button';
    no.addEventListener('click', function (ev) { ev.stopPropagation(); openHistory(tile, chores); });
    yes.addEventListener('click', function (ev) {
      ev.stopPropagation();
      undo([row]);
      openHistory(tile, chores);
    });
    btns.appendChild(no); btns.appendChild(yes);
    q.appendChild(btns);
    box.appendChild(q);
    poke();
  }

  // ---------- groceries ----------
  // One running list. "Finished" and "Request" both put an item on it; if it's already
  // there, the person's initial is added to that row instead. Tap a row once it's bought.
  function norm(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function nice(name) { var n = String(name).trim().replace(/\s+/g, ' '); return n.charAt(0).toUpperCase() + n.slice(1); }
  function remember(item) {
    var k = norm(item);
    if (k) state.seen[k] = { name: nice(item), n: ((state.seen[k] || {}).n || 0) + 1 };
  }
  function putShop(row) { state.outbox.push({ table: 'shopping', op: 'put', row: JSON.parse(JSON.stringify(row)) }); }
  function shopChanged(flashId) { persist(); renderGrocery(flashId); flush(); }

  function addGrocery(name, kind, p) {
    var k = norm(name);
    if (!k) return;
    var row = null, undoFn;
    state.shop.forEach(function (r) { if (!row && !r.bought_at && norm(r.item) === k) row = r; });
    if (row) {                                   // already on the list: just add who
      var had = row.people.slice(), hadKind = row.kind;
      if (row.people.indexOf(p.id) < 0) row.people.push(p.id);
      if (kind === 'finished') row.kind = 'finished';
      putShop(row);
      undoFn = function () { row.people = had; row.kind = hadKind; putShop(row); shopChanged(); };
    } else {
      row = { id: uuid(), item: nice(name), people: [p.id], kind: kind, source: 'tablet',
              added_at: new Date().toISOString(), bought_at: null };
      state.shop.push(row);
      remember(row.item);
      putShop(row);
      undoFn = function () {
        state.shop = state.shop.filter(function (r) { return r.id !== row.id; });
        state.outbox.push({ table: 'shopping', op: 'drop', row: { id: row.id } });
        shopChanged();
      };
    }
    shopChanged(row.id);
    var t = $('toast-text');
    t.innerHTML = '';
    t.appendChild(el('span', 'tick', '✓'));
    t.appendChild(icon(kind, '', 'tic'));
    t.appendChild(el('span', 'tname', row.item));
    t.appendChild(badge(p));
    showToast(undoFn);
  }

  function bought(row) {
    row.bought_at = new Date().toISOString();
    putShop(row);
    state.shop = state.shop.filter(function (r) { return r.id !== row.id; });
    shopChanged();
    var t = $('toast-text');
    t.innerHTML = '';
    t.appendChild(el('span', 'tick', '✓'));
    t.appendChild(icon('cart', '', 'tic'));
    t.appendChild(el('span', 'tname', row.item));
    showToast(function () { row.bought_at = null; putShop(row); state.shop.push(row); shopChanged(); });
  }

  function renderGrocery(flashId) {
    var list = $('glist');
    list.innerHTML = '';
    var rows = state.shop.filter(function (r) { return !r.bought_at; })
      .sort(function (a, b) { return a.added_at < b.added_at ? 1 : -1; });   // newest on top
    $('gcount').textContent = rows.length ? String(rows.length) : '';
    rows.forEach(function (r) {
      var li = el('li', 'grow' + (flashId === r.id ? ' gflash' : ''));
      li.appendChild(icon(r.kind === 'finished' ? 'finished' : 'request', r.kind, 'gkind'));
      li.appendChild(el('span', 'gname', r.item));
      var who = el('span', 'gwho');
      (r.people || []).forEach(function (id) { var p = person(id); if (p) who.appendChild(badge(p)); });
      if (r.source === 'telegram' && !(r.people || []).length) who.appendChild(el('span', 'badge tg', 'T'));
      li.appendChild(who);
      li.addEventListener('click', function () { bought(r); });
      list.appendChild(li);
    });
  }

  // Suggestions: what the family has listed before (most often first), then common foods.
  function suggestions(q) {
    var k = norm(q), out = [], skip = {};
    state.shop.forEach(function (r) { if (!r.bought_at) skip[norm(r.item)] = 1; });
    var past = Object.keys(state.seen)
      .sort(function (a, b) { return state.seen[b].n - state.seen[a].n; })
      .map(function (key) { return state.seen[key].name; });
    var all = past.concat(window.KD_FOODS || []), used = {};
    function push(name) { var n = norm(name); if (!used[n] && !skip[n]) { used[n] = 1; out.push(name); } }
    if (!k) { all.forEach(push); return out.slice(0, 18); }
    all.forEach(function (n) { if (norm(n).indexOf(k) === 0) push(n); });         // starts with
    all.forEach(function (n) { if (norm(n).indexOf(' ' + k) >= 0) push(n); });   // a later word starts with
    all.forEach(function (n) { if (norm(n).indexOf(k) > 0) push(n); });          // anywhere
    return out.slice(0, 18);
  }

  function openGrocery(kind) {
    var t = $('picker-title');
    t.innerHTML = '';
    t.appendChild(icon(kind, kind, 'big'));
    $('options').innerHTML = '';
    $('options').className = '';
    var input = $('gitem'), ok = $('confirm');
    input.value = '';
    ok.hidden = false; ok.disabled = true;
    function next(name) {
      if (!norm(name)) return;
      input.blur();
      chooseWho(null, [], function (p) { addGrocery(name, kind, p); });
      var tt = $('picker-title');
      tt.innerHTML = '';
      tt.appendChild(icon(kind, kind, 'big'));
      tt.appendChild(el('span', 'gpicked', nice(name)));
    }
    function draw() {
      var box = $('gsuggest');
      box.innerHTML = '';
      suggestions(input.value).forEach(function (name) {
        var b = el('button', 'chip', name);
        b.type = 'button';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); next(name); });
        box.appendChild(b);
      });
      ok.disabled = !norm(input.value);
    }
    input.oninput = function () { poke(); draw(); };
    input.onkeydown = function (ev) { if (ev.key === 'Enter') next(input.value); };
    ok.onclick = function (ev) { ev.stopPropagation(); next(input.value); };
    $('entry').hidden = false;
    $('picker').classList.add('top');     // leave room for the on-screen keyboard
    draw();
    showSheet();
    setTimeout(function () { input.focus(); }, 50);
  }

  $('gicon').appendChild(icon('cart', 'Groceries', 'ghicon'));
  $('gfinished').appendChild(icon('finished', 'Finished something', 'gbicon'));
  $('grequest').appendChild(icon('request', 'Request something', 'gbicon'));
  $('gfinished').addEventListener('click', function () { openGrocery('finished'); });
  $('grequest').addEventListener('click', function () { openGrocery('request'); });

  // ---------- candle lighting & havdalah (hebcal.com) ----------
  var shabbat = load('kd.shabbat', null);
  function hhmm(iso) { var d = new Date(iso); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function renderShabbat() {
    var box = $('shabbat');
    box.innerHTML = '';
    if (!shabbat) { box.hidden = true; return; }
    var now = Date.now(), c = null, h = null;
    shabbat.forEach(function (i) {
      var t = new Date(i.date).getTime();
      if (i.category === 'candles' && !c && t > now - 2 * 3600e3) c = i;
      if (i.category === 'havdalah' && !h && t > now - 3600e3) h = i;
    });
    function part(key, label, item) {
      if (!item) return;
      var s = el('span', 'sh');
      s.setAttribute('aria-label', label);
      s.appendChild(icon(key, label, 'shicon'));
      var d = new Date(item.date);
      if (startOfDay(d).getTime() !== startOfDay(new Date()).getTime()) s.appendChild(el('span', 'shday', DAYS[d.getDay()].slice(0, 3)));
      s.appendChild(el('span', 'shtime', hhmm(item.date)));
      box.appendChild(s);
    }
    part('candles', 'Candle lighting', c);
    part('havdalah', 'Havdalah', h);
    box.hidden = !box.children.length;
  }
  function fetchShabbat() {
    var g = (CFG.hebcal || {}).geonameid;
    if (!g || !window.fetch) return;
    fetch('https://www.hebcal.com/shabbat?cfg=json&M=on&geonameid=' + g)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        shabbat = (d.items || [])
          .filter(function (i) { return i.category === 'candles' || i.category === 'havdalah'; })
          .map(function (i) { return { category: i.category, date: i.date }; });
        save('kd.shabbat', shabbat); renderShabbat();
      }).catch(function () { /* offline: keep the cached times */ });
  }

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
  renderClock(); render(); renderGrocery(); renderShabbat(); sleepCheck();
  fetchShabbat();
  setInterval(fetchShabbat, 3 * 3600e3);
  setInterval(renderShabbat, 60000);
  setInterval(sleepCheck, 15000);
  setInterval(drift, 5 * 60000);
  setInterval(renderClock, 10000);
  setInterval(function () { render(); }, 60000);   // refresh "x min ago"
  setInterval(function () { flush().then(pull); }, 30000);
  window.addEventListener('online', function () { flush().then(pull); });
  flush().then(pull);
})();
