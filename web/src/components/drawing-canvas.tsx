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
import { setLive, liveNow, type Live } from "@/hooks/drawing";
import { edited } from "@/lib/drawing-edit";

/** The long edge the PNG preview is capped at, as photos are (core/photos.ts MAX); the chat's picture of an edit, smaller. */
const PREVIEW_EDGE = 1600, CHAT_EDGE = 720;

export type DrawingHandle = {
  /** The scene as its JSON file and a PNG of it; null while nothing is drawn. */
  snapshot(): Promise<{ scene: Blob; preview: Blob } | null>;
  /** What `snapshot` returned was saved: the drawing has no unsaved changes from here. */
  saved(): void;
};

type Props = {
  initial: string | null;
  /** The opening this canvas is (hooks/drawing.ts `Opened`): the note's id, the file (null while new). */
  opening: { seq: number; noteId: string; name: string | null };
  /** Whether the drawing holds changes not saved yet, each time that flips. */
  onUnsaved: (unsaved: boolean) => void;
  ref: React.Ref<DrawingHandle>;
};

/** A PNG of `elements` at most `edge` px on its long side. */
function picture(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], edge: number) {
  return exportToBlob({
    elements, files: api.getFiles(), mimeType: "image/png", exportPadding: 16,
    appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
    getDimensions: (w: number, h: number) => { const k = Math.min(1, edge / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k), scale: k }; },
  });
}

export default function DrawingCanvas({ initial, opening, onUnsaved, ref }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const data = useMemo(() => (initial ? restore(JSON.parse(initial), null, null) : null), [initial]);
  // The scene version last saved (or opened): changes since are unsaved
  const savedAt = useRef<number | null>(null), unsaved = useRef(false);
  const notify = useRef(onUnsaved);
  useEffect(() => { notify.current = onUnsaved; });
  const track = (elements: readonly ExcalidrawElement[]) => {
    const v = getSceneVersion(elements);
    savedAt.current ??= v;
    const now = v !== savedAt.current;
    if (now !== unsaved.current) { unsaved.current = now; notify.current(now); }
  };

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
  const { seq, noteId, name } = opening;
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
      unsaved: () => unsaved.current,
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
        return { picture: elements.length ? await picture(api, elements, CHAT_EDGE).catch(() => null) : null };
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
