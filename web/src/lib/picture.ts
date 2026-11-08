// A picture's bytes as the server takes them: what is stored (long edge 1600, JPEG 0.82: what the phone uploads) and what
// JEV looks at when it suggests where a clip goes (core/photos.ts `lookSize`, base64 JPEG).
import { fit, LOOK_QUALITY, lookSize, MAX, QUALITY } from "@/core/photos";

async function jpeg(file: Blob, size: (w: number, h: number) => { width: number; height: number }, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const { width, height } = size(bmp.width, bmp.height), canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally { bmp.close(); }
}

/** The picture as a note stores it. */
export const downscale = (file: Blob): Promise<Blob> =>
  jpeg(file, (w, h) => { const k = fit(w, h) ? MAX / Math.max(w, h) : 1; return { width: Math.round(w * k), height: Math.round(h * k) }; }, QUALITY);

/** The picture as JEV looks at it, base64 without the data-URL prefix. */
export async function look(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await (await jpeg(file, lookSize, LOOK_QUALITY)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
