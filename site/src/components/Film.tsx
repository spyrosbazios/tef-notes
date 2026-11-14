import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** The promo film (../../../video) as the hero's screen, in a build that has it (Hero.tsx): the Pages workflow renders it
 *  into public/ before it builds the page. It plays, muted and looping, while it is in view, and stops when it is not; the
 *  button (or a press on the picture) pauses it, and a film the visitor paused stays paused. A visitor who asks for no
 *  motion gets the still and presses play themselves. */
export function Film() {
  const ref = useRef<HTMLVideoElement>(null);
  const held = useRef(false);
  const [playing, setPlaying] = useState(false);
  // A browser may refuse to start a video by itself: the button is there, so the refusal needs no answer.
  const play = (video: HTMLVideoElement) => { video.play().catch(() => undefined); };

  useEffect(() => {
    const video = ref.current;
    if (!video || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) video.pause();
      else if (!held.current) play(video);
    }, { threshold: 0.35 });
    io.observe(video);
    return () => io.disconnect();
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    held.current = !video.paused;
    if (video.paused) play(video);
    else video.pause();
  };

  const base = import.meta.env.BASE_URL;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-card shadow-lift ring-1 ring-hair">
      <video ref={ref} muted loop playsInline preload="metadata" poster={`${base}film-poster.jpg`} src={`${base}film.mp4`}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle}
        aria-label="A short film of TEF Notes: Home on the laptop and the phone, a task typed in, a page clipped from Chrome, the day's tasks, the assistant, lenses and themes"
        className="block aspect-video w-full cursor-pointer" />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause the film" : "Play the film"}
        className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full border border-line bg-glass backdrop-blur transition-colors hover:border-brand-line hover:bg-accent sm:bottom-4 sm:right-4 sm:size-11">
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
    </div>
  );
}
