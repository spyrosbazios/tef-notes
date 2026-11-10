// A write nobody awaits: its failure is a toast.
import { haptic } from "@/lib/haptics";
import { toast } from "sonner";
import { message } from "@/services/api";

export const report = (p: Promise<unknown>): void => { p.catch((e) => { haptic("error"); toast.error(message(e)); }); };
