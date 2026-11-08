// A PDF drawn by pdf.js into an element: the pages one under another, each as wide as the element, a counter that
// sticks to the bottom ("3 / 12": tap it to type a page to jump to) and a zoom. The phone's viewer page (pdf-host)
// and the web app's viewer dialog (components/pdf-viewer.tsx) are both this, so a PDF reads the same on each.
import { getDocument, RenderingCancelledException, TextLayer, type PDFPageProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
// Sets globalThis.pdfjsWorker, which makes pdf.js run its worker in this thread: no Worker to load from a file:// page
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
import { LiquidGlassEngine } from "quick-liquid";
import { glassOfPage } from "../lib/glass";
import "./pages.css";

/** Canvas memory is the limit, not the file: only the pages near the screen hold a bitmap. */
const MAX_CANVAS_WIDTH = 1800, SHARPNESS = 1.6;

/** `text` is pdf.js's invisible text over the canvas, so a page's words can be selected and copied. */
type Slot = { el: HTMLDivElement; canvas: HTMLCanvasElement; page: PDFPageProxy; task: RenderTask | null; text: TextLayer | null; drawn: boolean };

export type PdfPages = {
  pages: number;
  /** Pages as wide as `factor` times the element (1 = fitted; more scrolls sideways in the element). */
  zoom(factor: number): void;
  /** Scroll to page `n` (1-based). */
  goto(n: number): void;
  destroy(): void;
};

async function draw(s: Slot) {
  if (s.drawn) return;
  s.drawn = true;
  const base = s.page.getViewport({ scale: 1 }), css = s.el.clientWidth || base.width;
  const out = Math.min(SHARPNESS * devicePixelRatio, MAX_CANVAS_WIDTH / css);
  const viewport = s.page.getViewport({ scale: (css / base.width) * out });
  s.canvas.width = Math.floor(viewport.width);
  s.canvas.height = Math.floor(viewport.height);
  s.task = s.page.render({ canvas: s.canvas, viewport });
  const box = document.createElement("div");
  box.className = "textLayer";
  s.el.style.setProperty("--total-scale-factor", String(css / base.width));
  s.el.append(box);
  s.text = new TextLayer({ textContentSource: s.page.streamTextContent(), container: box, viewport: s.page.getViewport({ scale: css / base.width }) });
  void s.text.render().catch(() => {});
  try { await s.task.promise; } catch (e) { if (!(e instanceof RenderingCancelledException)) throw e; }
}

/** Off the screen: the bitmap goes, the placeholder keeps the page's room. */
function drop(s: Slot) {
  s.task?.cancel();
  s.task = null;
  s.text?.cancel();
  s.text = null;
  s.el.querySelector(".textLayer")?.remove();
  s.canvas.width = s.canvas.height = 0;
  s.drawn = false;
}

/** The counter: "n / total", and a tap turns it into a field for the page to jump to. Liquid glass (lib/glass.ts), the pages
 *  scrolling under it seen through: the engine's layers sit beside `content` (its `.ql-content`), which is what the label swaps in. */
function counter(total: number, goto: (n: number) => void) {
  const pill = document.createElement("button"), content = document.createElement("span"), label = document.createElement("span");
  pill.type = "button";
  pill.className = "pdf-pill";
  pill.setAttribute("aria-label", "Go to page");
  content.className = "ql-content";
  pill.append(content);
  content.append(label);
  const engine = new LiquidGlassEngine(pill, glassOfPage({ material: "thin", borderRadius: 16, elevation: 0.5 }));
  const show = (n: number) => { label.textContent = `${n} / ${total}`; };
  const ask = () => {
    const input = document.createElement("input");
    input.type = "number"; input.min = "1"; input.max = String(total); input.inputMode = "numeric";
    const done = (jump: boolean) => {
      const n = Math.round(Number(input.value));
      input.remove();
      content.replaceChildren(label);
      if (jump && n >= 1 && n <= total) goto(n);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(false));
    content.replaceChildren(input, ` / ${total}`);
    input.focus();
  };
  pill.addEventListener("click", (e) => { if (!(e.target instanceof HTMLInputElement)) ask(); });
  return { pill, show, destroy: () => engine.destroy() };
}

/** Draw `bytes` into `root` (emptied first). `onFirst` is told the page count when the first page is in place; the
 *  promise resolves when all of them are. */
export async function showPdf(root: HTMLElement, bytes: Uint8Array, onFirst?: (pages: number) => void): Promise<PdfPages> {
  const doc = await getDocument({ data: bytes }).promise;
  root.replaceChildren();
  root.classList.add("pdf-pages");
  const slots = new Map<Element, Slot>(), list: Slot[] = [];
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = slots.get(e.target);
      if (!s) continue;
      if (e.isIntersecting) void draw(s).catch(() => drop(s)); else drop(s);
    }
  }, { rootMargin: "100% 0px" });

  const goto = (n: number) => list[Math.min(Math.max(n, 1), list.length) - 1]?.el.scrollIntoView({ block: "start" });
  const { pill, show, destroy: dropCounter } = counter(doc.numPages, goto);
  show(1);

  /** The page at the top of the screen: the first whose bottom edge is below the line a third of the way down. */
  let frame = 0;
  const track = () => {
    frame = 0;
    const line = innerHeight / 3;
    const at = list.findIndex((s) => s.el.getBoundingClientRect().bottom > line);
    show((at < 0 ? list.length : at + 1) || 1);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(track); };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), { width, height } = page.getViewport({ scale: 1 });
    const el = document.createElement("div"), canvas = document.createElement("canvas");
    el.className = "pdf-page";
    el.style.aspectRatio = `${width} / ${height}`;
    el.append(canvas);
    const s: Slot = { el, canvas, page, task: null, text: null, drawn: false };
    slots.set(el, s);
    list.push(s);
    seen.observe(el);
    if (n === 1) root.append(el, pill);
    else root.insertBefore(el, pill);
    if (n === 1) onFirst?.(doc.numPages);
  }

  return {
    pages: doc.numPages,
    zoom(factor) {
      root.style.setProperty("--pdf-zoom", String(factor));
      for (const s of list) { drop(s); seen.unobserve(s.el); seen.observe(s.el); }     // observing again says where each is now
    },
    goto,
    destroy() {
      document.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
      seen.disconnect();
      list.forEach(drop);
      dropCounter();
      void doc.loadingTask.destroy();
      root.replaceChildren();
    },
  };
}
