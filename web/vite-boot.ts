// The boot: what index.html shows before any script of ours has run, so the installed app's launch has no blank or
// wrong-coloured frame between Android's splash (the manifest's colours, which the server gives the chosen theme:
// server/pb_hooks/manifest.pb.js) and the first screen. An inline script reads the preferences this browser keeps
// (src/lib/storage-keys.ts `STORAGE.prefs`, hooks/prefs.ts) and puts the theme's ground, text and accent on :root, with the `dark`
// class, the scheme and the tab's colour, as hooks/appearance.ts does in full before React's first paint; a layer of the
// theme's ground covers the page (the stylesheet, and the body's colour, are still on their way) until the router's first
// screen is on, then fades into it (src/lib/splash.ts). The ground alone, no mark: the installed app's launch has just shown
// the icon on Android's splash, and a second one with it read as a second splash screen (2026-11-09). Every colour is the
// core's palette, read at build: nothing is written twice. The fade is Animate UI's `transition.reveal` (300ms, ease.out).
import type { Plugin } from "vite";
import { ACCENTS, DEFAULT_ACCENT, DEFAULT_THEME, THEMES } from "../packages/core/src/theme";
import { SPLASH_ID } from "./src/lib/boot";
import { STORAGE } from "./src/lib/storage-keys";

/** Each theme as [ground, text, brand, scheme]; each accent as [on dark, on light]. */
const data = () => ({
  themes: Object.fromEntries(Object.values(THEMES).map((t) => [t.name, [t.C.bg, t.C.fg, t.C.brand, t.scheme]])),
  accents: Object.fromEntries(Object.entries(ACCENTS).map(([k, a]) => [k, [a.dark, a.light]])),
});

const script = () => `(function(){
var T=${JSON.stringify(data().themes)},A=${JSON.stringify(data().accents)},t=${JSON.stringify(DEFAULT_THEME)},a=${JSON.stringify(DEFAULT_ACCENT)};
try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE.prefs)})||"{}")||{};if(T[p.theme])t=p.theme;if(p.accent==="theme"||A[p.accent])a=p.accent;}catch(e){}
var l=T[t],s=l[3],b=a==="theme"?l[2]:A[a][s==="dark"?0:1],r=document.documentElement,st=r.style;
st.setProperty("--tf-bg",l[0]);st.setProperty("--tf-fg",l[1]);st.setProperty("--tf-brand",b);
st.colorScheme=s;r.classList.toggle("dark",s==="dark");r.dataset.scheme=s;
var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=l[0];
})();`;

const style = () => `
#${SPLASH_ID}{position:fixed;inset:0;z-index:1000;background:var(--tf-bg)}
#${SPLASH_ID}[data-done]{opacity:0;pointer-events:none;transition:opacity 300ms cubic-bezier(0.23,1,0.32,1)}
@media (prefers-reduced-motion:reduce){#${SPLASH_ID}[data-done]{transition:none}}
`;

export function boot(): Plugin {
  return {
    name: "tefnotes-boot",
    transformIndexHtml: () => [
      { tag: "script", children: script(), injectTo: "head" },
      { tag: "style", children: style(), injectTo: "head" },
      { tag: "div", attrs: { id: SPLASH_ID, "aria-hidden": "true" }, injectTo: "body-prepend" },
    ],
  };
}
