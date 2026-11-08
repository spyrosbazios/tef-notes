import { Check } from "lucide-react";
import { CLIP, ClipperPopup } from "./mock/Clipper";
import { Heading, Peek, Reveal } from "./ui";

const POINTS = [
  "The toolbar button, or right-click a page, a selection, a link or a picture",
  "Your own notes and open tasks suggested, the best one focused: Enter saves",
  "A few words of your own re-rank the suggestions; a summary if you tick it",
  "Pictures saved into the note, downscaled as the app does it",
  "Installed from your own server, updates itself; talks to nothing else",
];

export function Clipper() {
  return (
    <section id="clipper" className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32">
      <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-6">
          <Heading eyebrow="Chrome clipper" title="Save the page you are on, where it belongs." center={false}>
            The server says which of your notes and tasks it fits. You pick; only then is it written.
          </Heading>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15.5px]">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-brand"><Check className="size-3" strokeWidth={3} /></span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={100} className="lg:col-span-6">
          <figure>
            <Peek label="The clipper's popup under Chrome's toolbar: the page, two tags ticked and one offered, a note being typed, Add a summary ticked, and four places to save it with the travel note picked"
              size={CLIP} className="mx-auto max-w-md"><ClipperPopup /></Peek>
            <figcaption className="mt-5 text-center text-sm text-faint">The popup on a restaurant guide: the travel note is the pick, a task and another note are offered.</figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
