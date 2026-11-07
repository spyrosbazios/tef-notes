// README artwork. Run from the repository root: bun docs/assets/render.ts
// The web image is a frame of the sample recording. The Android view is an illustration
// of mobile's Home screen, with the same sample content, rather than a device screenshot.
import { createCanvas, GlobalFonts, loadImage } from '../../server/agent/node_modules/@napi-rs/canvas/index.js';
import { THEMES, withAccent } from '../../packages/core/src/theme';
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

// Illustrate the phone using the Home layout in mobile/ and site/src/components/mock/PhoneHome.tsx.
const phone = createCanvas(390, 875), p = phone.getContext('2d');
p.fillStyle = C.bg; p.fillRect(0, 0, 390, 875);
text(p, '9:41', 22, 28, 14, C.fg, 'Semibold');
p.drawImage(await icon('wifi', C.fg), 318, 13, 18, 18);
p.drawImage(await icon('battery-full', C.fg), 344, 11, 24, 22);
p.drawImage(logo, 20, 53, 24, 30);
p.drawImage(await icon('chevron-down'), 52, 63, 12, 12);
p.drawImage(await icon('search'), 344, 57, 24, 24);
text(p, 'November', 20, 112, 15, C.dim, 'Medium');
const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
for (let i = 0; i < 7; i++) {
  const x = 20 + i * 51;
  text(p, days[i]!, x + 14, 141, 12, C.dim);
  if (i === 5) panel(p, x, 152, 42, 42, 15, C.brand);
  text(p, String(i + 2), x + 14, 180, 16, i === 5 ? C.bg : C.fg, 'Medium');
}
p.drawImage(await icon('star', C.brand), 20, 218, 20, 20);
text(p, 'Today', 48, 236, 23, C.fg, 'Bold');
text(p, 'Inbox', 131, 236, 18, C.faint, 'Medium');
text(p, 'Upcoming', 200, 236, 18, C.faint, 'Medium');
p.drawImage(await icon('plus', C.brand), 345, 218, 22, 22);
for (const [i, task] of ['Sketch the workspace layout', 'Pick up a new notebook', 'Plan the mountain weekend'].entries()) {
  const y = 270 + i * 51;
  p.strokeStyle = C.faint; p.lineWidth = 1.5; p.beginPath(); p.arc(29, y + 4, 9, 0, Math.PI * 2); p.stroke();
  text(p, task, 49, y + 9, 16);
  if (i === 0) text(p, 'A quieter workspace', 49, y + 27, 11, C.dim);
}
text(p, 'Notes', 20, 452, 23, C.fg, 'Bold');
text(p, '6', 86, 451, 13, C.faint);
p.drawImage(await icon('list-filter'), 277, 432, 19, 19);
p.drawImage(await icon('tags'), 310, 432, 19, 19);
p.drawImage(await icon('plus', C.brand), 346, 431, 22, 22);
for (const [i, color] of [[0, 'blue'], [1, 'green']] as const) {
  const x = 16 + i * 183, n = NOTE_COLORS[color];
  panel(p, x, 470, 175, 237, 17, n.bg, n.line);
  p.save(); p.beginPath(); p.roundRect(x + 1, 471, 173, 105, [16, 16, 0, 0]); p.clip();
  if (i === 0) p.drawImage(web, 220, 416, 248, 100, x + 1, 471, 173, 105);
  else p.drawImage(web, 482, 416, 125, 100, x + 1, 471, 173, 105);
  p.restore();
  const lines = i === 0 ? ['A quieter', 'workspace'] : ['Weekend in', 'the mountains'];
  lines.forEach((line, j) => text(p, line, x + 12, 598 + j * 19, 16, n.fg, 'Semibold'));
  const body = i === 0 ? ['A small studio, a clear', 'desk, and space to think.'] : ['Two days off the grid.', 'Take the scenic route.'];
  body.forEach((line, j) => text(p, line, x + 12, 649 + j * 19, 13, n.fg));
  text(p, i === 0 ? '#work' : '#travel', x + 12, 690, 12, n.fg);
}
panel(p, 16, 720, 175, 66, 17, NOTE_COLORS.pink.bg, NOTE_COLORS.pink.line);
text(p, 'The reading list', 28, 746, 16, NOTE_COLORS.pink.fg, 'Semibold');
panel(p, 199, 720, 175, 66, 17, NOTE_COLORS.purple.bg, NOTE_COLORS.purple.line);
text(p, 'Ideas worth keeping', 211, 746, 15, NOTE_COLORS.purple.fg, 'Semibold');
p.fillStyle = C.card; p.fillRect(0, 802, 390, 73);
p.fillStyle = C.line; p.fillRect(0, 802, 390, 1);
for (const [i, name, label] of [[0, 'house', 'Home'], [1, 'circle-check', 'Tasks'], [2, 'sparkles', 'Ask'], [3, 'settings', 'Settings']] as const) {
  const x = 31 + i * 97;
  if (i === 0) panel(p, x - 10, 809, 56, 32, 16, TINT.accent);
  p.drawImage(await icon(name, i === 0 ? C.brand : C.dim), x + 7, 814, 22, 22);
  text(p, label, x + (label === 'Settings' ? -6 : 4), 858, 12, i === 0 ? C.brand : C.dim, 'Medium');
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
text(c, 'ANDROID', 1238, 201, 13, C.dim, 'Semibold');
panel(c, 1218, 221, 334, 765, 40, C.bg, C.line);
c.save(); c.beginPath(); c.roundRect(1230, 233, 310, 741, 30); c.clip(); c.drawImage(phone, 1230, 233, 310, 741); c.restore();
text(c, 'Web · Android · CLI · Chrome clipper', 48, 1018, 17, C.dim);
text(c, 'Sample content · Android interface illustration', 1100, 1018, 14, C.faint);
await Bun.write(`${dir}/overview.png`, canvas.toBuffer('image/png'));
console.log('Generated mark.svg and overview.png');
