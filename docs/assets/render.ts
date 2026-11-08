// README artwork. Run from the repository root: bun docs/assets/render.ts
// The web image is a frame of the sample recording. The phone view is an illustration
// of the installed web app's Home screen, with the same sample content, rather than a device screenshot.
import { createCanvas, GlobalFonts, loadImage } from '../../server/agent/node_modules/@napi-rs/canvas/index.js';
import { THEMES, alpha, withAccent } from '../../packages/core/src/theme';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const { C, TINT, NOTE_COLORS } = withAccent(THEMES.rosepine, 'orange');
for (const [weight, name] of [['400Regular', 'Regular'], ['500Medium', 'Medium'], ['600SemiBold', 'Semibold'], ['700Bold', 'Bold']]) {
  GlobalFonts.registerFromPath(`${root}/mobile/assets/fonts/AtkinsonHyperlegibleNext_${weight}.ttf`, `Atkinson ${name}`);
}
const original = await Bun.file(`${root}/mobile/assets/logo/foreground.svg`).text();
const mark = original.replace(/<!--[\s\S]*?-->/, '<!-- Generated from mobile/assets/logo/foreground.svg and packages/core/src/theme.ts. -->').replace('viewBox="0 0 1024 1024"', 'viewBox="260 200 504 624"').replace(/fill="#[a-f0-9]+"/, `fill="${C.brand}"`);
await Bun.write(`${dir}/mark.svg`, mark);
const logo = await loadImage(Buffer.from(mark));
const web = await loadImage(`${dir}/web-home.png`);
const icons = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
async function icon(name: string, color = C.dim) {
  const key = `${name}:${color}`;
  if (icons.has(key)) return icons.get(key)!;
  const { __iconData } = await import(`${root}/web/node_modules/lucide-react/dist/esm/icons/${name}.mjs`);
  const paths = __iconData.node.map(([tag, props]: [string, Record<string, string>]) => `<${tag} ${Object.entries(props).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  const img = await loadImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`));
  icons.set(key, img);
  return img;
}
function panel(ctx: any, x: number, y: number, w: number, h: number, radius: number, fill: string, border?: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
}
function text(ctx: any, value: string, x: number, y: number, size: number, color = C.fg, face = 'Regular') {
  ctx.font = `${size}px "Atkinson ${face}"`; ctx.fillStyle = color; ctx.fillText(value, x, y);
}

// Illustrate the phone as the installed web app draws Home (web/src/components/home.tsx below `md`; the site's
// site/src/components/mock/PhoneHome.tsx and parts.tsx are the same screen in markup). Drawn at 2x and scaled down.
const PW = 390, PH = 932, S = 2;
const phone = createCanvas(PW * S, PH * S), p = phone.getContext('2d');
p.scale(S, S);
p.fillStyle = C.bg; p.fillRect(0, 0, PW, PH);
const ico = async (name: string, x: number, y: number, size: number, color = C.dim) => p.drawImage(await icon(name, color), x, y, size, size);
const width = (value: string, size: number, face: string) => { p.font = `${size}px "Atkinson ${face}"`; return p.measureText(value).width; };

// The system bars take the theme's ground, as the installed app colours them.
text(p, '9:41', 36, 27, 13, C.fg, 'Medium');
await ico('signal', 300, 14, 14, C.fg); await ico('wifi', 320, 14, 14, C.fg); await ico('battery-full', 340, 12, 18, C.fg);

// Header: the mark (it is the lens) and Search.
p.drawImage(logo, 16, 47, 22.6, 28);
await ico('search', 346, 51, 22);

// The days strip: the month above, a slot for the chosen day, planned tasks shading each box.
text(p, 'November', PW / 2 - width('November', 11, 'Medium') / 2, 100, 11, C.faint, 'Medium');
const shade = [alpha(C.fg, 0.05), alpha(C.brand, 0.2), alpha(C.brand, 0.4), alpha(C.brand, 0.65), C.brand];
const strip: [string, number, number, number][] = [['Sat', 31, 0, -2], ['Sun', 1, 0, -1], ['Mon', 2, 2, 0], ['Tue', 3, 1, 1], ['Wed', 4, 3, 2], ['Thu', 5, 1, 3]];
for (const [i, [wd, dn, n, off]] of strip.entries()) {
  const x = 24 + i * 58, y = 110, far = Math.abs(off);
  p.globalAlpha = off < 0 ? 0.35 : far <= 1 ? 1 : 0.55;
  if (far === 0) { p.beginPath(); p.roundRect(x + 1, y + 1, 50, 54, 12); p.strokeStyle = C.brand; p.lineWidth = 2; p.stroke(); }
  panel(p, x + 4, y + 4, 44, 48, 10, shade[n]!);
  const ink = n >= 3 ? C.bg : far === 0 ? C.brand : C.dim;
  p.globalAlpha *= 0.8; text(p, wd, x + 26 - width(wd, 11, 'Medium') / 2, y + 24, 11, ink, 'Medium'); p.globalAlpha /= 0.8;
  text(p, String(dn), x + 26 - width(String(dn), 17, far === 0 ? 'Bold' : 'Medium') / 2, y + 43, 17, ink, far === 0 ? 'Bold' : 'Medium');
  p.globalAlpha = 1;
}
for (const [x0, x1] of [[12, 12 + 36], [378, 378 - 36]] as const) {
  const g = p.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, C.bg); g.addColorStop(1, alpha(C.bg, 0));
  p.fillStyle = g; p.fillRect(Math.min(x0, x1), 106, 36, 64);
}

