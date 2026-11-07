// Link previews as query state, shared by the editor's cards and the list's thumbnails: a URL is asked of the server once
// an hour however many notes show it.
import { useQuery } from "@tanstack/react-query";
import * as previews from "@/services/previews";

const HOUR = 3_600_000;

export const previewQuery = (url: string) => ({
  queryKey: ["link-preview", url] as const, queryFn: () => previews.get(url), staleTime: HOUR, gcTime: 24 * HOUR,
});

/** The preview of `url`, once `enabled`; undefined while it loads or when it can't be had. */
export const useLinkPreview = (url: string | null, enabled: boolean) =>
  useQuery({ ...previewQuery(url ?? ""), enabled: enabled && !!url, retry: 1 }).data ?? undefined;
