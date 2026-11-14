// The agent sidecar: the chat agent's loop, beside PocketBase in the same compose (server/docker-compose.yml), because
// PocketBase's JS hooks can't stream. Served same-origin under /agent/* by a reverse proxy on a private network (e.g.
// a tunnel such as `tailscale serve`); no sign-in, like PocketBase: that network is the gate, so it listens on loopback only on the host.
import { chat } from "./agent";
import { addTaskRoute, helloRoute, lensRoute, notesRoute, tasksRoute, tickRoute } from "./companion";
import { drawingPictureRoute } from "./drawing-picture";
import { find } from "./find";
import { catalog } from "./models";
import { ocrRoute, startOcr } from "./ocr";
import { allPdfs, pagesRoute, readScans, thumbRoute } from "./pdfs";
import { mapRoute, placeRoute, suggestRoute } from "./places";
import { Notes } from "./notes";
import { keyRoute, subscribeRoute, unsubscribeRoute } from "./push";
import { startReminders } from "./reminders";
import { reader } from "./reader";
import { search } from "./search";
import { steerRoute } from "./steer";
import { semantic } from "./semantic";
import { transcribe, warmSpeech } from "./transcribe";

const server = { url: process.env.TEF_NOTES_PB ?? "http://127.0.0.1:8097" };
const port = Number(process.env.PORT ?? 8098);

Bun.serve({
  port,
  hostname: process.env.HOST ?? "127.0.0.1",
  idleTimeout: 255,                          // a reply can think for a while between chunks; keep-alives come every 15 s
  routes: {
    "/agent/chat": { POST: (req) => chat(req, server) },
    "/agent/chat/:id/steer": { POST: (req) => steerRoute(req, req.params.id) },
    "/agent/find": { POST: (req) => find(req, server) },
    "/agent/search": { GET: (req) => search(req, server) },
    "/agent/reader": { GET: (req) => reader(req, server) },
    "/agent/pdf-thumb": { GET: (req) => thumbRoute(req, server) },
    "/agent/drawing-picture": { POST: (req) => drawingPictureRoute(req) },
    "/agent/pdf-pages": { GET: (req) => pagesRoute(req, server) },
    "/agent/ocr": { GET: () => ocrRoute() },
    "/agent/places/suggest": { GET: (req) => suggestRoute(req) },
    "/agent/places/place": { GET: (req) => placeRoute(req) },
    "/agent/places/map": { GET: (req) => mapRoute(req) },
    "/agent/push/key": { GET: () => keyRoute() },
    "/agent/push/subscribe": { POST: (req) => subscribeRoute(req, server), DELETE: (req) => unsubscribeRoute(req, server) },
    "/agent/transcribe": { POST: (req) => transcribe(req) },
    "/agent/transcribe/warm": { POST: (req) => warmSpeech(req) },
    "/agent/models": { GET: async () => Response.json(await catalog()) },
    "/agent/companion/hello": { GET: () => helloRoute(server) },
    "/agent/companion/tasks": { GET: (req) => tasksRoute(req, server), POST: (req) => addTaskRoute(req, server) },
    "/agent/companion/tasks/:id/done": { POST: (req) => tickRoute(server, req.params.id) },
    "/agent/companion/notes": { GET: () => notesRoute(server) },
    "/agent/companion/lens": { POST: (req) => lensRoute(req, server) },
  },
  fetch: () => new Response("Not found", { status: 404 }),
  error: (e) => {
    console.error(`agent: ${e.message}`);
    return new Response("The agent failed", { status: 500 });
  },
});

/** Keeps search by meaning warm: the model loaded and every note embedded before anyone searches (a search also
 *  catches up on its own). */
const WARM = 10 * 60_000;
const warm = () => new Notes(server).list().then(async (n) => semantic().sync(n, await allPdfs(server, n)))
  .catch((e) => console.error(`agent: indexing notes by meaning failed: ${(e as Error).message}`));
void warm();
setInterval(warm, WARM);

/** Scanned PDFs (ocr.ts): every minute, the ones attached since are queued for reading. */
const SCANS = 60_000;
if (startOcr()) {
  const scans = () => readScans(server).catch((e) => console.error(`agent: looking for scanned PDFs failed: ${(e as Error).message}`));
  void scans();
  setInterval(scans, SCANS);
}

startReminders(server);

console.error(`agent: listening on ${port}, notes at ${server.url}`);
