// Settings → Import & export: notes in and out as markdown folders and zips.
import { Check, Download, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TITLE } from "@/components/settings/style";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useNotes } from "@/hooks/notes";
import { downloadZip } from "@/lib/export";
import { importNotes, type ImportTally, type Source } from "@/core/client/import";
import { folderSource, zipSource } from "@/lib/import";
import { localDay } from "@/core/time";
import { message } from "@/services/api";

/** Notes in and out, on one card. Export: every note and the photos and PDFs they link, as one zip (`notes/<file>.md` and
 * `attachments/<note-id>/<name>`). Import: a folder of Markdown, or such a zip, in as notes: picked, checked without writing,
 * then imported. */
export function ImportExport() {
  const { data, isPending } = useNotes();
  const [exporting, setExporting] = useState(false);
  const [src, setSrc] = useState<{ name: string; source: Source; seen: ImportTally } | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = { url: location.origin };
  const download = async () => {
    if (!data) return;
    setExporting(true);
    try { toast(`Downloaded ${await downloadZip(data, `tefnotes-notes-${localDay()}.zip`)} notes`); } catch (e) { toast.error(message(e)); } finally { setExporting(false); }
  };
  const pick = async (name: string, make: () => Promise<Source> | Source) => {
    setBusy(true);
    try {
      const source = await make();
      const seen = await importNotes(here, source, { dry: true, update: false, today: localDay() });
      if (!seen.found) { toast.error(`No markdown files in ${name}`); setSrc(null); } else { setUpdate(false); setSrc({ name, source, seen }); }
    } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const t = await importNotes(here, src.source, { dry: false, update, today: localDay() });
      toast(`${t.made} new, ${t.updated} updated, ${t.same} unchanged, ${t.skipped} skipped; ${t.files} attachments`);
      setSrc(null);
    } catch (e) { toast.error(message(e)); } finally { setBusy(false); }
  };
  const files = (e: { target: HTMLInputElement }) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; return f; };
  const count = src ? (update ? src.seen.found : src.seen.found - src.seen.taken) : 0;
  return (
    <section className="space-y-3" aria-labelledby="transfer-h">
      <h2 id="transfer-h" className={TITLE}>Import & export</h2>
      <div className="divide-y divide-line rounded-xl border border-line">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <Download className="mt-0.5 size-4 shrink-0 self-start text-brand" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-semibold">Export</p>
            <p className="text-[13px] leading-snug text-dim">
              {isPending ? "Counting notes…" : `All ${data?.length ?? 0} notes in one zip.`}
            </p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full" disabled={isPending || exporting || !data?.length} onClick={() => { void download(); }}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} Download zip
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <Upload className="mt-0.5 size-4 shrink-0 self-start text-brand" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-semibold">Import</p>
            <p className="text-[13px] leading-snug text-dim">A folder or zip of markdown files. You see what it finds first.</p>
          </div>
          <div className="flex items-center gap-2">
            {busy && !src && <Loader2 className="size-4 animate-spin text-dim" />}
            <Button asChild variant="outline" size="sm" className="rounded-full" disabled={busy}>
              <label>
                Folder
                <input type="file" className="sr-only" disabled={busy} {...{ webkitdirectory: "" }}
                  onChange={(e) => { const f = files(e); if (f.length) void pick(f[0].webkitRelativePath.split("/")[0] || "the folder", () => folderSource(f)); }} />
              </label>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full" disabled={busy}>
              <label>
                Zip
                <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy}
                  onChange={(e) => { const [f] = files(e); if (f) void pick(f.name, () => zipSource(f)); }} />
              </label>
            </Button>
          </div>
        </div>
        {src && (
          <div className="space-y-3 rounded-b-xl bg-muted/40 px-3 py-3" aria-live="polite">
            <p className="text-sm">
              <span className="font-semibold">{src.name}</span>
              <span className="text-dim"> · {src.seen.found} notes found{src.seen.taken > 0 ? `, ${src.seen.taken} already here` : ""}</span>
            </p>
            {src.seen.taken > 0 && (
              <div className="flex items-center gap-2">
                <Switch id="import-update" checked={update} onCheckedChange={setUpdate} />
                <Label htmlFor="import-update" className="text-[13px] text-dim">Overwrite the {src.seen.taken} already here (otherwise they are skipped)</Label>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="rounded-full" disabled={busy || count === 0} onClick={() => { void run(); }}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} {count === 0 ? "Nothing new to import" : `Import ${count} ${count === 1 ? "note" : "notes"}`}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-full" disabled={busy} onClick={() => setSrc(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
