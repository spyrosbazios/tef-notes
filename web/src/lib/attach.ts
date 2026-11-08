// A file the owner adds to an assistant message, as the AI SDK's file part (core/assistant.ts "Attachments"): a photo
// downscaled to the picture the model looks at, a PDF as it is.
import type { FileUIPart } from "ai";
import { ATTACH_PDF_MAX } from "@/core/assistant";
import { PDF } from "@/core/photos";
import { look } from "@/lib/picture";

const dataUrl = (blob: Blob) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => no(r.error ?? new Error("Could not read the file."));
  r.readAsDataURL(blob);
});

export async function attachment(file: File): Promise<FileUIPart> {
  if (file.type === PDF) {
    if (file.size > ATTACH_PDF_MAX) throw new Error(`${file.name} is over ${ATTACH_PDF_MAX / 1024 / 1024} MB.`);
    return { type: "file", mediaType: PDF, filename: file.name, url: await dataUrl(file) };
  }
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not a photo or a PDF.`);
  return { type: "file", mediaType: "image/jpeg", filename: file.name, url: `data:image/jpeg;base64,${await look(file)}` };
}