// The task box: Today on a capsule, Inbox and Upcoming quiet, a tag filter and Add.
const todayW = width('Today', 17, 'Bold');
panel(p, 6, 186, 8 + 17 + 6 + todayW + 8, 28, 14, TINT.accent);
await ico('star', 14, 191, 17, C.brand);
text(p, 'Today', 37, 206, 17, C.fg, 'Bold');
p.globalAlpha = 0.25;
text(p, 'Inbox', 6 + 8 + 17 + 6 + todayW + 8 + 2 + 8, 206, 17, C.fg, 'Bold');
text(p, 'Upcoming', 6 + 8 + 17 + 6 + todayW + 8 + 2 + 8 + width('Inbox', 17, 'Bold') + 16 + 2, 206, 17, C.fg, 'Bold');
p.globalAlpha = 1;
const ghost = async (name: string, x: number, y: number, brand = false) => {
  if (brand) return ico(name, x + 7, y + 7, 22, C.brand);
  p.beginPath(); p.roundRect(x + 0.5, y + 0.5, 31, 31, 8); p.strokeStyle = C.line; p.lineWidth = 1; p.stroke();
  return ico(name, x + 8, y + 8, 16);
};
await ghost('hash', 306, 184); await ghost('plus', 346, 182, true);

const tagPill = (label: string, x: number, y: number, color: { fg: string; line: string }) => {
  panel(p, x, y, width(label, 10.5, 'Medium') + 16, 18, 9, alpha(color.line, 0.22));
  text(p, label, x + 8, y + 13, 10.5, color.fg, 'Medium');
};
const tasks = [
  { title: 'Sketch the workspace layout', meta: 'A quieter workspace', icon: 'notebook-text' },
  { title: 'Pick up a new notebook', meta: '18:30', icon: 'bell' },
  { title: 'Plan the mountain weekend', tag: '#travel', icon: 'flag', meta: 'Friday' },
  { title: 'Water the plants', meta: 'Every 3 days', icon: 'repeat' },
];
p.save(); p.beginPath(); p.rect(0, 224, PW, 214); p.clip();
let ty = 224;
for (const task of tasks) {
  const h = 60, mid = ty + 8 + 11;
  for (const dx of [0, 5]) for (const dy of [-5, 0, 5]) { p.fillStyle = C.faint; p.beginPath(); p.arc(18 + dx, mid + dy, 1.4, 0, Math.PI * 2); p.fill(); }
  p.strokeStyle = C.faint; p.lineWidth = 1.5; p.beginPath(); p.arc(48, mid, 9, 0, Math.PI * 2); p.stroke();
  text(p, task.title, 70, ty + 8 + 16, 16);
  const mcolor = task.icon === 'flag' ? C.warn : C.faint;
  await ico(task.icon, 70, ty + 33, 13, mcolor);
  text(p, task.meta, 87, ty + 44, 12, mcolor);
  if (task.tag) tagPill(task.tag, 87 + width(task.meta, 12, 'Regular') + 12, ty + 31, NOTE_COLORS.blue);
  ty += h;
}
p.restore();
const fade = p.createLinearGradient(0, 388, 0, 438); fade.addColorStop(0, alpha(C.bg, 0)); fade.addColorStop(1, C.bg);
p.fillStyle = fade; p.fillRect(0, 388, PW, 50);

// The notes: a heading with the count and its controls, then tiles in two columns.
text(p, 'Notes', 16, 470, 20, C.fg, 'Bold');
text(p, '6', 16 + width('Notes', 20, 'Bold') + 6, 465, 12, C.faint);
await ghost('hash', 222, 448); await ghost('tags', 262, 448); await ghost('arrow-down-up', 302, 448); await ghost('plus', 346, 446, true);

