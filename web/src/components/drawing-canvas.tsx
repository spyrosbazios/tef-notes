// Excalidraw itself, in a chunk of its own: drawing-layer.tsx loads this file only when a drawing is opened, so the
// app's main bundle never carries it (nor does the phone's editor page, which only looks at a drawing's PNG). While it is up
// it is the assistant's too (hooks/drawing.ts `Live`): what is on it goes with every request, and the agent's `draw` edits are
// made on it as one step each, which Undo takes back like the owner's own.
import { CaptureUpdateAction, Excalidraw, exportToBlob, getSceneVersion, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FONT_SIZES, shapesOf } from "@/core/drawing";
import { liveNow, markUnsaved, setLive, type Live } from "@/hooks/drawing";
import { edited } from "@/lib/drawing-edit";

/** The long edge the PNG preview is capped at, as photos are (core/photos.ts MAX); the picture an edit answers with (the agent
 *  looks at it, the chat shows it), smaller and WebP. */
const PREVIEW_EDGE = 1600, LOOK_EDGE = 800, LOOK_QUALITY = 0.8;

export type DrawingHandle = {
  /** The scene as its JSON file and a PNG of it; null while nothing is drawn. */
  snapshot(): Promise<{ scene: Blob; preview: Blob } | null>;
  /** What `snapshot` returned was saved: the drawing has no unsaved changes from here. */
  saved(): void;
};

type Props = {
  /** The saved scene it opens on (core/drawing.ts `readScene`); null for a new drawing. */
  initial: Record<string, unknown> | null;
  /** The opening this canvas is (hooks/drawing.ts `Opened`): the note's id, the file (null while new). Whether it holds changes
   *  not saved yet goes to the drawing's store under it, each time that flips. */
  opening: { seq: number; noteId: string; name: string | null };
  ref: React.Ref<DrawingHandle>;
};

/** A picture of `elements` at most `edge` px on its long side, PNG unless asked otherwise. */
function picture(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], edge: number, mimeType = "image/png", quality?: number) {
  return exportToBlob({
    elements, files: api.getFiles(), mimeType, quality, exportPadding: 16,
    appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
    getDimensions: (w: number, h: number) => { const k = Math.min(1, edge / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k), scale: k }; },
  });
}

/** A blob as a data URL: what a tool's answer, plain JSON, can carry. */
const dataUrl = (b: Blob) => new Promise<string | null>((done) => {
  const r = new FileReader();
  r.onload = () => done(typeof r.result === "string" ? r.result : null);
  r.onerror = () => done(null);
  r.readAsDataURL(b);
});

export default function DrawingCanvas({ initial, opening, ref }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  // Checked for shape by readScene; Excalidraw's restore mends what is missing inside it
  const data = useMemo(() => (initial ? restore(initial as Parameters<typeof restore>[0], null, null) : null), [initial]);
  const { seq, noteId, name } = opening;
  // The scene version last saved (or opened): changes since are unsaved
  const savedAt = useRef<number | null>(null);
  const track = (elements: readonly ExcalidrawElement[]) => {
    const v = getSceneVersion(elements);
    savedAt.current ??= v;
    markUnsaved(seq, v !== savedAt.current);
  };
  // What this canvas held goes with it (closed, or failed to draw): nothing of it is left to save or to ask about
  useEffect(() => () => markUnsaved(seq, false), [seq]);

  useImperativeHandle(ref, () => ({
    async snapshot() {
      if (!api) return null;
      const elements = api.getSceneElements(), appState = api.getAppState(), files = api.getFiles();
      if (!elements.length) return null;
      const scene = new Blob([serializeAsJSON(elements, appState, files, "local")], { type: "application/json" });
      return { scene, preview: await picture(api, elements, PREVIEW_EDGE) };
    },
    saved() {
      if (!api) return;
      savedAt.current = getSceneVersion(api.getSceneElementsIncludingDeleted());
      track(api.getSceneElementsIncludingDeleted());
    },
  }), [api]);

  // The assistant's hands on this canvas, for as long as it is up
  useEffect(() => {
    if (!api) return;
    const live: Live = {
      seq, noteId, name,
      shapes() {
        const elements = api.getSceneElements(), chosen = api.getAppState().selectedElementIds;
        // A label selected is its shape selected: the shapes fold their labels in
        const box = new Map(elements.map((e) => [e.id, e.type === "text" && e.containerId ? e.containerId : e.id]));
        return { shapes: shapesOf(elements), selected: [...new Set(Object.keys(chosen).filter((id) => chosen[id]).map((id) => box.get(id) ?? id))] };
      },
      async apply(edit) {
        // Labels are measured as they are built: in Excalidraw's hand, not in whatever stood in while it loaded
        await document.fonts.load(`${FONT_SIZES.m}px Excalifont`).catch(() => []);
        const before = api.getSceneElements().length;
        const r = edited(api.getSceneElementsIncludingDeleted(), edit);
        if ("error" in r) return r;
        api.updateScene({ elements: r.elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        const elements = api.getSceneElements();
        // Drawn on an empty canvas: brought into view, where the owner is looking
        if (!before && elements.length) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true });
        if (!elements.length) return { picture: null };
        const shot = await picture(api, elements, LOOK_EDGE, "image/webp", LOOK_QUALITY).catch(() => null);
        return { picture: shot && await dataUrl(shot) };
      },
    };
    setLive(live);
    return () => { if (liveNow() === live) setLive(null); };
  }, [api, seq, noteId, name]);

  return (
    <Excalidraw excalidrawAPI={setApi} initialData={data} theme="dark" onChange={(elements) => track(elements)}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }} />
  );
}
