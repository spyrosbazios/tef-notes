// A note's PDF, read in the app: the file's bytes (downloaded first when this phone has no copy) handed to the viewer
// page in a WebView (web/pdf-host: pdf.js, built into pdf-html.ts, messages in core/pdf-bridge.ts). In-app rather
// than the system's viewer because Android can't open a file from the app's private storage without a FileProvider
// the Expo setup here doesn't have, and a native PDF library would add a native module (and a dev build) for what
// the WebView already in the app does.
import { Buffer } from "buffer";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { FromPdf, ToPdf } from "@/core/pdf-bridge";
import { ensureAttachment } from "@/store/attachments";
import { ScreenHeader, T } from "./ds";
import { goBack } from "./note";
import { PDF_HTML } from "./pdf-html";
import { pageTheme } from "@/core/theme";
import { useTheme } from "./use-theme";

/** A multiple of 3, so every chunk's base64 stands alone: 384 KB of file, 512 KB of message. */
const STEP = 3 * 128 * 1024;

/** The file as base64 chunks, read from disk a piece at a time: never the whole of a 25 MB file in memory twice. */
function* chunks(uri: string): Generator<ToPdf> {
  const file = new File(uri), total = file.size, handle = file.open();
  try {
    let read = 0;
    while (read < total) {
      const bytes = handle.readBytes(Math.min(STEP, total - read));
      read += bytes.length;
      yield { type: "chunk", data: Buffer.from(bytes).toString("base64"), last: read >= total };
    }
  } finally { handle.close(); }
}

export function PdfScreen({ noteId, name }: { noteId: string; name: string }) {
  const theme = useTheme();
  const web = useRef<WebView>(null);
  const pageUp = useRef(false);
  const [uri, setUri] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ensureAttachment(noteId, name).then(
      (u) => { if (!live) return; if (u) setUri(u); else { setState("failed"); setErr("It isn't on this phone yet, and there is no copy on the server to fetch."); } },
      (e) => { if (live) { setState("failed"); setErr(`Couldn't download it: ${e instanceof Error ? e.message : String(e)}`); } },
    );
    return () => { live = false; };
  }, [noteId, name]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = JSON.parse(e.nativeEvent.data) as FromPdf;
    if (m.type === "ready") {
      if (!uri) return;
      pageUp.current = true;
      web.current?.postMessage(JSON.stringify({ type: "theme", theme: pageTheme(theme) } satisfies ToPdf));
      try { for (const c of chunks(uri)) web.current?.postMessage(JSON.stringify(c)); } catch (x) {
        setState("failed"); setErr(`Couldn't read it: ${x instanceof Error ? x.message : String(x)}`);
      }
    } else if (m.type === "shown") setState("shown");
    else { setState("failed"); setErr(`Couldn't open it: ${m.message}`); }
  };

  // The owner switched theme with the file open
  useEffect(() => {
    if (pageUp.current) web.current?.postMessage(JSON.stringify({ type: "theme", theme: pageTheme(theme) } satisfies ToPdf));
  }, [theme]);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={name} back={() => goBack()} compact />
      {err ? <T tone="warn" size={14} className="px-5 py-3">{err}</T> : state === "loading" ? (
        <View className="items-center py-6"><ActivityIndicator color={theme.C.brand} accessibilityLabel="Opening" /></View>
      ) : null}
      {uri && state !== "failed" ? (
        <WebView ref={web} source={{ html: PDF_HTML, baseUrl: "file:///" }} onMessage={onMessage}
          onRenderProcessGone={() => { setState("failed"); setErr("The viewer stopped. Go back and open it again."); }}
          originWhitelist={["*"]} textZoom={100} overScrollMode="never" setBuiltInZoomControls setDisplayZoomControls={false}
          style={{ flex: 1, backgroundColor: theme.C.bg }} containerStyle={{ backgroundColor: theme.C.bg }} />
      ) : null}
    </View>
  );
}
