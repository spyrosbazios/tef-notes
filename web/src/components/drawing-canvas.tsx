// Excalidraw itself, in a chunk of its own: drawing-dialog.tsx loads this file only when a drawing is opened, so the
// app's main bundle never carries it (nor does the phone's editor page, which only looks at a drawing's PNG).
import { Excalidraw, exportToBlob, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useImperativeHandle, useMemo, useState } from "react";

/** The long edge the PNG preview is capped at, as photos are (core/photos.ts MAX). */
const PREVIEW_EDGE = 1600;

export type DrawingHandle = {
  /** The scene as its JSON file and a PNG of it; null while nothing is drawn. */
  snapshot(): Promise<{ scene: Blob; preview: Blob } | null>;
};

export default function DrawingCanvas({ initial, ref }: { initial: string | null; ref: React.Ref<DrawingHandle> }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const data = useMemo(() => (initial ? restore(JSON.parse(initial), null, null) : null), [initial]);

  useImperativeHandle(ref, () => ({
    async snapshot() {
      if (!api) return null;
      const elements = api.getSceneElements(), appState = api.getAppState(), files = api.getFiles();
      if (!elements.length) return null;
      const scene = new Blob([serializeAsJSON(elements, appState, files, "local")], { type: "application/json" });
      const preview: Blob = await exportToBlob({
        elements, files, mimeType: "image/png", exportPadding: 16,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: false },
        getDimensions: (w: number, h: number) => { const k = Math.min(1, PREVIEW_EDGE / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k), scale: k }; },
      });
      return { scene, preview };
    },
  }), [api]);

  return <Excalidraw excalidrawAPI={setApi} initialData={data} theme="dark" UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }} />;
}
