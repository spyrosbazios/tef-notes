// What the hooks use of the clients' TypeScript, bundled for PocketBase's JS VM (goja) by build.ts into lib/core.js, so a
// hook writes a note, a clip's text, a link and the writing model's call exactly as the clients and the agent do: one
// copy of each rule. Only pure code belongs here: nothing that does I/O or needs a package (build.ts refuses a bundle
// that requires anything but lib/url.js, goja's one missing global the bundled code reads).

export { appended, fold, MEMORY, newNotePath, noteIdOf, parseNote, serializeNote, withBody, withFlags } from "../../../packages/core/src/notes";
export { noteColumns } from "../../../packages/core/src/record-contracts";
export { fileMarkdown, linkPath, pdfName, photoName } from "../../../packages/core/src/photos";
export { localDay } from "../../../packages/core/src/time";
export { bodyFor, titleFor } from "../../../packages/core/src/share";
export { CLIP_FILES, CLIP_TEXT } from "../../../packages/core/src/clip";
export { LINK_TYPES, linkColumn, linkProblem } from "../../../packages/core/src/record-links";
export { ago, indexLine, listed, RECENT } from "../../agent/src/note-index";
export { baseOf, modelOf, providerOf, PROVIDERS } from "../../agent/src/providers";
