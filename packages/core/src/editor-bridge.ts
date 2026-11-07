// The messages between the app and the note editor in its WebView (web/editor-host): JSON strings over
// `postMessage`. Types only, so the page and the app cannot drift apart.
import type { PageTheme } from "./page-theme";
import type { LinkPreview } from "./pocketbase";

/** The format tools the phone's note bar offers: names of the editor's commands (web/src/editor/commands.ts).
 *  `moveUp` and `moveDown` swap the list item at the cursor with its neighbour; "on" for them means the item can move. */
export const EDITOR_COMMANDS = ["bold", "italic", "taskList", "bulletList", "heading2", "link", "blockquote", "code", "moveUp", "moveDown", "undo", "redo"] as const;
export type EditorCommand = (typeof EDITOR_COMMANDS)[number];

/** App to page. (`image` below is a photo that arrived; the page's own `image` is a tap on one.) */
export type ToEditor =
  /** Show this body. The first one opens the editor; later ones replace the text (a pull, a merge) and keep the cursor.
   *  `theme`: the active theme's colours (theme.ts `pageTheme`).
   *  `images`: photo name to the file:// URI of its copy on the phone, for `../attachments/<noteId>/<name>`.
   *  `server`: the notes server's address, where a PDF's first page is drawn (`pdfThumbUrl`); null when none is set. */
  | { type: "load"; noteId: string; markdown: string; theme: PageTheme; images: Record<string, string>; server: string | null; placeholder: string }
  /** The owner switched theme while the page was open. */
  | { type: "theme"; theme: PageTheme }
  /** A photo that reached the phone after `load`. */
  | { type: "image"; name: string; uri: string }
  /** Markdown (the lines for files just attached) to put at the cursor. */
  | { type: "insert"; markdown: string }
  /** A format tool tapped in the app's bar. `link` takes an href, or none to take the link off. */
  | { type: "command"; name: EditorCommand; arg?: string }
  /** The answer to a page's `preview`: what the page at `url` says about itself, null when there is nothing to show.
   *  `failed`: the app could not find out (offline); the page asks again later. */
  | { type: "preview"; url: string; preview: LinkPreview | null; failed?: true }
  /** The answer to a page's `summarize`: the summary block, or why there is none (`error`). */
  | { type: "summary"; url: string; summary: string } | { type: "summary"; url: string; error: string }
  /** The answer to a page's `pages`: how many pages that PDF has, null when unknown (offline, no server). */
  | { type: "pages"; href: string; pages: number | null };

/** Page to app. */
export type FromEditor =
  /** The page is up: send `load`. */
  | { type: "ready" }
  /** The user edited: the whole body now. Never sent for a `load`. */
  | { type: "change"; markdown: string }
  /** The cursor or selection moved, or an edit: the tools that are on there (bold under the cursor, in a list...). Sent only when the set changed. */
  | { type: "state"; active: EditorCommand[] }
  /** A PDF chip was tapped: its href (`../attachments/<note-id>/<name>.pdf`). */
  | { type: "file"; href: string }
  /** A photo, or a drawing's chip, was tapped: the picture's `src` (`../attachments/<note-id>/<name>`; a drawing's is its PNG
   *  preview), every picture the note shows in order (`srcs`) and this one's place among them (`index`). The app opens its viewer. */
  | { type: "image"; src: string; index: number; srcs: string[] }
  /** A paragraph that is only this URL wants its card: the page can't fetch (CORS), so the app asks the server. Answered by `preview`. */
  | { type: "preview"; url: string }
  /** A link card was tapped: the app opens it (a note link in the app, anything else in the browser). */
  | { type: "link"; href: string }
  /** A link's Reader view button was tapped (every http(s) link in the body has one): the app shows the page as an
   *  article (core/reader.ts). */
  | { type: "read"; href: string }
  /** A link's Summary button was tapped: the app asks the server for the page's summary. Answered by `summary`; the page
   *  puts it under the link. */
  | { type: "summarize"; url: string }
  /** A PDF's first page is shown and wants its page count: the app asks the server. Answered by `pages`. */
  | { type: "pages"; href: string };
