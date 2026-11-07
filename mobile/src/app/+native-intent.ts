// Android's Share sheet opens the app through `tefnotes://dataUrl=<key>`, which is no screen: the router is sent
// to /share, where the intent (read by src/app/_layout.tsx) is dealt with. Every other link routes as it is.
import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return path.includes(`dataUrl=${getShareExtensionKey()}`) ? "/share" : path;
  } catch {
    return "/home";
  }
}
