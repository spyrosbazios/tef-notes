// A new server release, announced once per release in this browser: a toast that opens Settings → Maintenance, where the
// release's notes and the Update button are (settings/server-update.tsx). The check is hooks/release.ts's.
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { updateOffered } from "@/core/release";
import { persisted } from "@/hooks/store";
import { useRelease } from "@/hooks/release";
import { STORAGE } from "@/lib/storage-keys";

const seen = persisted<{ version: string }>(STORAGE.releaseSeen, (p) => ({ version: typeof p.version === "string" ? p.version : "" }));

export function ReleaseToast() {
  const { data: info } = useRelease();
  const navigate = useNavigate();
  useEffect(() => {
    if (!info || !updateOffered(info) || !info.latest || seen.read().version === info.latest.version) return;
    const version = info.latest.version;
    seen.replace({ version });
    toast(`TEF Notes ${version} is out`, {
      id: "release",
      duration: 15_000,
      action: { label: "See", onClick: () => void navigate({ to: "/settings", search: { section: "maintenance" } }) },
    });
  }, [info, navigate]);
  return null;
}
