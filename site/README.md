# TEF Notes site

The marketing page: Vite, React 19, Tailwind 4. Its colours and fonts come from the app (`../packages/core/src/theme.ts`, `../mobile/assets/fonts`), so build with the repo checked out whole.

- `bun install && bun run dev` to work on it, `bun run build` for static files in `dist/`, `bun run preview` to serve them.
- No screenshots: every screen in the frames is drawn in React and CSS in `src/components/mock/` (one file per screen, shared pieces in `parts.tsx`), at a fixed design size (1440 web, 390 phone) scaled to its frame by `screen.tsx`. The phone screens are the installed web app at phone width (`web/src/components/`: `tab-bar.tsx`, `home.tsx`, `days.tsx`, `task-list.tsx`, `search-drawer.tsx`, `share-page.tsx`, `assistant/`), not the frozen Android app. A `Peek` (`ui.tsx`) shows one region of a screen (`crop`, in design pixels) or a panel drawn at its own size (the assistant's dock, the clipper's popup), so a section shows the one detail it is about rather than a whole window and a whole phone. Demo content is fictional; colours and icons are the page's tokens and lucide's.
- Deploy `dist/` to any static host, or `docker build -f site/Dockerfile -t tefnotes-site .` **from the repo root** (the build context must include `packages/core` and `mobile/assets`) and serve port 80.
- The repository address (`REPO`, which the GitHub and clone links derive from) lives in `src/lib.ts`.
- GitHub Pages: `.github/workflows/pages.yml` builds it on a push to `main` that touches `site/`, `packages/core/` or `mobile/assets/`, and publishes `dist/` at `https://spyrosbazios.github.io/tef-notes/` (Settings > Pages > Source: GitHub Actions). That build sets `SITE_BASE=/tef-notes/`; `vite.config.ts` reads it as `base` and defaults to `/`, so the Dockerfile and any root-served host are unchanged. Build with it to check: `SITE_BASE=/tef-notes/ bun run build`.
- A path the page names itself goes through Vite's `base` (`%BASE_URL%` in `index.html`, `import.meta.env.BASE_URL` in code), never a bare `/...`. There is one page and no router, so no SPA fallback.

<!-- reviewed: 2026-11-09 -->
