// The server's release and updating it from the app (core/release.ts). The newest release is checked when the app opens and
// every CHECK_MS (the agent caches GitHub's answer); during an update the version route is polled every POLL_MS until the server
// answers on the new version, then the page loads the new web app. Between the updater stopping the server and the new one
// starting, the route doesn't answer: that is the restart, not a failure.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type UpdatePhase } from "@/core/release";
import { forceUpdate } from "@/lib/update";
import { startUpdate, versionInfo } from "@/services/release";

const CHECK_MS = 6 * 60 * 60_000;
const POLL_MS = 3000;
/** How long an update may take before the app stops waiting for it: pulling three images on a slow line, and the migrations. */
const GIVE_UP_MS = 15 * 60_000;

export const RELEASE_KEY = ["release"] as const;

const WORDS: Record<UpdatePhase, string> = {
  idle: "Starting…", checking: "Checking the release…", pulling: "Downloading…", "backing-up": "Backing up your notes…",
  restarting: "Restarting…", failed: "Failed",
};

export function useRelease() {
  return useQuery({ queryKey: RELEASE_KEY, queryFn: versionInfo, staleTime: CHECK_MS, refetchInterval: CHECK_MS });
}

/** The update in progress: the version it goes to, what it is doing in words, and starting one. */
export function useServerUpdate() {
  const [target, setTarget] = useState<{ version: string; since: number } | null>(null);
  const [error, setError] = useState("");
  const info = useQuery({
    queryKey: [...RELEASE_KEY, "updating"], queryFn: versionInfo, enabled: !!target, refetchInterval: POLL_MS, retry: false, gcTime: 0,
  });
  const data = target ? info.data : undefined;
  useEffect(() => {
    if (!target) return;
    const fail = (why: string) => { setTarget(null); setError(why); };
    if (data?.running === target.version) {
      toast.success(`Updated to ${target.version}`);
      void forceUpdate();
      return;
    }
    const s = data?.updater.state;
    if (s?.phase === "failed" && s.version === target.version) fail(s.error);
    else if (Date.now() - target.since > GIVE_UP_MS) fail(`The server hasn't come back on ${target.version}. See docker compose logs updater.`);
  }, [target, data, info.errorUpdateCount]);

  const start = async (version: string) => {
    setError("");
    try {
      await startUpdate(version);
      setTarget({ version, since: Date.now() });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const phase = data?.updater.state?.phase;
  const doing = !target ? "" : info.isError || !phase ? "Restarting…" : WORDS[phase];
  return { target: target?.version ?? "", doing, error, start };
}
