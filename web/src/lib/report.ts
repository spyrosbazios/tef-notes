// A write nobody awaits: its failure is a toast.
import { toast } from "sonner";
import { message } from "@/services/api";

export const report = (p: Promise<unknown>): void => { p.catch((e) => toast.error(message(e))); };
