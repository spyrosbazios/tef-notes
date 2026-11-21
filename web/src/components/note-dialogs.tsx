// The two questions the note pane asks: which side of an edit made on two devices to keep, and whether to delete the note.
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Both devices changed the same lines, so nothing was written: the owner keeps one side (`clash` null: closed). */
export function ClashDialog({ clash, onResolve }: { clash: { mine: string; theirs: string } | null; onResolve: (keep: "mine" | "theirs") => void }) {
  return (
    <AlertDialog open={!!clash}>
      <AlertDialogContent className="sm:max-w-4xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Edited on another device too</AlertDialogTitle>
          <AlertDialogDescription>Both changed the same lines, so nothing was written. Keep one side; the other is lost.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid max-h-[50vh] grid-cols-2 gap-3 overflow-hidden">
          {(["mine", "theirs"] as const).map((k) => (
            <div key={k} className="flex min-h-0 flex-col gap-1.5">
              <p className="text-xs font-semibold text-dim">{k === "mine" ? "Yours, here" : "Theirs, on the server"}</p>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 font-mono text-xs">{clash?.[k]}</pre>
            </div>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onResolve("theirs")}>Keep theirs</AlertDialogCancel>
          <AlertDialogAction onClick={() => onResolve("mine")}>Keep mine</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteNoteDialog({ open, onOpenChange, title, onDelete }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; onDelete: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>The note and its photos go from every device. There is no undo and no backup.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
