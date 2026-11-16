// Erzeugt die Müziklik-Karten als A4-PDFs: 9 Karten pro Blatt (63 x 88 mm), vorne QR-Code, hinten das Jahr.
// Aufruf: node make-cards.mjs [vonJahr] [bisJahr] [KartenProJahr]     Standard: 1960 2025 2
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const { chromium } = require('playwright');

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
(0, eval)(fs.readFileSync(path.join(root, 'code.js'), 'utf8'));
const CODE = globalThis.MZK_CODE;

const from = +(process.argv[2] || 1960), to = +(process.argv[3] || 2025), copies = Math.min(8, +(process.argv[4] || 2));
const cards = [];
for (let y = from; y <= to; y++) for (let c = 0; c < copies; c++) cards.push({ year: y, code: CODE.encode(y, c) });

const W = 63, H = 88, COLS = 3, ROWS = 3, PER = COLS * ROWS;
const X0 = (210 - COLS * W) / 2, Y0 = (297 - ROWS * H) / 2;
// Schrift direkt einbetten, damit sie im PDF sicher ankommt
const font = w => 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'fonts', `poppins-latin-${w}-normal.woff2`)).toString('base64');

const disc = (size, cls = '') => `<svg class="${cls}" viewBox="0 0 120 120" width="${size}" height="${size}">
  <circle cx="60" cy="60" r="56" fill="#111111"/><circle cx="60" cy="60" r="45" fill="none" stroke="#444444" stroke-width="2"/>
  <circle cx="60" cy="60" r="36" fill="none" stroke="#444444" stroke-width="2"/>
  <rect x="38" y="38" width="44" height="44" rx="10" fill="#956afa"/><rect x="47" y="47" width="26" height="26" rx="5" fill="#111111"/>
  <rect x="54" y="54" width="12" height="12" rx="2.5" fill="#956afa"/></svg>`;
const wordmark = `<span class="wm">M<b>ü</b>ziklik</span>`;

async function front(card) {
  const svg = await QRCode.toString(card.code, { type: 'svg', margin: 0, errorCorrectionLevel: 'Q', color: { dark: '#111111', light: '#ffffff' } });
  return `<div class="brand">${disc('7mm')}${wordmark}</div><div class="qr">${svg}</div><p class="tag">Scannen · Hören · Einordnen</p>`;
}
const rings = `<svg class="rings" viewBox="0 0 104 104"><circle cx="52" cy="52" r="51" fill="none" stroke="#956afa" stroke-width="1"/>
  <circle cx="52" cy="52" r="46" fill="none" stroke="#d9ccfd" stroke-width="0.5"/><circle cx="52" cy="52" r="41" fill="none" stroke="#d9ccfd" stroke-width="0.5"/></svg>`;
const back = card => `${rings}<p class="year">${card.year}</p><div class="brand brand--back">${disc('5mm')}${wordmark}</div>`;

// Schnittmarken: kurze Striche außerhalb des Kartenrasters
function marks() {
  let s = '';
  for (let c = 0; c <= COLS; c++) { const x = X0 + c * W; s += `<i style="left:${x}mm;top:${Y0 - 7}mm;height:5mm;width:0"></i><i style="left:${x}mm;top:${Y0 + ROWS * H + 2}mm;height:5mm;width:0"></i>`; }
  for (let r = 0; r <= ROWS; r++) { const y = Y0 + r * H; s += `<i style="top:${y}mm;left:${X0 - 7}mm;width:5mm;height:0"></i><i style="top:${y}mm;left:${X0 + COLS * W + 2}mm;width:5mm;height:0"></i>`; }
  return s;
}

async function page(list, side, label) {
  let cells = '';
  for (let i = 0; i < list.length; i++) {
    const r = Math.floor(i / COLS), c0 = i % COLS;
    const c = side === 'back' ? COLS - 1 - c0 : c0; // Rückseite gespiegelt, damit sie nach dem Wenden passt
    cells += `<div class="card card--${side}" style="left:${X0 + c * W}mm;top:${Y0 + r * H}mm">${side === 'front' ? await front(list[i]) : back(list[i])}</div>`;
  }
  return `<section class="sheet">${marks()}${cells}<p class="foot">${label}</p></section>`;
}

const css = `
@font-face{font-family:Poppins;font-weight:500;src:url("${font(500)}") format("woff2")}
@font-face{font-family:Poppins;font-weight:700;src:url("${font(700)}") format("woff2")}
@font-face{font-family:Poppins;font-weight:800;src:url("${font(800)}") format("woff2")}
@page{size:A4;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Poppins,sans-serif;color:#111111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;break-after:page}
.sheet>i{position:absolute;border-left:0.2mm solid #111111;border-top:0.2mm solid #111111}
.foot{position:absolute;left:0;right:0;bottom:4.5mm;text-align:center;font-size:7pt;font-weight:500;color:#555555}
.card{position:absolute;width:${W}mm;height:${H}mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.card--front{border:0.15mm dashed #bbbbbb;gap:5mm}
.brand{display:flex;align-items:center;gap:2mm}
.brand svg{display:block}
.wm{font-weight:700;font-size:15pt;letter-spacing:-0.01em}
.wm b{color:#7a4ff0;font-weight:700}
.qr{width:40mm;height:40mm}
.qr svg{width:100%;height:100%;display:block}
.tag{font-size:7pt;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#555555}
.card--back{gap:0}
.rings{position:absolute;left:50%;top:50%;width:52mm;height:52mm;margin:-26mm 0 0 -26mm}
.year{position:relative;font-weight:800;font-size:39pt;line-height:1;letter-spacing:-0.02em;font-variant-numeric:tabular-nums}
.brand--back{position:absolute;bottom:7mm;left:0;right:0;justify-content:center}
.brand--back .wm{font-size:10pt}
`;
const doc = body => `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

const sheets = [];
for (let i = 0; i < cards.length; i += PER) sheets.push(cards.slice(i, i + PER));
const n = sheets.length;
let both = '', fronts = '', backs = '';
for (let i = 0; i < n; i++) {
  const f = await page(sheets[i], 'front', `Müziklik · Blatt ${i + 1} von ${n} · Vorderseite`);
  const b = await page(sheets[i], 'back', `Müziklik · Blatt ${i + 1} von ${n} · Rückseite`);
  both += f + b; fronts += f; backs += b;
}

const out = path.join(root, 'karten');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const pg = await browser.newPage();
for (const [name, body] of [['muziklik-karten-beidseitig', both], ['muziklik-karten-vorderseiten', fronts], ['muziklik-karten-rueckseiten', backs]]) {
  await pg.setContent(doc(body), { waitUntil: 'load' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.pdf({ path: path.join(out, name + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
}
await browser.close();
console.log(`${cards.length} Karten (${from}–${to}, ${copies} pro Jahr) auf ${n} Blättern -> ${out}`);
