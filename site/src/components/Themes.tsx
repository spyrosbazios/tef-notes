import { COLORS } from "@/core/notes";
import { ACCENTS, THEMES, type Theme } from "@/core/theme";
import { Heading, Reveal, scoped } from "./ui";

function Preview({ t }: { t: Theme }) {
  return (
    <div style={scoped(t)} className="rounded-[1.1rem] border border-line bg-bg p-4 text-fg">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-bold">Today</span>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-brand">3</span>
      </div>
      <ul className="mt-3 space-y-2 text-[13px]">
        <li className="flex items-center gap-2.5"><span className="size-4 rounded-full border-[1.5px] border-brand" />Renew passport</li>
        <li className="flex items-center gap-2.5"><span className="size-4 rounded-full border-[1.5px] border-faint" />Call the plumber</li>
        <li className="flex items-center gap-2.5 text-dim line-through decoration-faint"><span className="size-4 rounded-full bg-brand" />Water the plants</li>
      </ul>
      <div data-color="yellow" className="mt-3 rounded-xl border border-tile-line/40 bg-tile p-3 text-tile-fg">
        <p className="text-[13px] font-bold">Garage door codes</p>
        <p className="mt-0.5 text-xs opacity-80">Side door, then the back gate</p>
      </div>
      <div className="mt-3 flex gap-1.5">
        {COLORS.map((c) => <span key={c} data-color={c} className="size-3.5 rounded-full border border-tile-line bg-tile" />)}
      </div>
    </div>
  );
}

export function Themes() {
  return (
    <section id="themes" className="relative border-t border-hair bg-card/40 py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Heading eyebrow="Themes" title="Black as a screen can be. Or paper.">
          Sixteen themes and eighteen accents, the same on every device. This page wears the first.
        </Heading>
        {/* A grid, or on a phone one row scrolled sideways with a card per stop: sixteen stacked ran six screens long */}
        <div className="strip mt-16 grid gap-4 max-sm:-mx-5 max-sm:snap-x max-sm:snap-mandatory max-sm:auto-cols-[min(76vw,17rem)] max-sm:grid-flow-col max-sm:overflow-x-auto max-sm:px-5 max-sm:pb-2 max-sm:scroll-px-5 sm:grid-cols-2 lg:grid-cols-4">
          {Object.values(THEMES).map((t, i) => (
            <Reveal key={t.name} delay={Math.min(i, 3) * 70} className="max-sm:snap-start">
              <div className="rounded-card border border-line bg-glass p-3 backdrop-blur transition-transform duration-300 hover:-translate-y-1">
                <Preview t={t} />
                <div className="flex items-center justify-between px-2 pb-1 pt-4">
                  <span className="font-bold">{t.label}</span>
                  <span className="flex" aria-hidden="true">
                    {[t.C.bg, t.C.card, t.C.raised, t.C.brand].map((c, k) => (
                      <span key={k} style={{ background: c }} className="-ml-1.5 size-5 rounded-full border border-line first:ml-0" />
                    ))}
                  </span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-12 flex flex-col items-center gap-4 max-sm:mt-8">
          <p className="text-sm text-faint max-sm:hidden">Swipe the row on a phone, or pick a theme and an accent in Settings.</p>
          <div className="flex flex-wrap justify-center gap-3" aria-hidden="true">
            <span style={{ background: THEMES.oled.C.brand }} className="size-7 rounded-full ring-2 ring-fg ring-offset-4 ring-offset-bg" />
            {Object.values(ACCENTS).slice(1).map((a) => (
              <span key={a.label} title={a.label} style={{ background: a.dark }} className="size-7 rounded-full" />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
