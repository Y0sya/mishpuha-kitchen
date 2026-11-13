// Shabbat & Yom Tov: from candle lighting until havdalah the tiles fade away and the screen
// becomes a sky that follows the real day (night → dawn → day → dusk), with שבת or the
// Yom Tov's name in Hebrew, the parasha, and the start/end times. Nothing to tap.
//
// Data: hebcal items saved by app.js (window.KDRest.setItems) + today's sunrise/sunset
// (hebcal zmanim, fetched here). Preview on a computer: index.html?rest=1 (adds a time slider).
(function () {
  'use strict';
  var CFG = window.KD_CONFIG || {};
  var ICONS = window.KD_ICONS || {};
  var PREVIEW = /[?&]rest=/.test(location.search);
  var items = [];
  var sun = load('kd.sun', null);            // {date:'YYYY-MM-DD', sunrise:'ISO', sunset:'ISO'}
  var previewMin = null, previewYomTov = false;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(d) { return d.getHours() + ':' + pad(d.getMinutes()); }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function now() {
    if (previewMin == null) return new Date();
    var d = new Date(); d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + previewMin * 60000);
  }

  // ---------- is it Shabbat / Yom Tov right now? ----------
  function period(at) {
    var t = at.getTime(), sorted = items.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var start = null, end = null;
    sorted.forEach(function (i) {
      var it = new Date(i.date).getTime();
      if (i.category === 'candles' && it <= t && !start) start = i;
      if (i.category === 'havdalah' && it <= t) start = null;           // a rest period already ended
      if (i.category === 'havdalah' && it > t && start && !end) end = i;
    });
    if (start && end) return { start: new Date(start.date), end: new Date(end.date) };
    if (PREVIEW) {   // preview: use the coming Shabbat even if it's a weekday
      var c = sorted.filter(function (i) { return i.category === 'candles'; })[0];
      var h = sorted.filter(function (i) { return i.category === 'havdalah'; })[0];
      if (c && h) return { start: new Date(c.date), end: new Date(h.date) };
      var s = new Date(at); s.setHours(16, 36, 0, 0);
      return { start: s, end: new Date(s.getTime() + 25 * 3600e3) };
    }
    return null;
  }

  // The Hebrew name: the Yom Tov whose day it is (evening counts as the next day), else שבת.
  function names(at) {
    var dayKey = ymd(new Date(at.getTime() + 6 * 3600e3));
    var yt = items.filter(function (i) { return i.category === 'holiday' && i.yomtov && i.date.slice(0, 10) === dayKey; })[0];
    var strip = function (s) { return String(s || '').replace(/\s+ת[א-ת]*״[א-ת]$/, ''); };  // drop the year (תשפ״ז)
    if (previewYomTov) return { title: 'ראש השנה', sub: '' };
    if (yt) return { title: strip(yt.hebrew || yt.title), sub: '' };
    var par = items.filter(function (i) { return i.category === 'parashat'; })[0];
    return { title: 'שבת', sub: par && par.hebrew ? par.hebrew : '' };
  }

  // ---------- the sky ----------
  // Keyframes in minutes after midnight, relative to sunrise (sr) and sunset (ss).
  // Each: [top, middle, bottom] colours and how dark it is (1 = night: stars, moon, light text).
  var C = {
    night:     [['#04060d', '#0a1029', '#141c3d'], 1],
    predawn:   [['#0d1433', '#2f2d5e', '#7a5a86'], 0.8],
    sunrise:   [['#33508f', '#c98a9a', '#ffc48f'], 0.35],
    morning:   [['#4f8fd6', '#8ec1ee', '#dff0ff'], 0],
    midday:    [['#3c86d8', '#82bdf0', '#e2f2ff'], 0],
    afternoon: [['#4a86cc', '#9cc4ea', '#eef3f6'], 0],
    golden:    [['#4d6fae', '#e3b48a', '#ffd29c'], 0.1],
    sunset:    [['#2a3a78', '#b9607a', '#f39a5c'], 0.45],
    dusk:      [['#101836', '#35285e', '#6c4170'], 0.8],
  };
  function keyframes(sr, ss) {
    return [[0, C.night], [sr - 70, C.night], [sr - 35, C.predawn], [sr, C.sunrise], [sr + 60, C.morning],
            [(sr + ss) / 2, C.midday], [ss - 70, C.afternoon], [ss - 20, C.golden], [ss + 5, C.sunset],
            [ss + 35, C.dusk], [ss + 80, C.night], [1440, C.night]];
  }
  function hex(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, f) { var x = hex(a), y = hex(b); return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * f); }).join(',') + ')'; }
  function minutes(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
  function sunMinutes(at) {
    var sr = 7 * 60, ss = 17 * 60;   // fallback until zmanim arrive
    if (sun && sun.sunrise && sun.sunset) { sr = minutes(new Date(sun.sunrise)); ss = minutes(new Date(sun.sunset)); }
    return { sr: sr, ss: ss };
  }

  function paintSky(at) {
    var m = minutes(at), s = sunMinutes(at), k = keyframes(s.sr, s.ss), i = 0;
    while (i < k.length - 2 && k[i + 1][0] <= m) i++;
    var a = k[i], b = k[i + 1], f = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (m - a[0]) / (b[0] - a[0])));
    f = f * f * (3 - 2 * f);   // smoothstep: no visible steps
    var top = mix(a[1][0][0], b[1][0][0], f), mid = mix(a[1][0][1], b[1][0][1], f), bot = mix(a[1][0][2], b[1][0][2], f);
    var dark = a[1][1] + (b[1][1] - a[1][1]) * f;
    var rest = $('rest');
    rest.style.background = 'linear-gradient(to bottom, ' + top + ' 0%, ' + mid + ' 58%, ' + bot + ' 100%)';
    // Text colour from how bright the sky is behind the title (≈ upper-middle of the gradient):
    // dark ink on a bright sky, cream on a dark one, switching quickly through the mid-tones.
    var behind = mix(top.replace(/rgb\(|\)/g, '').split(',').map(Number).reduce(function (h, v) { return h + (v < 16 ? '0' : '') + v.toString(16); }, '#'),
                     mid.replace(/rgb\(|\)/g, '').split(',').map(Number).reduce(function (h, v) { return h + (v < 16 ? '0' : '') + v.toString(16); }, '#'), 0.6);
    var rgb = behind.replace(/rgb\(|\)/g, '').split(',').map(Number);
    var lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    var light = Math.min(1, Math.max(0, (0.58 - lum) / 0.03));
    rest.style.setProperty('--ink', mix('#16213d', '#f7f1e3', light));
    rest.style.setProperty('--glow', light > 0.5 ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.45)');
    $('stars').style.opacity = String(Math.max(0, (dark - 0.45) / 0.55));
    $('moon').style.opacity = String(Math.max(0, (dark - 0.6) / 0.4));
    // The sun rides an arc from sunrise (left) to sunset (right).
    var p = (m - s.sr) / (s.ss - s.sr), sunEl = $('sun');
    if (p > -0.04 && p < 1.04) {
      sunEl.style.opacity = String(Math.min(1, Math.min(p + 0.04, 1.04 - p) * 8));
      sunEl.style.left = (8 + p * 84) + '%';
      sunEl.style.top = (82 - Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * 62) + '%';
      var low = 1 - Math.sin(Math.PI * Math.min(1, Math.max(0, p)));   // redder near the horizon
      sunEl.style.setProperty('--sun', mix('#fff4d6', '#ff9a52', Math.min(1, low * 1.3)));
    } else sunEl.style.opacity = '0';
  }

  function makeStars() {
    var box = $('stars');
    if (box.children.length) return;
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }   // same sky every time
    for (var i = 0; i < 90; i++) {
      var s = document.createElement('i');
      var size = rnd() < 0.15 ? 3 : rnd() < 0.5 ? 2 : 1.4;
      s.style.cssText = 'left:' + (rnd() * 100) + '%;top:' + (rnd() * 70) + '%;width:' + size + 'px;height:' + size +
        'px;animation-delay:' + (rnd() * 6).toFixed(1) + 's;opacity:' + (0.4 + rnd() * 0.6).toFixed(2);
      box.appendChild(s);
    }
  }

  // ---------- show / hide ----------
  function timeBox(key, label, d, at) {
    var s = document.createElement('span');
    s.className = 'rt';
    s.setAttribute('aria-label', label);
    s.innerHTML = ICONS[key] || '';
    var same = ymd(d) === ymd(at);
    s.appendChild(document.createTextNode((same ? '' : DAYS[d.getDay()] + ' ') + hhmm(d)));
    return s;
  }

  function tick() {
    var at = now(), p = period(at), body = document.body;
    if (!p) { body.classList.remove('resting'); return; }
    body.classList.add('resting');
    makeStars();
    var n = names(at);
    $('rtitle').textContent = n.title;
    $('rsub').textContent = n.sub;
    var times = $('rtimes');
    times.innerHTML = '';
    times.appendChild(timeBox('candles', 'Candle lighting', p.start, at));
    times.appendChild(timeBox('havdalah', 'Havdalah', p.end, at));
    $('rclock').textContent = hhmm(at);
    paintSky(at);
  }

  function fetchSun() {
    var g = (CFG.hebcal || {}).geonameid, today = ymd(new Date());
    if (!g || !window.fetch || (sun && sun.date === today)) return;
    fetch('https://www.hebcal.com/zmanim?cfg=json&geonameid=' + g + '&date=' + today)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.times) return;
        sun = { date: today, sunrise: d.times.sunrise, sunset: d.times.sunset };
        save('kd.sun', sun); tick();
      }).catch(function () {});
  }

  // ---------- preview controls (?rest=1) ----------
  function previewBar() {
    var bar = document.createElement('div');
    bar.id = 'rpreview';
    bar.innerHTML = '<input id="rslide" type="range" min="0" max="1439" step="1">' +
      '<span id="rslabel"></span><button type="button" id="ryt">Yom Tov</button><button type="button" id="rplay">▶ Day</button>';
    document.body.appendChild(bar);
    var slide = $('rslide'), d = new Date(), timer = null;
    previewMin = d.getHours() * 60 + d.getMinutes();
    slide.value = previewMin;
    function set(v) { previewMin = +v; slide.value = v; $('rslabel').textContent = hhmm(now()); tick(); }
    slide.addEventListener('input', function () { set(slide.value); });
    $('ryt').addEventListener('click', function () { previewYomTov = !previewYomTov; this.textContent = previewYomTov ? 'Shabbat' : 'Yom Tov'; tick(); });
    $('rplay').addEventListener('click', function () {   // whole day in ~24 s
      if (timer) { clearInterval(timer); timer = null; this.textContent = '▶ Day'; return; }
      this.textContent = '❚❚';
      timer = setInterval(function () { set((previewMin + 1) % 1440); }, 16);
    });
    set(previewMin);
  }

  window.KDRest = {
    setItems: function (list) { items = list || []; tick(); },
  };
  items = (load('kd.shabbat', []) || []);
  fetchSun();
  setInterval(tick, 30000);
  setInterval(fetchSun, 3 * 3600e3);
  if (PREVIEW) previewBar();
  tick();
})();
