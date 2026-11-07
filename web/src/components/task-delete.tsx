// Deleting a task, asked first: from the open card's Delete button and from a row's right-click menu alike.
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { removeTask } from "@/hooks/todo";
import { message } from "@/services/api";
import type { TaskRec } from "@/services/todo";

/** Open while `task` is set; deletes it at the rev it has (a task changed meanwhile is refused and shows as it now is). */
export function DeleteTask({ task, onClose, onGone }: { task: TaskRec | null; onClose: () => void; onGone?: () => void }) {
  const qc = useQueryClient();
  const remove = async () => {
    if (!task) return;
    try { await removeTask(qc, task); toast(`Deleted “${task.title}”`); onGone?.(); } catch (e) { toast.error(message(e)); }
  };
  return (
    <AlertDialog open={!!task} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{task?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>The task goes from every device. There is no undo and no backup.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
