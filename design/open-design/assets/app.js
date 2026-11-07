// Shared by every board: lucide icons (<i data-i="name" data-s="16" data-w="2">), the app's mark (<i data-mark>),
// the theme and accent (kept in localStorage, so every board wears the one picked in design-system.html).
(function () {
  const KEY = "tefnotes-od-theme";
  const meta = window.TF;
  const NS = "http://www.w3.org/2000/svg";

  function apply(theme, accent) {
    const t = meta.themes.find((x) => x.name === theme) || meta.themes[0];
    const root = document.documentElement;
    root.dataset.theme = t.name;
    root.dataset.scheme = t.scheme;
    root.dataset.accent = accent || "theme";
    try { localStorage.setItem(KEY, JSON.stringify({ theme: t.name, accent: accent || "theme" })); } catch (e) { /* storage off */ }
    document.dispatchEvent(new CustomEvent("tf-theme", { detail: { theme: t, accent: accent || "theme" } }));
  }
  function saved() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; }
  }

  function icon(el) {
    const node = window.TF_ICONS[el.dataset.i];
    if (!node) return;
    const s = el.dataset.s || "16";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", s);
    svg.setAttribute("height", s);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", el.dataset.w || "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of node) {
      const c = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) if (k !== "key") c.setAttribute(k, v);
      svg.appendChild(c);
    }
    el.replaceChildren(svg);
  }
  function mark(el) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", meta.mark.viewBox);
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute("d", meta.mark.path);
    svg.appendChild(p);
    el.replaceChildren(svg);
  }
  window.tfDraw = function (root) {
    (root || document).querySelectorAll("i[data-i]").forEach(icon);
    (root || document).querySelectorAll("i[data-mark]").forEach(mark);
  };

  // The switcher: a select of the 16 themes (dark ones first, as THEME_NAMES orders them) and the accent swatches.
  function switcher(host) {
    const s = saved();
    const sel = document.createElement("select");
    sel.className = "ds-select";
    sel.setAttribute("aria-label", "Theme");
    for (const scheme of ["dark", "light"]) {
      const g = document.createElement("optgroup");
      g.label = scheme === "dark" ? "Dark" : "Light";
      for (const t of meta.themes.filter((x) => x.scheme === scheme)) {
        const o = document.createElement("option");
        o.value = t.name;
        o.textContent = t.label + (t.name === "oled" ? " (default)" : "");
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    sel.value = document.documentElement.dataset.theme;
    const sw = document.createElement("div");
    sw.className = "ds-accents";
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", "Accent");
    const names = ["theme", ...Object.keys(meta.accents)];
    function paint() {
      const t = meta.themes.find((x) => x.name === sel.value);
      sw.querySelectorAll("button").forEach((b) => {
        const a = b.dataset.a;
        b.style.background = a === "theme" ? t.C.brand : meta.accents[a][t.scheme];
        b.setAttribute("aria-checked", String(a === document.documentElement.dataset.accent));
      });
    }
    for (const a of names) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.a = a;
      b.setAttribute("role", "radio");
      b.title = a === "theme" ? "Theme's own" : meta.accents[a].label;
      b.setAttribute("aria-label", b.title);
      if (a === "theme") b.classList.add("is-theme");
      b.addEventListener("click", () => { apply(sel.value, a); paint(); });
      sw.appendChild(b);
    }
    sel.addEventListener("change", () => { apply(sel.value, document.documentElement.dataset.accent); paint(); });
    host.append(sel, sw);
    paint();
  }

  const s = saved();
  apply(s.theme || "oled", s.accent || "theme");
  document.addEventListener("DOMContentLoaded", () => {
    window.tfDraw();
    document.querySelectorAll("[data-switcher]").forEach(switcher);
  });
})();
