// The photo store (store/attachments.ts) against fakes of the picker, the manipulator, the phone's files, the
// network, the notes server and db.ts: what a pick saves and hands back, what a sync uploads, holds for Wi-Fi or removes,
// and that a photo comes down once however many screens ask for it.
import * as ImagePicker from "expo-image-picker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentLink, drawingName, drawingPreview, fileMarkdown, fit, isDrawing, isPdf, mimeOf, pdfName, photoName } from "@/core/photos";
import * as pb from "@/core/pocketbase";
import {
  ensureAttachment, missingAttachments, moveAttachments, pickAndAttach, resolveAttachment, syncAttachments, useAttachmentSync,
} from "@/store/attachments";
import type { AttachmentRow, NoteRow } from "@/store/db";
import { useKeys } from "@/store/keys";
import { usePrefs } from "@/store/prefs";
import { fake } from "./helpers";

const files = vi.hoisted(() => new Map<string, string>());                     // the phone's disk: uri → base64
const log = vi.hoisted(() => ({ resized: [] as [string, object][], saved: [] as [string, object][] }));
const net = vi.hoisted(() => ({ type: "WIFI" }));
/** The native transfers: File.upload's reply, File.downloadFileAsync's bytes (base64). */
const io = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), pick: vi.fn() }));

vi.mock("@/store/db", async () => (await import("./helpers")).fake);
vi.mock("@/store/storage", () => ({ zustandPrefs: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, prefsFile: { getString: () => undefined, set: () => {} } }));
vi.mock("expo-secure-store", () => ({ getItem: () => null, setItem: () => {}, deleteItemAsync: async () => {} }));
vi.mock("expo-network", () => ({ NetworkStateType: { WIFI: "WIFI", CELLULAR: "CELLULAR" }, getNetworkStateAsync: async () => ({ type: net.type, isConnected: true }) }));
vi.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: vi.fn(), launchCameraAsync: vi.fn(), launchImageLibraryAsync: vi.fn() }));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
  ImageManipulator: {
    manipulate: (src: string) => {
      const ctx = {
        resize: (size: object) => { log.resized.push([src, size]); return ctx; },
        renderAsync: async () => ({
          saveAsync: async (o: object) => {
            const uri = `file:///cache/${log.saved.length}.jpg`;
            log.saved.push([src, o]);
            files.set(uri, btoa(`jpeg of ${src}`));
            return { uri, width: 0, height: 0 };
          },
          release: () => {},
        }),
        release: () => {},
      };
      return ctx;
    },
  },
}));
vi.mock("expo-file-system", () => {
  type Part = string | { uri: string };
  const join = (parts: Part[]) => parts.map((p) => (typeof p === "string" ? p : p.uri)).join("/");
  class Directory {
    uri: string;
    constructor(...p: Part[]) { this.uri = join(p); }
    create() {}
  }
  class File {
    uri: string;
    constructor(...p: Part[]) { this.uri = join(p); }
    get exists() { return files.has(this.uri); }
    get size() { return atob(files.get(this.uri) ?? "").length; }
    write(content: string, o?: { encoding?: string }) { files.set(this.uri, o?.encoding === "base64" ? content : btoa(content)); }
    async base64() { const b = files.get(this.uri); if (b == null) throw new Error("no such file"); return b; }
    async move(to: File) { this.moveSync(to); }
    async copy(to: File) { files.set(to.uri, files.get(this.uri)!); }
    moveSync(to: File) { files.set(to.uri, files.get(this.uri)!); files.delete(this.uri); this.uri = to.uri; }
    delete() { files.delete(this.uri); }
    upload(url: string, o: object) { return io.upload(this.uri, url, o); }
    static pickFileAsync(o: object) { return io.pick(o); }
    static async downloadFileAsync(url: string, to: File, o?: object) { files.set(to.uri, await io.download(url, o)); return to; }
  }
  return { File, Directory, Paths: { document: new Directory("file:///docs") }, UploadType: { MULTIPART: 1 } };
});
vi.mock("@/core/pocketbase", async (orig) => ({ ...(await orig<typeof import("@/core/pocketbase")>()), photos: vi.fn() }));

