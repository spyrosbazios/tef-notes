// The messages between the app and the PDF viewer page in its WebView (web/pdf-host): JSON strings over `postMessage`.
// Types only, so the page and the app cannot drift apart.
import type { PageTheme } from "./page-theme";

/** App to page. The PDF's bytes as base64, in order, a piece per message (one 25 MB string is too much for a single message);
 *  the theme before the first chunk and again on a switch. */
export type ToPdf = { type: "chunk"; data: string; last: boolean } | { type: "theme"; theme: PageTheme };

/** Page to app. */
export type FromPdf =
  /** The page is up: send the chunks. */
  | { type: "ready" }
  /** The first page is drawn. */
  | { type: "shown"; pages: number }
  /** The file isn't a PDF this viewer can read. */
  | { type: "error"; message: string };
