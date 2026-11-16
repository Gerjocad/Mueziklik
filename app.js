/* Müziklik: Karte scannen, Song verdeckt abspielen, Punkte notieren. */
(function () {
  'use strict';

  var KEY = 'muziklik-v1';
  var MAX_PLAYERS = 8;
  var THEMES = window.MZK_THEMES.map(function (t) {
    return {
      id: t.id, name: t.name,
      songs: t.songs.map(function (s) {
        return {
          theme: t.id, year: s[0], id: s[1], title: s[2], artist: s[3], q: s[4] || '', m: s[5] || '',
          key: t.id + '|' + s[0] + '|' + s[2],
          // gleicher Song in mehreren Themen = gleiche uid, damit er pro Spiel nur einmal läuft
          uid: window.MZK_MATCH.norm(s[5] || s[2]) + '|' + s[0]
        };
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
      v: 1, started: false, target: 10, turn: 0, wonAck: false, themeMode: '', sharedTheme: 'hits',
      players: [{ id: uid(), name: '', theme: 'hits', score: 0 }, { id: uid(), name: '', theme: 'hits', score: 0 }],
      played: {}, playedIds: {}, ids: {}
    };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1 && Array.isArray(s.players) && s.players.length) {
        s.played = s.played || {}; s.playedIds = s.playedIds || {}; s.ids = s.ids || {};
        return s;
      }
    } catch (e) { /* kein Speicher: mit leerem Spiel starten */ }
    return freshState();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ohne Speicher weiterspielen */ } }

  var state = load();
  // Einrichtung: step 'players' -> 'mode' -> 'theme'; idx = Spieler, der bei "jeder sein eigenes" gerade wählt
  var setup = { step: 'players', idx: 0 };
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
  // Jeder Song läuft pro Spiel höchstens einmal, egal bei welchem Spieler und in welchem Thema.
  // Reihenfolge: eigenes Thema, dann Hits des Jahres, dann irgendein Thema mit diesem Jahr.
  function candidates(themeId, year) {
    var seen = {};
    function fresh(songs, kind) {
      return shuffle(songs.filter(function (s) {
        if (s.year !== year || state.played[s.uid] || seen[s.uid]) return false;
        seen[s.uid] = 1; return true;
      })).map(function (s) { return { song: s, fallback: kind }; });
    }
    var list = fresh(themeById(themeId).songs, '');
    if (themeId !== MIX.id) {
      if (themeId !== FALLBACK.id) list = list.concat(fresh(FALLBACK.songs, 'hits'));
      list = list.concat(fresh(MIX.songs, 'any'));
    }
    return list;
  }
  function markPlayed(song, deezerId) {
    state.played[song.uid] = 1;
    if (deezerId) state.playedIds[deezerId] = 1;
    save();
  }

  async function playYear(year, another) {
    stopScan();
    audio.pause();
    var p = player();
    stage = { mode: 'load', year: year };
    render();
    var list = candidates(p.theme, year);
    var netError = false;
    for (var i = 0; i < list.length; i++) {
      var hit = null;
      try { hit = await resolveSong(list[i].song); } catch (e) { netError = true; break; }
      if (stage.mode !== 'load' || stage.year !== year) return; // inzwischen abgebrochen
      if (!hit) continue;
      // dieselbe Aufnahme lief schon unter anderem Namen (z. B. Serien-Titelsong und Hit)
      if (state.playedIds[hit.id]) { markPlayed(list[i].song); continue; }
      markPlayed(list[i].song, hit.id);
      stage = { mode: 'play', year: year, song: list[i].song, fallback: list[i].fallback, paused: false };
      audio.src = hit.preview;
      audio.currentTime = 0;
      render();
      audio.play().catch(function () { stage.paused = true; render(); });
      return;
    }
    var used = MIX.songs.some(function (s) { return s.year === year && state.played[s.uid]; });
    stage = {
      mode: 'idle',
      error: netError
        ? 'Deezer ist gerade nicht erreichbar. Prüfe die Internetverbindung und scanne die Karte noch einmal.'
        : (used || another)
          ? 'Alle Songs aus ' + year + ' sind in diesem Spiel schon gelaufen. Zieh bitte eine andere Karte.'
          : 'Für ' + year + ' habe ich keinen spielbaren Song gefunden. Zieh bitte eine andere Karte.'
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
    state.started = false; state.turn = 0; state.played = {}; state.playedIds = {}; state.wonAck = false;
    save();
    setup = { step: 'players', idx: 0 };
    stage = { mode: 'idle' };
    render();
  }

  /* ---------- Anzeige ---------- */
  var ICON_SCAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  function stepHead(n, title) {
    return '<p class="label">Schritt ' + n + ' von 3</p><h2 class="setup-title">' + esc(title) + '</h2>';
  }
  function backBtn() {
    return '<button type="button" class="link link--back" data-act="setupBack">' + ICON_BACK + 'Zurück</button>';
  }
  function themeGrid(selected, label) {
    return '<div class="theme-grid" role="group" aria-label="' + esc(label) + '">' + ALL_THEMES.map(function (t) {
      return '<button type="button" class="theme-tile" data-act="pickTheme" data-theme="' + t.id + '" aria-pressed="' + (selected === t.id) + '">' +
        '<span class="theme-tile__name">' + esc(t.name) + '</span><span class="theme-tile__count">' + t.songs.length + ' Songs</span></button>';
    }).join('') + '</div>';
  }
  function targetCard() {
    return '<section class="card"><h2>Karten bis zum Sieg</h2><div class="stepper">' +
      '<button class="step" type="button" data-act="targetMinus" aria-label="Weniger Karten">−</button>' +
      '<output>' + state.target + '</output>' +
      '<button class="step" type="button" data-act="targetPlus" aria-label="Mehr Karten">+</button></div></section>';
  }

  function renderSetup() {
    var h = '';
    if (setup.step === 'players') {
      h = '<section class="card">' + stepHead(1, 'Wer spielt mit?') +
        '<p class="hint">Trag die Namen in der Reihenfolge ein, in der ihr spielt.</p><div class="scores">' +
        state.players.map(function (p, i) {
          return '<div class="setup-player__row">' +
            '<div class="flf"><input class="flf__input" id="pn_' + p.id + '" data-name="' + p.id + '" type="text" placeholder=" " maxlength="20" autocomplete="off" enterkeyhint="next" value="' + esc(p.name) + '">' +
            '<label class="flf__label" for="pn_' + p.id + '">Name Spieler ' + (i + 1) + '</label></div>' +
            '<button type="button" class="icon-btn" data-act="removePlayer" data-id="' + p.id + '" aria-label="Spieler ' + (i + 1) + ' entfernen"' + (state.players.length <= 1 ? ' disabled' : '') + '>' + ICON_X + '</button></div>';
        }).join('') + '</div>' +
        '<button class="ilf__btn" type="button" data-act="addPlayer"' + (state.players.length >= MAX_PLAYERS ? ' disabled' : '') + '>Spieler hinzufügen</button></section>' +
        '<button class="btn-main" type="button" data-act="setupNext">Weiter</button>';
    } else if (setup.step === 'mode') {
      h = '<section class="card">' + stepHead(2, 'Wie wählt ihr die Themen?') +
        '<p class="hint">Die Karte bestimmt nur das Jahr. Das Thema bestimmt, welcher Song läuft.</p>' +
        '<div class="choice-list">' +
          '<button type="button" class="choice" data-act="pickMode" data-mode="same" aria-pressed="' + (state.themeMode === 'same') + '">' +
            '<span class="choice__title">Alle das gleiche Thema</span><span class="choice__desc">Ihr wählt zusammen ein Thema für die ganze Runde.</span></button>' +
          '<button type="button" class="choice" data-act="pickMode" data-mode="each" aria-pressed="' + (state.themeMode === 'each') + '">' +
            '<span class="choice__title">Jeder sein eigenes Thema</span><span class="choice__desc">Jeder Spieler wählt nacheinander sein Thema.</span></button>' +
        '</div></section>' + backBtn();
    } else if (state.themeMode === 'same') {
      h = '<section class="card">' + stepHead(3, 'Welches Thema spielt ihr?') + themeGrid(state.sharedTheme, 'Thema für alle') + '</section>' +
        targetCard() + '<button class="btn-main" type="button" data-act="startGame">Spiel starten</button>' + backBtn();
    } else {
      var p = state.players[setup.idx], last = setup.idx === state.players.length - 1;
      h = '<section class="card">' + stepHead(3, 'Thema für ' + playerName(p)) +
        '<p class="hint">Spieler ' + (setup.idx + 1) + ' von ' + state.players.length + '</p>' +
        themeGrid(p.theme, 'Thema für ' + playerName(p)) + '</section>' +
        (last ? targetCard() + '<button class="btn-main" type="button" data-act="startGame">Spiel starten</button>'
              : '<button class="btn-main" type="button" data-act="setupNext">Weiter zu ' + esc(playerName(state.players[setup.idx + 1])) + '</button>') +
        backBtn();
    }
    $('setupBody').innerHTML = h;
  }

  function setupGo(step, idx) {
    setup = { step: step, idx: idx || 0 };
    renderSetup();
    window.scrollTo(0, 0);
    var first = $('setupBody').querySelector(step === 'players' ? '.flf__input' : 'h2');
    if (first && step !== 'players') { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  }
  function setupNext() {
    if (setup.step === 'players') {
      state.players.forEach(function (p) { p.name = p.name.trim(); });
      save();
      // Allein gibt es nichts zu entscheiden: gleich zur Themenwahl
      if (state.players.length === 1) { state.themeMode = 'same'; save(); return setupGo('theme'); }
      return setupGo('mode');
    }
    if (setup.step === 'theme' && state.themeMode === 'each') return setupGo('theme', setup.idx + 1);
  }
  function setupBack() {
    if (setup.step === 'mode') return setupGo('players');
    if (setup.step === 'theme') {
      if (state.themeMode === 'each' && setup.idx > 0) return setupGo('theme', setup.idx - 1);
      return setupGo(state.players.length === 1 ? 'players' : 'mode');
    }
  }
  function startGame() {
    if (state.themeMode === 'same') state.players.forEach(function (p) { p.theme = state.sharedTheme; });
    state.started = true; state.turn = 0; state.wonAck = false;
    state.players.forEach(function (p) { p.name = p.name.trim(); });
    save(); stage = { mode: 'idle' }; render(); window.scrollTo(0, 0);
  }

  function renderScores() {
    var active = player().id, same = state.players.every(function (p) { return p.theme === state.players[0].theme; });
    $('scoresTitle').textContent = same ? 'Punktestand · ' + themeById(state.players[0].theme).name : 'Punktestand';
    $('scores').innerHTML = state.players.map(function (p) {
      return '<div class="score' + (p.id === active ? ' is-active' : '') + '">' +
        '<span class="score__name">' + esc(playerName(p)) + (same ? '' : '<span class="score__theme">' + esc(themeById(p.theme).name) + '</span>') + '</span>' +
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
        '<p class="hint">' + esc(themeById(p.theme).name) + '</p>' +
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
        (stage.fallback ? '<p class="notice">Im Thema ' + esc(themeById(p.theme).name) + ' gibt es für dieses Jahr keinen neuen Song mehr. ' +
          (stage.fallback === 'hits' ? 'Es läuft ein Hit aus dem Jahr.' : 'Es läuft ein Song aus einem anderen Thema.') + '</p>' : '') +
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
    if (act === 'pickTheme') {
      if (state.themeMode === 'same') state.sharedTheme = b.dataset.theme;
      else state.players[setup.idx].theme = b.dataset.theme;
      save(); renderSetup();
      var sel = $('setupBody').querySelector('[data-theme="' + b.dataset.theme + '"]'); if (sel) sel.focus({ preventScroll: true });
    } else if (act === 'pickMode') {
      state.themeMode = b.dataset.mode; save(); setupGo('theme', 0);
    } else if (act === 'setupNext') { setupNext(); }
    else if (act === 'setupBack') { setupBack(); }
    else if (act === 'startGame') { startGame(); }
    else if (act === 'addPlayer') {
      if (state.players.length >= MAX_PLAYERS) return;
      var np = { id: uid(), name: '', theme: state.sharedTheme || 'hits', score: 0 };
      state.players.push(np); save(); renderSetup();
      var f = $('pn_' + np.id); if (f) f.focus();
    } else if (act === 'targetMinus' || act === 'targetPlus') {
      state.target = Math.min(30, Math.max(3, state.target + (act === 'targetPlus' ? 1 : -1))); save();
      var out = b.parentNode.querySelector('output'); if (out) out.textContent = state.target;
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
    else if (act === 'other') { playYear(stage.year, true); }
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

  $('setupBody').addEventListener('input', function (e) {
    var id = e.target.dataset.name;
    if (!id) return;
    var p = state.players.filter(function (x) { return x.id === id; })[0];
    if (p) { p.name = e.target.value; save(); }
  });
  // Enter im Namensfeld springt zum nächsten Namen, beim letzten weiter zu Schritt 2
  $('setupBody').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.dataset.name) return;
    e.preventDefault();
    var inputs = Array.prototype.slice.call($('setupBody').querySelectorAll('[data-name]'));
    var next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus(); else setupNext();
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