const S = { url: "https://n" };
const at = (noteId: string, name: string) => `file:///docs/attachments/${noteId}/${name}`;
const note = (id: string): NoteRow => ({
  path: `notes/${id}.md`, id, text: "", title: id, created: "2026-10-05", pinned: false, color: null, tags: [], kind: "note", snippet: "",
  updated: 1, pushed: 1, rec: "n1", rev: 1, base: "", conflict_text: null, conflict_rev: null, lost: null, deleted: false,
});
/** A photo with a copy on the phone; by default added here and not uploaded yet. */
const photo = (noteId: string, name: string, p: Partial<AttachmentRow> = {}) => {
  files.set(at(noteId, name), btoa("bytes"));
  fake.putAttachment({ note_id: noteId, name, rec: null, file: null, local: at(noteId, name), size: 5, pushed: null, ...p });
  return at(noteId, name);
};
/** What the server answers an upload with. */
const created = (note: string, name: string, rec: string) => ({ status: 200, body: JSON.stringify({ id: rec, note, name, file: `${rec}_${name}` }) });

beforeEach(() => {
  vi.resetAllMocks();
  fake.reset();
  files.clear();
  log.resized.length = log.saved.length = 0;
  net.type = "WIFI";
  useKeys.setState({ keys: { server: S.url } });
  usePrefs.setState({ photosWifiOnly: false });
  vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as never);
});
afterEach(() => { vi.useRealTimers(); });

