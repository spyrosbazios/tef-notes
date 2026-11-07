// The PDF viewer inside the phone's WebView: pdf.js drawing the pages one under another (src/pdf/pages.ts, the same
// the web app's viewer uses), each as wide as the screen, pinch to zoom as the WebView does it, a counter to jump to a
// page. The phone sends the file's bytes as base64 chunks (shapes: packages/core/src/pdf-bridge.ts); this page draws,
// and tells the phone when the first page is up or the file won't open.
import "virtual:tefnotes-theme.css";
import "./host.css";
import type { FromPdf, ToPdf } from "@/core/pdf-bridge";
import { applyPageTheme } from "@/page-theme";
import { showPdf } from "@/pdf/pages";

declare global {
  interface Window { ReactNativeWebView?: { postMessage(data: string): void } }
}

const send = (m: FromPdf) => window.ReactNativeWebView?.postMessage(JSON.stringify(m));
const view = document.getElementById("pages")!;
const parts: string[] = [];

/** Base64 chunks in, the file out: through a data: URL, so the decoding is the browser's, not a JS loop over 25 MB. */
async function receive(m: ToPdf) {
  if (m.type === "theme") { applyPageTheme(m.theme); return; }
  parts.push(m.data);
  if (!m.last) return;
  try {
    const bytes = new Uint8Array(await (await fetch(`data:application/pdf;base64,${parts.join("")}`)).arrayBuffer());
    parts.length = 0;
    await showPdf(view, bytes, (pages) => send({ type: "shown", pages }));
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

// Android's WebView dispatches postMessage on `document`
document.addEventListener("message", (e) => void receive(JSON.parse((e as MessageEvent<string>).data) as ToPdf));
send({ type: "ready" });
