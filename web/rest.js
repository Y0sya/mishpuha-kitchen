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
  var suns = load('kd.suns', {});            // 'YYYY-MM-DD' -> {sunrise:'ISO', sunset:'ISO'} (hebcal zmanim)
  var sunPending = {};
  // Preview: a real date (the coming Shabbat, or the next Rosh Hashana) + minutes from its midnight.
  var previewMin = null, previewYomTov = false, previewDay = null, previewItems = null;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(d) { return d.getHours() + ':' + pad(d.getMinutes()); }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function now() {
    if (previewMin == null) return new Date();
    var d = previewDay ? new Date(previewDay) : new Date(); d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + previewMin * 60000);
  }
  function active() { return PREVIEW && previewItems ? previewItems : items; }

  // ---------- is it Shabbat / Yom Tov right now? ----------
  function period(at) {
    var t = at.getTime(), sorted = active().slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
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
    var list = active();
    var yt = list.filter(function (i) { return i.category === 'holiday' && i.yomtov && i.date.slice(0, 10) === dayKey; })[0];
    var strip = function (s) { return String(s || '').replace(/\s+ת[א-ת]*״[א-ת]$/, ''); };  // drop the year (תשפ״ז)
    if (previewYomTov && !previewItems) return { title: 'ראש השנה', sub: '' };   // until its data arrives
    if (yt) return { title: strip(yt.hebrew || yt.title), sub: '' };
    var par = list.filter(function (i) { return i.category === 'parashat'; })[0];
    return { title: 'שבת', sub: par && par.hebrew ? par.hebrew : '' };
  }

  // ---------- the sky ----------
  // The colour comes from the sun's real height above/below the horizon for this place and
  // minute, so dawn, dusk and how high the winter vs summer sun gets all follow the season.
  // Each: [top, middle, bottom] colours and how dark it is (1 = night: stars, moon, light text).
  var C = {
    night:     [['#04060d', '#0a1029', '#141c3d'], 1],
    deepDawn:  [['#070b1c', '#121a3e', '#2c2a55'], 0.95],   // sun 12° down: first hint of light
    predawn:   [['#0d1433', '#2f2d5e', '#7a5a86'], 0.8],    // 6° down
    sunrise:   [['#33508f', '#c98a9a', '#ffc48f'], 0.35],
    early:     [['#4a7cc4', '#a7c3e3', '#ffe2bf'], 0.1],
    day:       [['#4f8fd6', '#8ec1ee', '#dff0ff'], 0],
    midday:    [['#3c86d8', '#82bdf0', '#e2f2ff'], 0],
    golden:    [['#4d6fae', '#e3b48a', '#ffd29c'], 0.1],
    sunset:    [['#2a3a78', '#b9607a', '#f39a5c'], 0.45],
    dusk:      [['#101836', '#35285e', '#6c4170'], 0.8],
    deepDusk:  [['#080d22', '#151a3e', '#2a2550'], 0.95],
  };
  // [sun altitude in degrees, palette]: morning (sun rising) and evening (sun setting).
  var RISE = [[-90, C.night], [-18, C.night], [-12, C.deepDawn], [-6, C.predawn], [-1, C.sunrise], [5, C.early], [15, C.day], [35, C.midday], [90, C.midday]];
  var SET  = [[-90, C.night], [-18, C.night], [-12, C.deepDusk], [-6, C.dusk], [-1, C.sunset], [5, C.golden], [15, C.day], [35, C.midday], [90, C.midday]];
  function hex(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, f) { var x = hex(a), y = hex(b); return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * f); }).join(',') + ')'; }
  // Sun: low-precision position (≈0.5°), then altitude/azimuth here.
  function sunNow(at) {
    var n = jd(at) - 2451545.0;
    var g = (357.528 + 0.9856003 * n) * R;
    var lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * R, e = 23.439 * R;
    var ra = Math.atan2(Math.cos(e) * Math.sin(lam), Math.cos(lam)) / R, dec = Math.asin(Math.sin(e) * Math.sin(lam)) / R;
    return altAz((ra + 360) % 360, dec, lst(at));
  }

  function paintSky(at) {
    var sun = sunNow(at), k = sun.az < 180 ? RISE : SET, i = 0;
    while (i < k.length - 2 && k[i + 1][0] <= sun.alt) i++;
    var a = k[i], b = k[i + 1], f = Math.min(1, Math.max(0, (sun.alt - a[0]) / (b[0] - a[0])));
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
    $('stars').style.opacity = dark > 0.3 ? '1' : '0';
    placeSky(at, dark);
  }

  // ---------- the real sky: stars and moon where they actually are ----------
  // The screen is a window facing south: azimuth 60° (ENE) at the left edge, 300° (WNW) at the
  // right, the horizon near the bottom, ~80° up at the top. Stars are the real bright stars
  // (stars.js) for this place and minute; the moon has its real position and phase.
  var LAT = (CFG.place || {}).lat || 43.84, LON = (CFG.place || {}).lon || -79.50;
  var R = Math.PI / 180;
  function jd(d) { return d.getTime() / 864e5 + 2440587.5; }
  function altAz(raDeg, decDeg, lstDeg) {
    var H = (lstDeg - raDeg) * R, d = decDeg * R, p = LAT * R;
    var alt = Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H));
    var az = Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(H) * Math.sin(p));
    return { alt: alt / R, az: ((az / R) + 360) % 360 };
  }
  function lst(at) { var n = jd(at) - 2451545.0; return ((280.46061837 + 360.98564736629 * n + LON) % 360 + 360) % 360; }
  function toScreen(h) {   // percentages within #rest
    return { x: (h.az - 60) / 240 * 100, y: 90 - h.alt / 82 * 86 };   // above ~85° goes off the top, like a window
  }

  var starEls = null;
  function buildStars() {
    var box = $('stars'), list = window.KD_STARS || [];
    box.innerHTML = '';
    starEls = list.map(function (s, i) {
      var e = document.createElement('i');
      var size = Math.max(1.2, 4.2 - s[2] * 0.75);                       // brighter = bigger
      var bv = s[3], tint = bv < 0 ? '#cfe0ff' : bv < 0.6 ? '#ffffff' : bv < 1.2 ? '#fff1d6' : '#ffd6b0';
      var r1 = ((i * 7919) % 1000) / 1000, r2 = ((i * 104729) % 1000) / 1000;   // stable per-star randomness
      e.style.cssText = 'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;background:' + tint +
        ';--d:' + (0.9 + r1 * 1.9).toFixed(2) + 's;animation-delay:-' + (r2 * 3).toFixed(2) + 's' +
        ';animation-name:' + (r2 < 0.5 ? 'twinkleA' : 'twinkleB');
      box.appendChild(e);
      return e;
    });
  }

  // Moon: low-precision (≈1°) position and phase from its mean orbit.
  function moonNow(at) {
    var n = jd(at) - 2451545.0;
    var L = 218.316 + 13.176396 * n, M = 134.963 + 13.064993 * n, F = 93.272 + 13.229350 * n;
    var lon = (L + 6.289 * Math.sin(M * R)) % 360, lat = 5.128 * Math.sin(F * R);
    var g = 357.528 + 0.9856003 * n, sunLon = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g * R) + 0.02 * Math.sin(2 * g * R)) % 360;
    var e = 23.439 * R, l = lon * R, b = lat * R;
    var ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) / R;
    var dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)) / R;
    var elong = ((lon - sunLon) % 360 + 360) % 360;                       // 0 new · 90 first quarter · 180 full
    return { ra: (ra + 360) % 360, dec: dec, elong: elong };
  }
  // SVG of the lit part: right side lit while waxing (as seen from the northern hemisphere).
  function moonSvg(elong) {
    var k = (1 - Math.cos(elong * R)) / 2;                                 // fraction lit
    var waxing = elong < 180, r = 30, tx = r * Math.abs(1 - 2 * k);       // terminator ellipse half-width
    var outer = waxing ? 1 : 0, inner = (k > 0.5) === waxing ? 1 : 0;
    var lit = 'M30 0 A30 30 0 0 ' + outer + ' 30 60 A' + tx.toFixed(2) + ' 30 0 0 ' + inner + ' 30 0 Z';
    return '<svg viewBox="0 0 60 60" width="100%" height="100%">' +
      '<circle cx="30" cy="30" r="30" fill="rgba(200,205,220,0.10)"/>' +
      (k > 0.01 ? '<path d="' + lit + '" fill="#f6efd8"/>' : '') + '</svg>';
  }

  // How faint a star can still be seen (magnitude): ~4.2 on a dark night (all we draw), only the
  // brightest in twilight, and a bright moon washes out the faint ones (up to ~1.5 magnitudes).
  function limitMag(dark, moonUp, moonLit) {
    var t = Math.min(1, Math.max(0, (dark - 0.4) / 0.6));
    return -1.6 + 5.8 * t * t * (3 - 2 * t) - (moonUp ? 1.5 * moonLit : 0);
  }

  // How hard stars twinkle overall. Twinkling comes from turbulence high up (the jet stream):
  // over southern Ontario that's strongest in winter, calmest in summer, and it changes night to
  // night. Season: a yearly curve (×1.35 mid-January … ×0.65 mid-July). Tonight: the real wind at
  // 250 hPa (~10 km up) from open-meteo.com, when known for that hour.
  var seeing = load('kd.seeing', {});        // 'YYYY-MM-DDTHH:00' -> jet wind km/h
  var seeingAt = 0;
  function seasonFactor(at) {
    var start = new Date(at.getFullYear(), 0, 1), doy = (at - start) / 864e5;
    return 1 + 0.35 * Math.cos(2 * Math.PI * (doy - 15) / 365.25);
  }
  function twinkleFactor(at) {
    var key = ymd(at) + 'T' + pad(at.getHours()) + ':00', jet = seeing[key], season = seasonFactor(at);
    if (jet == null) return season;
    var weather = Math.min(1.9, Math.max(0.55, 0.55 + jet / 180));   // calm ~30 km/h -> 0.7; strong jet 250 -> 1.9
    return 0.4 * season + 0.6 * weather;
  }
  function fetchSeeing() {
    if (!window.fetch || Date.now() - seeingAt < 3 * 3600e3) return;
    seeingAt = Date.now();
    var lat = (CFG.place || {}).lat || 43.84, lon = (CFG.place || {}).lon || -79.50;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(2) + '&longitude=' + lon.toFixed(2) +
          '&hourly=wind_speed_250hPa&past_days=1&forecast_days=3&timezone=auto')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var h = d.hourly || {}, out = {};
        (h.time || []).forEach(function (t, i) { if (h.wind_speed_250hPa[i] != null) out[t] = h.wind_speed_250hPa[i]; });
        seeing = out; save('kd.seeing', seeing); tick();
      }).catch(function () { seeingAt = 0; });
  }

  function placeSky(at, dark) {
    if (!starEls) buildStars();
    var L0 = lst(at), list = window.KD_STARS || [];
    var m = moonNow(at), mh = altAz(m.ra, m.dec, L0);
    var lim = limitMag(dark, mh.alt > 0, (1 - Math.cos(m.elong * R)) / 2), tw = twinkleFactor(at);
    for (var i = 0; i < list.length; i++) {
      var h = altAz(list[i][0], list[i][1], L0), e = starEls[i];
      if (h.alt < 1 || h.az < 55 || h.az > 305) { e.style.display = 'none'; continue; }
      var p = toScreen(h);
      if (p.y < -2) { e.style.display = 'none'; continue; }   // passed over the top of the window
      // Air: near the horizon light crosses up to ~10x more atmosphere: dimmer, and it twinkles hard.
      var airmass = 1 / Math.sin(Math.max(2, h.alt) * R);
      var mag = list[i][2] + 0.25 * (airmass - 1);
      var o = Math.min(1, Math.max(0, (lim - mag) / 1.2));
      if (o < 0.03) { e.style.display = 'none'; continue; }
      var amp = Math.min(0.9, (0.08 + 0.13 * (airmass - 1)) * tw);  // ~0.08 overhead, strong low down; × season/tonight
      e.style.display = '';
      e.style.left = p.x.toFixed(2) + '%';
      e.style.top = p.y.toFixed(2) + '%';
      e.style.setProperty('--o', o.toFixed(2));
      e.style.setProperty('--a', amp.toFixed(2));
    }
    var moon = $('moon');
    if (mh.alt < -2 || mh.az < 50 || mh.az > 310) { moon.style.opacity = '0'; return; }
    var mp = toScreen(mh), key = Math.round(m.elong);
    if (mp.y < -6) { moon.style.opacity = '0'; return; }
    if (moon.getAttribute('data-e') !== String(key)) { moon.innerHTML = moonSvg(m.elong); moon.setAttribute('data-e', key); }
    moon.style.left = mp.x.toFixed(2) + '%';
    moon.style.top = mp.y.toFixed(2) + '%';
    moon.style.opacity = String(0.35 + 0.65 * Math.min(1, dark * 1.3));    // the day moon is pale, as in life
  }

  // ---------- show / hide ----------
  function timeBox(key, label, d, at) {
    var s = document.createElement('span');
    s.className = 'rt';
    s.setAttribute('aria-label', label);
    s.innerHTML = ICONS[key] || '';
    s.appendChild(document.createTextNode(hhmm(d)));
    return s;
  }

  function tick() {
    var at = now(), p = period(at), body = document.body;
    if (!p) { body.classList.remove('resting'); return; }
    body.classList.add('resting');
    var n = names(at);
    $('rtitle').textContent = n.title;
    $('rsub').textContent = n.sub;
    var times = $('rtimes');
    times.innerHTML = '';
    times.appendChild(timeBox('candles', 'Candle lighting', p.start, at));
    times.appendChild(timeBox('havdalah', 'Havdalah', p.end, at));
    $('rclock').textContent = hhmm(at);
    // Late at night the words dim a little: the AMOLED screen stays on all night on Shabbat.
    var n2 = (CFG.night || { from: 23, to: 6 }), hr = at.getHours();
    body.classList.toggle('rest-late', n2.from > n2.to ? (hr >= n2.from || hr < n2.to) : (hr >= n2.from && hr < n2.to));
    paintSky(at);
  }

  function fetchSun(day) {
    var g = (CFG.hebcal || {}).geonameid;
    day = day || ymd(new Date());
    if (!g || !window.fetch || suns[day] || sunPending[day]) return;
    sunPending[day] = 1;
    fetch('https://www.hebcal.com/zmanim?cfg=json&geonameid=' + g + '&date=' + day)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.times) return;
        suns[day] = { sunrise: d.times.sunrise, sunset: d.times.sunset };
        var keep = {}; Object.keys(suns).sort().slice(-14).forEach(function (k) { keep[k] = suns[k]; }); suns = keep;
        save('kd.suns', suns);
        if (day === ymd(new Date())) save('kd.sun', { date: day, sunrise: d.times.sunrise, sunset: d.times.sunset });   // app.js: Hebrew date rolls at sunset
        tick();
      }).catch(function () {}).then(function () { delete sunPending[day]; });
  }

  // ---------- preview controls (?rest=1 on a computer, or Settings -> Preview on the tablet) ----------
  // Shabbat: the coming Friday evening through Saturday night. Yom Tov: the next Rosh Hashana,
  // with that date's real sky, times and names.
  var playTimer = null, SPAN = 0;
  function nextRoshHashana() {
    var f = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }), d = new Date();
    d.setHours(12, 0, 0, 0);
    for (var k = 0; k < 400; k++) {
      var parts = f.formatToParts(d), day = 0, month = '';
      parts.forEach(function (x) { if (x.type === 'day') day = +x.value; if (x.type === 'month') month = x.value; });
      if (month === 'תשרי' && day === 1) return d;
      d = new Date(d.getTime() + 864e5);
    }
    return null;
  }
  function firstCandles(list) {
    return list.filter(function (i) { return i.category === 'candles'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
  }
  function startAt(list, fallbackDay) {   // open the preview 20 min after candle lighting
    var c = firstCandles(list), d = c ? new Date(c.date) : fallbackDay;
    previewDay = new Date(d); previewDay.setHours(0, 0, 0, 0);
    previewMin = c ? d.getHours() * 60 + d.getMinutes() + 20 : 19 * 60 + 30;
  }
  function previewBar() {
    var old = $('rpreview'); if (old) old.parentNode.removeChild(old);
    clearInterval(playTimer); playTimer = null;
    var bar = document.createElement('div');
    bar.id = 'rpreview';
    bar.innerHTML = '<input id="rslide" type="range" min="0" step="1">' +
      '<span id="rslabel"></span><button type="button" id="ryt"></button><button type="button" id="rplay">▶ Play</button>' +
      '<button type="button" id="rexit">Exit</button>';
    document.body.appendChild(bar);
    var slide = $('rslide');
    slide.max = SPAN - 1;
    function set(v) { previewMin = +v; slide.value = v; var t = now(); $('rslabel').textContent = DAYS[t.getDay()] + ' ' + hhmm(t); tick(); }
    $('ryt').textContent = previewYomTov ? 'Shabbat' : 'Yom Tov';
    slide.addEventListener('input', function () { set(slide.value); });
    $('ryt').addEventListener('click', function () { startPreview(!previewYomTov); });
    $('rplay').addEventListener('click', function () {   // the whole span in ~half a minute
      if (playTimer) { clearInterval(playTimer); playTimer = null; this.textContent = '▶ Play'; return; }
      this.textContent = '❚❚';
      playTimer = setInterval(function () { set((previewMin + 2) % SPAN); }, 16);
    });
    $('rexit').addEventListener('click', stopPreview);
    set(previewMin);
  }
  function startPreview(yomTov) {
    PREVIEW = true; previewYomTov = !!yomTov; previewItems = null;
    if (!yomTov) {
      SPAN = 2 * 1440;                                   // Friday + Saturday
      startAt(items, (function () { var d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); d.setHours(16, 30); return d; })());
      previewBar();
      return;
    }
    SPAN = 3 * 1440;                                     // erev Rosh Hashana + two days
    var rh = nextRoshHashana(), erev = rh ? new Date(rh.getTime() - 864e5) : new Date();
    startAt([], new Date(erev.getFullYear(), erev.getMonth(), erev.getDate(), 19, 0));
    previewBar();
    var g = (CFG.hebcal || {}).geonameid;
    if (!g || !rh) return;
    fetch('https://www.hebcal.com/shabbat?cfg=json&M=on&geonameid=' + g + '&gy=' + erev.getFullYear() + '&gm=' + (erev.getMonth() + 1) + '&gd=' + erev.getDate())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!previewYomTov) return;
        previewItems = (d.items || []).filter(function (i) { return ['candles', 'havdalah', 'holiday', 'parashat'].indexOf(i.category) >= 0; })
          .map(function (i) { return { category: i.category, date: i.date, title: i.title, hebrew: i.hebrew, yomtov: !!i.yomtov }; });
        startAt(previewItems, erev);
        previewBar();
      }).catch(function () {});
  }
  function stopPreview() {
    clearInterval(playTimer); playTimer = null;
    var bar = $('rpreview'); if (bar) bar.parentNode.removeChild(bar);
    PREVIEW = false; previewMin = null; previewYomTov = false; previewDay = null; previewItems = null;
    tick();
  }

  window.KDRest = {
    setItems: function (list) { items = list || []; tick(); },
    period: function (d) { return period(d); },   // for checking the switch times
    twinkle: function (d) { return twinkleFactor(d || now()); },
    preview: startPreview,                         // Settings → Preview Shabbat / Yom Tov
  };
  items = (load('kd.shabbat', []) || []);
  fetchSun();
  fetchSeeing();
  setInterval(fetchSeeing, 3600e3);
  setInterval(tick, 30000);
  setInterval(function () { fetchSun(); }, 3 * 3600e3);
  if (PREVIEW) startPreview(/[?&]yt=/.test(location.search));
  tick();
})();