describe("moveAttachments", () => {
  it("takes a moved note's photos added here along — file, row and all — so prune doesn't take them for a deleted note's", () => {
    const was = photo("20261001-a", "p.jpg");
    photo("20261001-a", "up.jpg", { rec: "u1", file: "u1_up.jpg", pushed: 1 });   // the laptop's note's, or already up: stays
    expect(moveAttachments("20261001-a", "20261001-a-2")).toEqual(["p.jpg"]);
    expect(files.has(was)).toBe(false);
    expect(files.get(at("20261001-a-2", "p.jpg"))).toBe(btoa("bytes"));
    expect(fake.getAttachment("20261001-a-2", "p.jpg")).toMatchObject({ local: at("20261001-a-2", "p.jpg"), rec: null, pushed: null });
    expect(fake.getAttachment("20261001-a", "p.jpg")).toBeNull();
    expect(fake.getAttachment("20261001-a", "up.jpg")).toMatchObject({ rec: "u1" });
    expect(resolveAttachment("20261001-a-2", "p.jpg")).toBe(at("20261001-a-2", "p.jpg"));
    expect(resolveAttachment("20261001-a", "p.jpg")).toBeUndefined();
  });
});
describe("attaching", () => {
  it("downscales each picked photo, saves it under the note, queues it and hands back its image lines", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 5, 14, 30, 5), toFake: ["Date"] });
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [
      { uri: "content://a", width: 4032, height: 3024 }, { uri: "content://b", width: 3024, height: 4032 }, { uri: "content://c", width: 1200, height: 900 },
    ] } as never);
    const r = await pickAndAttach("n1");
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["images"], allowsMultipleSelection: true }));
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(log.resized).toEqual([["content://a", { width: 1600 }], ["content://b", { height: 1600 }]]);    // c is within already
    expect(log.saved.map(([, o]) => o)).toEqual(Array(3).fill({ format: "jpeg", compress: 0.82 }));
    const names = ["20261005-143005.jpg", "20261005-143005-2.jpg", "20261005-143005-3.jpg"];
    expect(r).toEqual({ markdown: names.map((n) => `![](../attachments/n1/${n})`).join("\n") });
    names.forEach((n, i) => {
      expect(fake.getAttachment("n1", n)).toEqual({ note_id: "n1", name: n, rec: null, file: null, local: at("n1", n), size: `jpeg of content://${"abc"[i]}`.length, pushed: null });
      expect(resolveAttachment("n1", n)).toBe(at("n1", n));
    });
    expect([...files.keys()].filter((u) => u.startsWith("file:///cache/"))).toEqual([]);              // moved, not copied
    expect(useAttachmentSync.getState().pending).toBe(3);
  });

  it("returns null when the picker is cancelled, and saves nothing", async () => {
    vi.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAndAttach("n2", "camera")).toBeNull();
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.not.objectContaining({ allowsMultipleSelection: true }));
    expect(log.saved).toEqual([]);
    expect(fake.allAttachments()).toEqual([]);
  });

  it("copies a picked PDF as it is under a slug of its name, queues it and hands back a link to it", async () => {
    files.set("content://doc/1", btoa("%PDF-1.7 bytes"));
    io.pick.mockResolvedValue({ canceled: false, result: { uri: "content://doc/1", name: "Εφορία [2026] final.pdf" } });
    const r = await pickAndAttach("n1", "document");
    expect(io.pick).toHaveBeenCalledWith({ mimeTypes: "application/pdf" });
    expect(r).toEqual({ markdown: "[Εφορία \\[2026\\] final.pdf](../attachments/n1/eforia-2026-final.pdf)" });
    expect(files.get(at("n1", "eforia-2026-final.pdf"))).toBe(btoa("%PDF-1.7 bytes"));                // not re-encoded
    expect(files.has("content://doc/1")).toBe(true);                                                  // the picker's file is left alone
    expect(log.saved).toEqual([]);
    expect(fake.getAttachment("n1", "eforia-2026-final.pdf")).toMatchObject({ rec: null, local: at("n1", "eforia-2026-final.pdf"), pushed: null });
    expect(resolveAttachment("n1", "eforia-2026-final.pdf")).toBe(at("n1", "eforia-2026-final.pdf"));
    expect(useAttachmentSync.getState().pending).toBe(1);
    expect(await pickAndAttach("n1", "document")).toMatchObject({ markdown: expect.stringContaining("eforia-2026-final-2.pdf") });   // a second, same name
  });

  it("returns null for a cancelled PDF pick, and refuses one over what the server takes, leaving nothing behind", async () => {
    io.pick.mockResolvedValue({ canceled: true, result: null });
    expect(await pickAndAttach("n2", "document")).toBeNull();
    files.set("content://doc/big", btoa("x".repeat(26 * 1024 * 1024)));
    io.pick.mockResolvedValue({ canceled: false, result: { uri: "content://doc/big", name: "big.pdf" } });
    await expect(pickAndAttach("n2", "document")).rejects.toThrow(/over 25 MB/);
    expect(fake.allAttachments()).toEqual([]);
    expect(files.has(at("n2", "big.pdf"))).toBe(false);
  });

  it("says so when the camera isn't allowed, without opening it", async () => {
    vi.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false } as never);
    await expect(pickAndAttach("n2", "camera")).rejects.toThrow(/camera/);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it("pdfName, fileMarkdown, attachmentLink: a safe stored name, a link, and any form of the link read back", () => {
    expect(pdfName("My Report (v2).PDF", new Set())).toBe("my-report-v2.pdf");
    expect(pdfName("Κωδικοί γκαράζ.pdf", new Set(["kodikoi-gkaraz.pdf"]))).toBe("kodikoi-gkaraz-2.pdf");
    expect(pdfName("???.pdf", new Set())).toBe("document.pdf");
    expect(fileMarkdown("n1", "a.pdf", "A [draft].pdf")).toBe("[A \\[draft\\].pdf](../attachments/n1/a.pdf)");
    expect(attachmentLink("../attachments/n1/a.pdf")).toEqual({ noteId: "n1", name: "a.pdf" });
    expect(attachmentLink("file:///data/docs/attachments/n1/a%20b.pdf")).toEqual({ noteId: "n1", name: "a b.pdf" });
    expect(attachmentLink("https://example.com/a.pdf")).toBeNull();
    expect([isPdf("a.PDF"), isPdf("a.jpg"), mimeOf("a.pdf"), mimeOf("a.jpg")]).toEqual([true, false, "application/pdf", "image/jpeg"]);
  });

  it("fit and photoName: long edge to 1600, local time to the second, -2 and on when taken", () => {
    expect([fit(4032, 3024), fit(3024, 4032), fit(1600, 900), fit(0, 0)]).toEqual([{ width: 1600 }, { height: 1600 }, null, null]);
    const t = new Date(2026, 9, 5, 9, 4, 7).getTime();
    expect(photoName(t, new Set())).toBe("20261005-090407.jpg");
    expect(photoName(t, new Set(["20261005-090407.jpg", "20261005-090407-2.jpg"]))).toBe("20261005-090407-3.jpg");
  });
});

