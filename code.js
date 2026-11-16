// Müziklik-Kartencode: Der QR-Code enthält "MZK:" + 4 Zeichen. Darin steckt das Jahr, aber nicht lesbar,
// damit die Handy-Kamera es nicht verrät. Wird von der App und vom Karten-Generator benutzt.
(function (root) {
  var MUL = 2741, ADD = 1583, MOD = 4096, INV = 0;
  for (var i = 1; i < MOD; i += 2) { if ((MUL * i) % MOD === 1) { INV = i; break; } }
  function check(m) { return ((m * 7 + 5) % 36).toString(36); }
  // copy: 0..7, unterscheidet mehrere Karten desselben Jahres
  function encode(year, copy) {
    var n = (year - 1900) * 8 + (copy || 0);
    var m = (n * MUL + ADD) % MOD;
    return 'MZK:' + (('00' + m.toString(36)).slice(-3) + check(m)).toUpperCase();
  }
  // gibt das Jahr zurück oder null, wenn der Text kein Müziklik-Code ist
  function decode(text) {
    var t = /^MZK:([0-9A-Z]{3})([0-9A-Z])$/i.exec(String(text).trim());
    if (!t) return null;
    var m = parseInt(t[1], 36);
    if (!(m >= 0 && m < MOD) || check(m) !== t[2].toLowerCase()) return null;
    var n = (((m - ADD) % MOD + MOD) % MOD * INV) % MOD;
    var year = 1900 + Math.floor(n / 8);
    return year >= 1900 && year <= 2100 ? year : null;
  }
  root.MZK_CODE = { encode: encode, decode: decode };
})(typeof window !== 'undefined' ? window : globalThis);
