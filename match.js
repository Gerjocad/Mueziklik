// Müziklik: bewertet Deezer-Suchtreffer, damit das Original gespielt wird und keine Cover- oder Live-Version.
// Wird von der App (im Browser) und von tools/resolve-songs.mjs (Node) benutzt.
(function (root) {
  var BAD = /\b(live|karaoke|remix|remixed|mix|acoustic|cover|tribute|instrumental|demo|made famous|originally performed|in the style|re-?recorded|reprise|version|edit|medley|unplugged|session|sessions|lullaby|piano|8 ?bit|sped up|slowed|reloaded|rehearsal|ao vivo|en vivo|orchestra|choir|bossa|rmx|dub|megamix|songs of surrender|taylor's version)\b/i;
  var OKVER = /(remaster|single version|album version|soundtrack|^\s*radio edit\s*$|original|mono|stereo|from ["“”'‘’]|feat\.?|with )/i;

  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function words(s) {
    return norm(s).split(' ').filter(function (w) { return w.length > 1 && w !== 'and' && w !== 'the' && w !== 'of'; });
  }
  // c: {title, artist, album, rank, preview}; want: {title, artist, m}; loose: Interpret ist kein Muss
  // Ergebnis: -1 = unbrauchbar, sonst 0..120 (ab 85 gilt der Treffer als sicher)
  function score(c, want, loose) {
    if (!c.preview) return -1;
    // want.m: Titel, wie er bei Deezer heißt, falls er vom angezeigten Titel abweicht (z. B. "Main Title")
    var wantTitle = want.m || want.title;
    var ct = norm(c.title), wt = norm(wantTitle);
    // nur ganze Wörter zählen, sonst passt ein kurzer Titel wie "Du" auf fast alles
    if (!wt || (' ' + ct + ' ').indexOf(' ' + wt + ' ') === -1) return -1;
    // Titel mit zusätzlichen Wörtern ("The Power of Bhangra") sind oft ein anderes Lied: nie als sicher werten
    var s = ct === wt ? 60 : (ct.indexOf(wt + ' ') === 0 ? 20 : 10);
    var extra = String(c.title).toLowerCase().replace(String(wantTitle).toLowerCase(), ' ');
    // jeden Zusatz einzeln prüfen: "(feat. X) (Remix)" bleibt ein Remix
    var parts = extra.split(/[()\[\]]| - |\/ /);
    for (var i = 0; i < parts.length; i++) {
      if (BAD.test(parts[i]) && !OKVER.test(parts[i])) return -1;
    }
    if (BAD.test(String(c.album || '')) && !/soundtrack|motion picture|original/i.test(c.album)) s -= 30;
    var wa = words(want.artist), ca = norm(c.artist);
    var hit = wa.filter(function (w) { return ca.indexOf(w) !== -1; }).length;
    if (!loose) {
      if (wa.length && hit === 0) return -1;
      s += wa.length ? 40 * hit / wa.length : 0;
    } else {
      s += 25 + (wa.length ? 15 * hit / wa.length : 0);
    }
    s += Math.min(20, (c.rank || 0) / 50000);
    return s;
  }
  function queries(song) {
    if (song.q) return [song.q];
    var first = String(song.artist).split(/[&,]| feat/)[0].trim();
    var title = song.m || song.title;
    var plain = String(title).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
    var list = [song.artist + ' ' + title, first + ' ' + plain, plain];
    return list.filter(function (q, i) { return list.indexOf(q) === i; });
  }
  root.MZK_MATCH = { norm: norm, score: score, queries: queries, SAFE: 85, MIN: 55 };
})(typeof window !== 'undefined' ? window : globalThis);