describe("syncAttachments", () => {
  it("streams a photo added here up from disk and marks it sent", async () => {
    fake.putNote(note("n3"));
    photo("n3", "a.jpg");
    io.upload.mockResolvedValue(created("n3", "a.jpg", "p1"));
    await syncAttachments();
    expect(io.upload).toHaveBeenCalledWith(at("n3", "a.jpg"), "https://n/api/collections/attachments/records", {
      uploadType: 1, fieldName: "file", mimeType: "image/jpeg", parameters: { note: "n3", name: "a.jpg" },
    });
    expect(fake.getAttachment("n3", "a.jpg")).toMatchObject({ rec: "p1", file: "p1_a.jpg", pushed: expect.any(Number), local: at("n3", "a.jpg") });
    expect(useAttachmentSync.getState()).toEqual({ pending: 0, waitingWifi: 0, err: undefined });
    await syncAttachments();
    expect(io.upload).toHaveBeenCalledTimes(1);                                                        // sent is sent
  });

  it("uploads a PDF as application/pdf", async () => {
    fake.putNote(note("n3"));
    photo("n3", "a.pdf");
    io.upload.mockResolvedValue(created("n3", "a.pdf", "p1"));
    await syncAttachments();
    expect(io.upload).toHaveBeenCalledWith(at("n3", "a.pdf"), expect.any(String), expect.objectContaining({ mimeType: "application/pdf" }));
  });

  it("takes the server's photo by that name for its own earlier upload, landed before the row was marked", async () => {
    fake.putNote(note("n3"));
    photo("n3", "a.jpg");
    io.upload.mockResolvedValue({ status: 400, body: JSON.stringify({ data: { name: { code: "validation_not_unique" } } }) });
    vi.mocked(pb.photos).mockResolvedValue([{ rec: "p1", note: "n3", name: "a.jpg", file: "p1_a.jpg" }]);
    await syncAttachments();
    expect(useAttachmentSync.getState().err).toBeUndefined();
    expect(pb.photos).toHaveBeenCalledWith(S, "n3");
    expect(io.upload).toHaveBeenCalledTimes(1);
    expect(fake.getAttachment("n3", "a.jpg")).toMatchObject({ rec: "p1", file: "p1_a.jpg" });
  });

  it("holds photos for Wi-Fi on mobile data when the pref says so, and counts them", async () => {
    fake.putNote(note("n4"));
    photo("n4", "a.jpg"); photo("n4", "b.jpg");
    usePrefs.setState({ photosWifiOnly: true });
    net.type = "CELLULAR";
    await syncAttachments();
    expect(io.upload).not.toHaveBeenCalled();
    expect(fake.getAttachment("n4", "a.jpg")).toMatchObject({ rec: null, pushed: null });
    expect(useAttachmentSync.getState()).toMatchObject({ pending: 2, waitingWifi: 2 });

    net.type = "WIFI";
    io.upload.mockImplementation(async (uri: string) => created("n4", uri.endsWith("a.jpg") ? "a.jpg" : "b.jpg", uri.endsWith("a.jpg") ? "pa" : "pb"));
    await syncAttachments();
    expect(io.upload).toHaveBeenCalledTimes(2);
    expect(useAttachmentSync.getState()).toMatchObject({ pending: 0, waitingWifi: 0 });
  });

  it("reports a failed upload and keeps the photo queued; the others still go", async () => {
    fake.putNote(note("n4"));
    photo("n4", "a.jpg"); photo("n4", "b.jpg");
    io.upload.mockResolvedValueOnce({ status: 500, body: "" }).mockResolvedValueOnce(created("n4", "b.jpg", "p"));
    await syncAttachments();
    expect(fake.getAttachment("n4", "b.jpg")).toMatchObject({ rec: "p" });
    expect(useAttachmentSync.getState()).toEqual({ pending: 1, waitingWifi: 0, err: "a.jpg: HTTP 500" });
  });

  it("drops the photos of notes no longer on the phone, uploaded or not, without asking the server", async () => {
    const a = photo("gone", "a.jpg", { rec: "p1", file: "p1_a.jpg", pushed: 1 });
    const b = photo("gone", "b.jpg");                                                                // never uploaded: never will be
    fake.putNote(note("kept"));
    photo("kept", "c.jpg", { rec: "p3", file: "p3_c.jpg", pushed: 1 });
    await syncAttachments();
    expect(io.upload).not.toHaveBeenCalled();
    expect(pb.photos).not.toHaveBeenCalled();                                                         // the server drops them with the note
    expect(fake.getAttachments("gone")).toEqual([]);
    expect(files.has(a) || files.has(b)).toBe(false);
    expect(resolveAttachment("gone", "a.jpg")).toBeUndefined();
    expect(fake.getAttachment("kept", "c.jpg")).toMatchObject({ rec: "p3" });
  });
});