const TW = 173, TOP = 496;
const tiles = [
  { col: 0, y: TOP, h: 250, color: 'blue', pic: [220, 416, 248, 100], lines: ['A quieter', 'workspace'], body: ['A small studio, a clear', 'desk, and space to think.'], tag: '#work', age: '2m' },
  { col: 1, y: TOP, h: 250, color: 'green', pic: [482, 416, 125, 100], lines: ['Weekend in', 'the mountains'], body: ['Two days off the grid.', 'Take the scenic route.'], tag: '#travel', age: '1h' },
  { col: 0, y: TOP + 262, h: 150, color: 'purple', lines: ['Ideas worth', 'keeping'], body: ['A running list. No', 'filtering. Quiet, yours.'], tag: '#reading', age: '3h' },
  { col: 1, y: TOP + 262, h: 150, color: 'pink', lines: ['The reading', 'list'], body: ['Slow books for the', 'long evenings ahead.'], tag: '#reading', age: '1d' },
] as const;
for (const t of tiles) {
  const x = 16 + t.col * (TW + 12), n = NOTE_COLORS[t.color];
  panel(p, x, t.y, TW, t.h, 16, n.bg, n.line);
  let top = t.y + 12;
  if ('pic' in t) {
    p.save(); p.beginPath(); p.roundRect(x + 1, t.y + 1, TW - 2, 105, [15, 15, 0, 0]); p.clip();
    p.drawImage(web, t.pic[0], t.pic[1], t.pic[2], t.pic[3], x + 1, t.y + 1, TW - 2, 105); p.restore();
    top = t.y + 118;
  }
  t.lines.forEach((line, j) => text(p, line, x + 12, top + 16 + j * 19, 16, n.fg, 'Semibold'));
  t.body.forEach((line, j) => text(p, line, x + 12, top + 66 + j * 18, 13, n.fg));
  tagPill(t.tag, x + 12, top + 92, n);
  text(p, t.age, x + 12, top + 126, 11, n.line);
}

// The tab bar: a floating pill, the active tab's label shown on a brand capsule.
p.fillStyle = C.bg; p.fillRect(0, 838, PW, 94);
panel(p, 16, 850, 358, 60, 30, C.raised, C.line);
const tabs = [['house', 'Home'], ['list-checks', 'Tasks'], ['sparkles', 'Ask'], ['settings', 'Settings']] as const;
const widths = tabs.map(([, label], i) => (i === 0 ? 16 + 22 + 8 + width(label, 14, 'Semibold') + 16 : 12 + 22 + 12));
const gap = (346 - widths.reduce((a, b) => a + b, 0)) / 3;
let tx = 22;
for (const [i, [name, label]] of tabs.entries()) {
  const w = widths[i]!;
  if (i === 0) {
    panel(p, tx, 856, w, 48, 24, TINT.accent);
    await ico(name, tx + 16, 869, 22, C.brand);
    text(p, label, tx + 16 + 22 + 8, 886, 14, C.brand, 'Semibold');
  } else await ico(name, tx + 12, 869, 22);
  tx += w + gap;
}

const canvas = createCanvas(1600, 1050), c = canvas.getContext('2d');
const bg = c.createLinearGradient(0, 0, 1600, 1050); bg.addColorStop(0, C.card); bg.addColorStop(1, C.bg);
c.fillStyle = bg; c.fillRect(0, 0, 1600, 1050);
c.drawImage(logo, 48, 36, 27, 34);
text(c, 'TEF NOTES', 90, 61, 22, C.brand, 'Semibold');
text(c, 'Notes and tasks, together.', 48, 122, 43, C.fg, 'Medium');
text(c, 'Your own server. Your everyday tools.', 920, 115, 21, C.dim);
text(c, 'WEB APP', 48, 170, 13, C.dim, 'Semibold');
panel(c, 48, 190, 1120, 788, 18, C.bg, C.line);
c.save(); c.beginPath(); c.roundRect(49, 191, 1118, 786, 17); c.clip(); c.drawImage(web, 49, 191, 1118, 786); c.restore();
text(c, 'INSTALLED WEB APP', 1238, 201, 13, C.dim, 'Semibold');
panel(c, 1218, 221, 334, 765, 40, C.bg, C.line);
c.save(); c.beginPath(); c.roundRect(1230, 233, 310, 741, 30); c.clip(); c.drawImage(phone, 1230, 233, 310, 741); c.restore();
text(c, 'Web · Phone · CLI · Chrome clipper', 48, 1018, 17, C.dim);
text(c, 'Sample content · Phone interface illustration', 1100, 1018, 14, C.faint);
await Bun.write(`${dir}/overview.png`, canvas.toBuffer('image/png'));
console.log('Generated mark.svg and overview.png');
