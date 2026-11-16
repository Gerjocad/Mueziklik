// Liest tools/songs-src.txt, sucht sichere Deezer-Treffer vor und schreibt ../songs.js.
// Titel ohne sicheren Treffer bekommen die ID 0. Die App sucht sie dann beim Spielen selbst,
// weil Deezer je nach Land andere Aufnahmen anbietet.
// Aufruf: node tools/resolve-songs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
(0, eval)(fs.readFileSync(path.join(dir, '..', 'match.js'), 'utf8'));
const M = globalThis.MZK_MATCH;
const src = fs.readFileSync(path.join(dir, 'songs-src.txt'), 'utf8');
const cachePath = path.join(dir, 'deezer-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(q) {
  if (cache[q]) return cache[q];
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://api.deezer.com/search?limit=25&q=' + encodeURIComponent(q));
      const j = await r.json();
      if (j.error) { await sleep(1500); continue; }
      const data = (j.data || []).map(t => ({ id: t.id, title: t.title, artist: t.artist.name, album: t.album.title, rank: t.rank, preview: !!t.preview }));
      cache[q] = data; await sleep(120); return data;
    } catch (e) { await sleep(1500); }
  }
  return [];
}

const themes = []; let cur = null; const report = [];
for (const raw of src.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^\[(\w+)\]\s*(.+)$/);
  if (m) { cur = { id: m[1], name: m[2], songs: [] }; themes.push(cur); continue; }
  const [year, artist, title, q] = line.split('|').map(s => s.trim());
  const song = { year: +year, artist, title, q };
  let best = null;
  for (const qq of M.queries(song)) {
    for (const c of await search(qq)) { const s = M.score(c, song, !!q); if (s > (best?.s ?? 0)) best = { ...c, s }; }
    if (best && best.s >= M.SAFE) break;
  }
  const safe = best && best.s >= M.SAFE;
  const entry = [song.year, safe ? best.id : 0, title, artist];
  if (q) entry.push(q);
  cur.songs.push(entry);
  report.push((safe ? 'OK   ' : 'APP  ') + `${cur.id} ${year} | ${artist} – ${title}` + (best ? `  =>  ${best.artist} – ${best.title} [${best.album}] (${best.s.toFixed(0)})` : ''));
}
fs.writeFileSync(cachePath, JSON.stringify(cache));
fs.writeFileSync(path.join(dir, 'resolve-report.txt'), report.join('\n') + '\n');
const out = '// Automatisch erzeugt von tools/resolve-songs.mjs aus tools/songs-src.txt. Nicht von Hand ändern.\n' +
  '// Eintrag: [Jahr, Deezer-Track-ID (0 = App sucht selbst), Titel, Interpret, optionaler Suchbegriff]\n' +
  'window.MZK_THEMES = ' + JSON.stringify(themes).replace(/\{"id"/g, '\n{"id"').replace(/\],\[/g, '],\n[') + ';\n';
fs.writeFileSync(path.join(dir, '..', 'songs.js'), out);
console.log(themes.map(t => `${t.id}: ${t.songs.length} Titel, ${t.songs.filter(s => s[1]).length} mit fester ID`).join('\n'));
