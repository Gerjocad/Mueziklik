/* Müziklik: Karte scannen, Song verdeckt abspielen, Punkte notieren. */
(function () {
  'use strict';

  var KEY = 'muziklik-v1';
  var MAX_PLAYERS = 8;
  var THEMES = window.MZK_THEMES.map(function (t) {
    return {
      id: t.id, name: t.name,
      songs: t.songs.map(function (s) {
        return { theme: t.id, year: s[0], id: s[1], title: s[2], artist: s[3], q: s[4] || '', key: t.id + '|' + s[0] + '|' + s[2] };
      })
    };
  });
  var MIX = { id: 'mix', name: 'Gemischt', songs: [].concat.apply([], THEMES.map(function (t) { return t.songs; })) };
  var ALL_THEMES = THEMES.concat([MIX]);
  var FALLBACK = THEMES[0]; // Internationale Hits: springt ein, wenn ein Thema für ein Jahr nichts hat
  var M = window.MZK_MATCH;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var uid = function () { return Math.random().toString(36).slice(2, 9); };
  var themeById = function (id) { return ALL_THEMES.filter(function (t) { return t.id === id; })[0] || FALLBACK; };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- Zustand ---------- */
  function freshState() {
    return {
      v: 1, started: false, target: 10, turn: 0, wonAck: false,
      players: [{ id: uid(), name: '', theme: 'hits', score: 0 }, { id: uid(), name: '', theme: 'hits', score: 0 }],
      played: {}, ids: {}
    };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1 && Array.isArray(s.players) && s.players.length) {
        s.played = s.played || {}; s.ids = s.ids || {};
        return s;
      }
    } catch (e) { /* kein Speicher: mit leerem Spiel starten */ }
    return freshState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ohne Speicher weiterspielen */ } }

  var state = load();
  var stage = { mode: 'idle' }; // idle | scan | load | play | result | win
  var audio = $('audio');
  var scan = { stream: null, raf: 0, last: 0, canvas: document.createElement('canvas') };

  var player = function () { return state.players[state.turn % state.players.length]; };
  var playerName = function (p) { return p.name.trim() || 'Spieler ' + (state.players.indexOf(p) + 1); };

  /* ---------- Deezer ---------- */
  var jsonpCount = 0;
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__mzk' + (++jsonpCount) + '_' + Date.now().toString(36);
      var el = document.createElement('script');
      var timer = setTimeout(function () { done(); reject(new Error('timeout')); }, 12000);
      function done() { clearTimeout(timer); delete window[name]; el.remove(); }
      window[name] = function (data) { done(); resolve(data); };
      el.onerror = function () { done(); reject(new Error('network')); };
      el.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'output=jsonp&callback=' + name;
      document.head.appendChild(el);
    });
  }
  // Deezer erlaubt 50 Anfragen in 5 Sekunden. Bei "Quota" kurz warten und wiederholen.
  async function deezer(path) {
    for (var i = 0; i < 4; i++) {
      var data = await jsonp('https://api.deezer.com/' + path);
      if (data && data.error && data.error.code === 4) { await sleep(1300); continue; }
      return data;
    }
    throw new Error('quota');
  }
  // Liefert {id, preview} oder null (Song bei Deezer nicht spielbar). Wirft bei Netzfehlern.
  async function resolveSong(song) {
    var known = state.ids[song.key];
    if (known === -1) return null;
    var id = known || song.id;
    if (id) {
      var t = await deezer('track/' + id);
      if (t && t.preview) return { id: id, preview: t.preview };
    }
    var best = null, queries = M.queries(song);
    for (var i = 0; i < queries.length; i++) {
      var res = await deezer('search?limit=25&q=' + encodeURIComponent(queries[i]));
      (res && res.data || []).forEach(function (c) {
        var s = M.score({ title: c.title, artist: c.artist.name, album: c.album && c.album.title, rank: c.rank, preview: c.preview }, song, !!song.q);
        if (s >= M.MIN && (!best || s > best.s)) best = { s: s, id: c.id, preview: c.preview };
      });
      if (best && best.s >= M.SAFE) break;
    }
    state.ids[song.key] = best ? best.id : -1;
    save();
    return best ? { id: best.id, preview: best.preview } : null;
  }

  /* ---------- Songauswahl ---------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  // Reihenfolge: ungespielte Songs des Themas, dann gespielte, dann Hits des Jahres als Ersatz
  function candidates(themeId, year, skipKey) {
    var own = themeById(themeId).songs.filter(function (s) { return s.year === year && s.key !== skipKey; });
    var fresh = shuffle(own.filter(function (s) { return !state.played[s.key]; }));
    var old = shuffle(own.filter(function (s) { return state.played[s.key]; }));
    var list = fresh.concat(old).map(function (s) { return { song: s, fallback: false }; });
    if (themeId !== FALLBACK.id && themeId !== MIX.id) {
      var fb = FALLBACK.songs.filter(function (s) { return s.year === year && s.key !== skipKey; });
      var fbFresh = shuffle(fb.filter(function (s) { return !state.played[s.key]; }));
      var fbOld = shuffle(fb.filter(function (s) { return state.played[s.key]; }));
      list = list.concat(fbFresh.concat(fbOld).map(function (s) { return { song: s, fallback: true }; }));
    }
    return list;
  }

  async function playYear(year, skipKey) {
    stopScan();
    audio.pause();
    var p = player();
    stage = { mode: 'load', year: year };
    render();
    var list = candidates(p.theme, year, skipKey);
    var netError = false;
    for (var i = 0; i < list.length; i++) {
      var hit = null;
      try { hit = await resolveSong(list[i].song); } catch (e) { netError = true; break; }
      if (stage.mode !== 'load' || stage.year !== year) return; // inzwischen abgebrochen
      if (hit) {
        state.played[list[i].song.key] = 1; save();
        stage = { mode: 'play', year: year, song: list[i].song, fallback: list[i].fallback, paused: false };
        audio.src = hit.preview;
        audio.currentTime = 0;
        render();
        audio.play().catch(function () { stage.paused = true; render(); });
        return;
      }
    }
    stage = {
      mode: 'idle',
      error: netError
        ? 'Deezer ist gerade nicht erreichbar. Prüfe die Internetverbindung und scanne die Karte noch einmal.'
        : (skipKey ? 'Für diese Karte gibt es keinen weiteren Song.' : 'Für diese Karte habe ich keinen spielbaren Song gefunden. Zieh bitte eine andere Karte.')
    };
    render();
  }

  /* ---------- Scanner ---------- */
  // Auf iPhones darf Ton nur nach einem Fingertipp starten. Deshalb beim Tipp einmal stumm anspielen.
  var SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function unlockAudio() {
    try {
      audio.src = SILENCE;
      var pr = audio.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) { /* egal: dann zeigt die App später einen Abspielen-Knopf */ }
  }
  async function startScan() {
    unlockAudio();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      stage = { mode: 'idle', manual: true, error: 'Dieser Browser gibt die Kamera nicht frei. Tippe das Jahr von Hand ein.' };
      return render();
    }
    stage = { mode: 'scan' };
    render();
    try {
      scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      stage = { mode: 'idle', manual: true, error: 'Kein Zugriff auf die Kamera. Erlaube die Kamera in den Browser-Einstellungen oder tippe das Jahr von Hand ein.' };
      return render();
    }
    if (stage.mode !== 'scan') return stopScan();
    var video = $('video');
    video.srcObject = scan.stream;
    video.play().catch(function () {});
    scan.raf = requestAnimationFrame(scanFrame);
  }
  function scanFrame(now) {
    if (stage.mode !== 'scan') return;
    scan.raf = requestAnimationFrame(scanFrame);
    var video = $('video');
    if (!video || video.readyState < 2 || now - scan.last < 110) return;
    scan.last = now;
    var scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    if (!w || !h) return;
    scan.canvas.width = w; scan.canvas.height = h;
    var ctx = scan.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    var found = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (!found || !found.data) return;
    var year = window.MZK_CODE.decode(found.data);
    if (year === null) {
      var note = $('scanNote');
      if (note) note.textContent = 'Das ist keine Müziklik-Karte.';
      return;
    }
    if (navigator.vibrate) navigator.vibrate(40);
    playYear(year);
  }
  function stopScan() {
    cancelAnimationFrame(scan.raf);
    if (scan.stream) { scan.stream.getTracks().forEach(function (t) { t.stop(); }); scan.stream = null; }
  }

  /* ---------- Spielablauf ---------- */
  function winner() {
    return state.players.filter(function (p) { return p.score >= state.target; })
      .sort(function (a, b) { return b.score - a.score; })[0] || null;
  }
  function verdict(correct) {
    var p = player();
    if (correct) p.score += 1;
    save();
    stage = { mode: 'result', song: stage.song, year: stage.year, correct: correct, who: playerName(p) };
    render();
  }
  function nextTurn() {
    audio.pause();
    state.turn = (state.turn + 1) % state.players.length;
    save();
    var w = winner();
    stage = (w && !state.wonAck) ? { mode: 'win', who: playerName(w) } : { mode: 'idle' };
    render();
  }
  function changeScore(id, delta) {
    var p = state.players.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    p.score = Math.max(0, p.score + delta);
    if (!winner()) state.wonAck = false;
    save();
    renderScores();
  }
  function newGame() {
    stopScan(); audio.pause();
    state.players.forEach(function (p) { p.score = 0; });
    state.started = false; state.turn = 0; state.played = {}; state.wonAck = false;
    save();
    stage = { mode: 'idle' };
    render();
  }

  /* ---------- Anzeige ---------- */
  var ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function themeChips(p, act) {
    return '<div class="chips" role="group" aria-label="Thema von ' + esc(playerName(p)) + '">' + ALL_THEMES.map(function (t) {
      return '<button type="button" class="chip" data-act="' + act + '" data-id="' + p.id + '" data-theme="' + t.id + '" aria-pressed="' + (p.theme === t.id) + '">' + esc(t.name) + '</button>';
    }).join('') + '</div>';
  }

  function renderSetup() {
    $('setupPlayers').innerHTML = state.players.map(function (p, i) {
      return '<div class="setup-player">' +
        '<div class="setup-player__row">' +
          '<div class="flf"><input class="flf__input" id="pn_' + p.id + '" data-name="' + p.id + '" type="text" placeholder=" " maxlength="20" autocomplete="off" value="' + esc(p.name) + '">' +
          '<label class="flf__label" for="pn_' + p.id + '">Name Spieler ' + (i + 1) + '</label></div>' +
          '<button type="button" class="icon-btn" data-act="removePlayer" data-id="' + p.id + '" aria-label="Spieler ' + (i + 1) + ' entfernen"' + (state.players.length <= 1 ? ' disabled' : '') + '>' + ICON_X + '</button>' +
        '</div>' + themeChips(p, 'setTheme') + '</div>';
    }).join('');
    $('addPlayer').disabled = state.players.length >= MAX_PLAYERS;
    $('targetOut').textContent = state.target;
  }

  function renderScores() {
    var active = player().id;
    $('scores').innerHTML = state.players.map(function (p) {
      return '<div class="score' + (p.id === active ? ' is-active' : '') + '">' +
        '<span class="score__name">' + esc(playerName(p)) + '<span class="score__theme">' + esc(themeById(p.theme).name) + '</span></span>' +
        '<button type="button" class="step" data-act="minus" data-id="' + p.id + '" aria-label="' + esc(playerName(p)) + ': einen Punkt abziehen">−</button>' +
        '<span class="score__pts">' + p.score + '<small> / ' + state.target + '</small></span>' +
        '<button type="button" class="step" data-act="plus" data-id="' + p.id + '" aria-label="' + esc(playerName(p)) + ': einen Punkt geben">+</button>' +
        '</div>';
    }).join('');
  }

  function revealBox(s) {
    return '<div class="reveal"><div class="reveal__year">' + s.year + '</div>' +
      '<div class="reveal__title">' + esc(s.title) + '</div><div class="reveal__artist">' + esc(s.artist) + '</div></div>';
  }

  function renderStage() {
    var p = player(), h = '';
    if (stage.mode === 'idle') {
      h = '<span class="label">Am Zug</span><p class="turn">' + esc(playerName(p)) + '</p>' +
        (stage.error ? '<p class="notice notice--error" role="alert">' + esc(stage.error) + '</p>' : '') +
        themeChips(p, 'setTheme') +
        '<button type="button" class="btn-main" data-act="scan">' + ICON_SCAN + 'Karte scannen</button>';
      if (stage.manual) {
        h += '<form class="manual" data-form="manual"><div class="flf"><input class="flf__input" id="manualYear" type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder=" " autocomplete="off" required>' +
          '<label class="flf__label" for="manualYear">Jahr</label></div><button type="submit" class="ilf__btn">Abspielen</button></form>' +
          '<p class="hint">Wer tippt, sieht das Jahr. Am besten tippt ein Mitspieler.</p>';
      } else {
        h += '<button type="button" class="link" data-act="manual">Kamera geht nicht? Jahr eintippen</button>';
      }
    } else if (stage.mode === 'scan') {
      h = '<span class="label">' + esc(playerName(p)) + ' scannt</span>' +
        '<div class="scanner"><video id="video" playsinline muted></video><div class="scanner__frame"></div></div>' +
        '<p class="hint" id="scanNote" role="status">Halte den QR-Code der Karte in den Rahmen.</p>' +
        '<button type="button" class="ilf__btn" data-act="cancel">Abbrechen</button>';
    } else if (stage.mode === 'load') {
      h = '<div class="wld" role="status" aria-label="Sucht einen Song"><div class="wld__row" aria-hidden="true"><p>Sucht</p><div class="wld__words">' +
        '<span class="wld__word">Song</span><span class="wld__word">Hörprobe</span><span class="wld__word">Thema</span><span class="wld__word">Jahr</span><span class="wld__word">Song</span>' +
        '</div></div></div><button type="button" class="ilf__btn" data-act="cancel">Abbrechen</button>';
    } else if (stage.mode === 'play') {
      h = '<span class="label">' + esc(playerName(p)) + ' · ' + esc(themeById(p.theme).name) + '</span>' +
        '<div class="eq' + (stage.paused ? '' : ' is-on') + '" id="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="bar" aria-hidden="true"><i id="progress"></i></div>' +
        (stage.fallback ? '<p class="notice">Zu diesem Jahr gibt es im Thema ' + esc(themeById(p.theme).name) + ' keinen Song. Es läuft ein Hit aus dem Jahr.</p>' : '') +
        '<div class="btn-row"><button type="button" class="ilf__btn" data-act="toggle" id="toggleBtn">' + (stage.paused ? 'Abspielen' : 'Pause') + '</button>' +
        '<button type="button" class="ilf__btn" data-act="other">Anderer Song</button></div>' +
        '<p class="hint">Karte einordnen, dann umdrehen. Liegt sie richtig?</p>' +
        '<div class="btn-row"><button type="button" class="btn-yes" data-act="yes">Richtig</button><button type="button" class="btn-no" data-act="no">Falsch</button></div>';
    } else if (stage.mode === 'result') {
      var next = state.players[(state.turn + 1) % state.players.length];
      h = '<p class="verdict ' + (stage.correct ? 'verdict--yes' : 'verdict--no') + '">' +
        (stage.correct ? 'Richtig! Ein Punkt für ' + esc(stage.who) + '.' : 'Falsch. Kein Punkt für ' + esc(stage.who) + '.') + '</p>' +
        revealBox(stage.song) +
        '<p class="hint">Titel oder Interpret gewusst? Bonuspunkte trägst du unten mit + ein.</p>' +
        '<button type="button" class="btn-main" data-act="next">Weiter: ' + esc(playerName(next)) + '</button>';
    } else if (stage.mode === 'win') {
      h = '<span class="label">Spiel gewonnen</span><p class="winner"><span>' + esc(stage.who) + '</span> gewinnt!</p>' +
        '<div class="btn-row"><button type="button" class="ilf__btn" data-act="keepPlaying">Weiterspielen</button>' +
        '<button type="button" class="ilf__btn" data-act="newGameNow">Neues Spiel</button></div>';
    }
    $('stage').innerHTML = h;
  }

  function render() {
    $('setup').hidden = state.started;
    $('game').hidden = !state.started;
    $('openSettings').hidden = !state.started;
    if (state.started) { renderStage(); renderScores(); } else { renderSetup(); }
  }

  function renderSettings() {
    $('settingsThemes').innerHTML = state.players.map(function (p) {
      return '<div class="setup-player"><span class="score__name">' + esc(playerName(p)) + '</span>' + themeChips(p, 'setTheme') + '</div>';
    }).join('');
    $('newGameConfirm').hidden = true;
  }

  /* ---------- Songs vorab prüfen ---------- */
  var checking = false;
  async function checkSongs() {
    if (checking) return;
    checking = true;
    var btn = $('checkSongs'), out = $('checkOut'), bar = $('checkBar');
    btn.disabled = true; bar.hidden = false;
    var all = MIX.songs, ok = 0, missing = [], failed = false;
    for (var i = 0; i < all.length; i++) {
      try {
        var hit = await resolveSong(all[i]);
        if (hit) { ok++; if (!state.ids[all[i].key]) state.ids[all[i].key] = hit.id; } else { missing.push(all[i]); }
      } catch (e) { failed = true; break; }
      bar.firstElementChild.style.width = Math.round((i + 1) / all.length * 100) + '%';
      out.textContent = (i + 1) + ' von ' + all.length + ' geprüft …';
      await sleep(130);
    }
    save();
    checking = false; btn.disabled = false; bar.hidden = true;
    out.textContent = failed
      ? 'Abgebrochen: Deezer ist gerade nicht erreichbar. Versuch es später noch einmal.'
      : ok + ' von ' + all.length + ' Songs sind bei dir spielbar.' + (missing.length ? ' Nicht gefunden: ' + missing.slice(0, 8).map(function (s) { return s.title + ' (' + s.year + ')'; }).join(', ') + (missing.length > 8 ? ' und ' + (missing.length - 8) + ' weitere.' : '.') : '');
  }

  /* ---------- Ereignisse ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act, id = b.dataset.id;
    if (act === 'setTheme') {
      var p = state.players.filter(function (x) { return x.id === id; })[0];
      if (p) { p.theme = b.dataset.theme; save(); }
      if ($('settings').open) { renderSettings(); if (state.started) { if (stage.mode === 'idle') renderStage(); renderScores(); } }
      else if (state.started) { renderStage(); renderScores(); }
      else renderSetup();
    } else if (act === 'removePlayer') {
      state.players = state.players.filter(function (x) { return x.id !== id; }); save(); renderSetup();
    } else if (act === 'plus') { changeScore(id, 1); }
    else if (act === 'minus') { changeScore(id, -1); }
    else if (act === 'scan') { startScan(); }
    else if (act === 'manual') { stage = { mode: 'idle', manual: true }; renderStage(); var f = $('manualYear'); if (f) f.focus(); }
    else if (act === 'cancel') { stopScan(); audio.pause(); stage = { mode: 'idle' }; renderStage(); }
    else if (act === 'toggle') {
      if (audio.paused) { if (audio.ended) audio.currentTime = 0; audio.play().catch(function () {}); } else { audio.pause(); }
    }
    else if (act === 'other') { playYear(stage.year, stage.song.key); }
    else if (act === 'yes') { verdict(true); }
    else if (act === 'no') { verdict(false); }
    else if (act === 'next') { nextTurn(); }
    else if (act === 'keepPlaying') { state.wonAck = true; save(); stage = { mode: 'idle' }; renderStage(); }
    else if (act === 'newGameNow') { newGame(); }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.dataset.form !== 'manual') return;
    e.preventDefault();
    var year = parseInt($('manualYear').value, 10);
    if (!(year >= 1900 && year <= 2100)) return;
    unlockAudio();
    playYear(year);
  });

  $('setupPlayers').addEventListener('input', function (e) {
    var id = e.target.dataset.name;
    if (!id) return;
    var p = state.players.filter(function (x) { return x.id === id; })[0];
    if (p) { p.name = e.target.value; save(); }
  });
  $('addPlayer').addEventListener('click', function () {
    if (state.players.length >= MAX_PLAYERS) return;
    var p = { id: uid(), name: '', theme: 'hits', score: 0 };
    state.players.push(p); save(); renderSetup();
    var f = $('pn_' + p.id); if (f) f.focus();
  });
  $('targetMinus').addEventListener('click', function () { state.target = Math.max(3, state.target - 1); save(); renderSetup(); });
  $('targetPlus').addEventListener('click', function () { state.target = Math.min(30, state.target + 1); save(); renderSetup(); });
  $('startGame').addEventListener('click', function () {
    state.started = true; state.turn = 0; state.wonAck = false;
    state.players.forEach(function (p) { p.name = p.name.trim(); });
    save(); stage = { mode: 'idle' }; render(); window.scrollTo(0, 0);
  });

  $('openSettings').addEventListener('click', function () { renderSettings(); $('settings').showModal(); });
  $('checkSongs').addEventListener('click', checkSongs);
  $('newGame').addEventListener('click', function () { $('newGameConfirm').hidden = false; });
  $('newGameNo').addEventListener('click', function () { $('newGameConfirm').hidden = true; });
  $('newGameYes').addEventListener('click', function () { $('settings').close(); newGame(); });

  function syncPlayState() {
    if (stage.mode !== 'play') return;
    stage.paused = audio.paused;
    var eq = $('eq'), btn = $('toggleBtn');
    if (eq) eq.classList.toggle('is-on', !audio.paused);
    if (btn) btn.textContent = audio.paused ? (audio.ended ? 'Nochmal hören' : 'Abspielen') : 'Pause';
  }
  audio.addEventListener('play', syncPlayState);
  audio.addEventListener('pause', syncPlayState);
  audio.addEventListener('ended', syncPlayState);
  audio.addEventListener('timeupdate', function () {
    var bar = $('progress');
    if (bar && audio.duration) bar.style.width = Math.min(100, audio.currentTime / audio.duration * 100) + '%';
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && stage.mode === 'scan') { stopScan(); stage = { mode: 'idle' }; renderStage(); } });

  render();
})();
