import { useEffect, useRef } from "react";
import { Heading, Reveal } from "./ui";

/** The promo film (../../../video), when this build has it: the Pages workflow renders it into public/ before it builds
 *  the page (vite.config.ts sets __FILM__). A build without one, the Dockerfile's or a local one, has no such section. It
 *  plays, muted, while it is in view; a visitor who asks for no motion presses play themselves. */
export function Film() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      // A browser may refuse to start a video by itself: the controls are there, so the refusal needs no answer.
      if (e?.isIntersecting) video.play().catch(() => undefined);
      else video.pause();
    }, { threshold: 0.5 });
    io.observe(video);
    return () => io.disconnect();
  }, []);
  if (!__FILM__) return null;
  const base = import.meta.env.BASE_URL;
  return (
    <section id="film" className="relative mx-auto max-w-6xl px-5 pb-24 sm:px-8 md:pb-32">
      <Heading eyebrow="The film" title="The whole app, in half a minute." />
      <Reveal className="relative mt-14">
        <div className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-[3rem] bg-glow-soft blur-3xl" aria-hidden="true" />
        <video ref={ref} controls muted loop playsInline preload="none" poster={`${base}film-poster.jpg`} src={`${base}film.mp4`}
          aria-label="A half-minute film of TEF Notes: Home on the laptop and the phone, the clipper, the assistant, tasks, lenses and themes"
          className="aspect-video w-full rounded-2xl border border-line bg-card shadow-lift ring-1 ring-hair" />
      </Reveal>
    </section>
  );
}