describe("downloads", () => {
  it("fetches a photo from the server once, however many ask at once", async () => {
    fake.putAttachment({ note_id: "n5", name: "a.jpg", rec: "s1", file: "s1_a.jpg", local: null, size: null, pushed: 1 });
    fake.putAttachment({ note_id: "n5", name: "mine.jpg", rec: null, file: null, local: null, size: 4, pushed: null });
    expect(await ensureAttachment("n5", "mine.jpg")).toBeUndefined();                                // not on the server: nothing to ask for
    expect(missingAttachments("n5", "![](../attachments/n5/a.jpg)\n![x](../attachments/n5/a.jpg) ![](../attachments/other/b.jpg)")).toEqual(["a.jpg"]);

    let land!: (b64: string) => void;
    io.download.mockReturnValue(new Promise<string>((ok) => { land = ok; }));
    const one = ensureAttachment("n5", "a.jpg"), two = ensureAttachment("n5", "a.jpg");
    expect(resolveAttachment("n5", "a.jpg")).toBeUndefined();
    await vi.waitFor(() => expect(io.download).toHaveBeenCalled());
    land(btoa("jpeg"));
    expect(await Promise.all([one, two])).toEqual([at("n5", "a.jpg"), at("n5", "a.jpg")]);
    expect(io.download).toHaveBeenCalledTimes(1);
    expect(io.download).toHaveBeenCalledWith("https://n/api/files/attachments/s1/s1_a.jpg", { idempotent: true });
    expect(files.get(at("n5", "a.jpg"))).toBe(btoa("jpeg"));
    expect(fake.getAttachment("n5", "a.jpg")).toMatchObject({ local: at("n5", "a.jpg"), size: 4 });
    expect(resolveAttachment("n5", "a.jpg")).toBe(at("n5", "a.jpg"));
    expect(missingAttachments("n5", "![](../attachments/n5/a.jpg)")).toEqual([]);
    expect(await ensureAttachment("n5", "a.jpg")).toBe(at("n5", "a.jpg"));
    expect(io.download).toHaveBeenCalledTimes(1);
  });

  it("drawingName, drawingPreview: a safe stored name whose PNG preview is free too, and its type", () => {
    expect(drawingName("Drawing", new Set())).toBe("drawing.excalidraw");
    expect(drawingName("Drawing", new Set(["drawing.excalidraw"]))).toBe("drawing-2.excalidraw");
    expect(drawingName("Drawing", new Set(["drawing.png"]))).toBe("drawing-2.excalidraw");
    expect(drawingPreview("a-2.excalidraw")).toBe("a-2.png");
    expect(isDrawing("a.excalidraw")).toBe(true);
    expect(isDrawing("a.png")).toBe(false);
    expect(mimeOf("a.excalidraw")).toBe("application/json");
    expect(attachmentLink("../attachments/n1/a.excalidraw")).toEqual({ noteId: "n1", name: "a.excalidraw" });
  });
});
