// What a page says about itself, from the server's link-preview route (server/pb_hooks/link-preview.pb.js): the server
// reads the page, since a browser can't (CORS), and caches it.
import { AxiosError } from "axios";
import { hasPreview, type LinkPreview } from "@/core/pocketbase";
import { api } from "./api";

/** The preview of a URL; null when there is nothing to show or the server won't fetch it (400). Failing to ask throws. */
export async function get(url: string): Promise<LinkPreview | null> {
  try {
    const { data } = await api.get<LinkPreview>("tefnotes/link-preview", { params: { url } });
    return hasPreview(data) ? data : null;
  } catch (e) {
    if (e instanceof AxiosError && e.response?.status === 400) return null;
    throw e;
  }
}
