// The pictures across the top of a note's list tile, inset in rounded corners: up to four of its photos and PDFs (a PDF's
// first page, drawn by the agent) as a mosaic (`mosaicCells`: one fills, two split, three are one tall and two
// stacked, four are quarters, "+N" on the last when there are more), else the picture of its first link (the server's
// copy from its link preview). Nothing when it has none, or when none can be had: offline, a tile just has no picture.
//
// Each blurs in: the server's tiny copy, blurred, at once, then the sharp one cross-fading over it. Both come at the
// server's thumb sizes and are cached by expo-image on disk, so a photo never has to come down whole for its tile; one
// already on the phone is drawn from its own file. A tile mounts only when the list scrolls near it, so this is lazy by
// construction. Until a picture has loaded a soft pulse stands in.
import { Image } from "expo-image";
import { memo, useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { mosaicCells, picturesOf, type TilePicture } from "@/core/notes";
import { pdfThumbUrl, photoThumbUrl, previewPictureUrl, type ThumbSize } from "@/core/pocketbase";
import { serverOf } from "@/store/keys";
import * as db from "@/store/db";
import { resolveAttachment } from "@/store/attachments";
import { useLinkPreview } from "@/store/previews";
import { T } from "./ds/text";
import { useTheme } from "./use-theme";

const HEIGHT = 112, TALL = 150;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/** One picture to draw: where each size is (`blur` absent: the sharp one is a file on the phone, there at once), and
 *  whether it is a page (shown from its top). */
type Source = { key: string; sharp: string; blur?: string; top?: boolean };

/** The wait for a picture: a wash of the line colour breathing over the raised block. Unmounted once a picture is in. */
function Pulse() {
  const { C } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.5 * v.value }));
  return <Animated.View pointerEvents="none" style={[FILL, { backgroundColor: C.line }, style]} />;
}

/** One picture filling its box, blurred in. `onBroken`: the sharp one couldn't be had. */
function BlurImage({ src, onBroken }: { src: Source; onBroken: () => void }) {
  const [shown, setShown] = useState<string>();               // the key of the source that has drawn: a recycled cell waits again
  const position = src.top ? "top" : "center";
  return (
    <>
      {shown === src.key ? null : <Pulse />}
      {src.blur ? (
        <Image source={{ uri: src.blur }} recyclingKey={`${src.key}:blur`} blurRadius={6} contentFit="cover" contentPosition={position}
          cachePolicy="memory-disk" transition={150} style={FILL} onLoad={() => setShown(src.key)} accessibilityIgnoresInvertColors />
      ) : null}
      <Image source={{ uri: src.sharp }} recyclingKey={src.key} contentFit="cover" contentPosition={position} cachePolicy="memory-disk"
        transition={{ duration: 450, effect: "cross-dissolve", timing: "ease-out" }} style={FILL}
        onLoad={() => setShown(src.key)} onError={onBroken} accessibilityIgnoresInvertColors />
    </>
  );
}

/** The mosaic of `sources`; nothing when none can be drawn. `more`: pictures past the ones given. */
function Mosaic({ sources, more = 0 }: { sources: Source[]; more?: number }) {
  const { C } = useTheme();
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const shown = sources.filter((s) => !broken.has(s.key));
  if (!shown.length) return null;
  const cells = mosaicCells(shown.length), extra = more + Math.max(0, shown.length - cells.length);
  return (
    <View className="m-1.5 mb-0 overflow-hidden rounded-xl" style={{ height: cells.length > 2 ? TALL : HEIGHT, backgroundColor: C.raised }}>
      {cells.map((c, i) => (
        <View key={shown[i].key} style={{ position: "absolute", left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`, padding: 1 }}>
          <View style={{ flex: 1, overflow: "hidden", backgroundColor: C.raised }}>
            <BlurImage src={shown[i]} onBroken={() => setBroken((b) => new Set(b).add(shown[i].key))} />
            {i === cells.length - 1 && extra > 0 ? (
              <>
                <View style={[FILL, { backgroundColor: C.bg, opacity: 0.55 }]} />
                <View style={[FILL, { alignItems: "center", justifyContent: "center" }]}><T font="semi" size={18}>+{extra}</T></View>
              </>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** A photo or PDF of a note as a source: a photo on the phone from its file, else either from the server's thumbs. */
function sourceOf(noteId: string, p: TilePicture): Source | null {
  const s = serverOf();
  if ("pdf" in p) {
    return s ? { key: `${noteId}/${p.pdf}`, sharp: pdfThumbUrl(s, noteId, p.pdf, "sharp"), blur: pdfThumbUrl(s, noteId, p.pdf, "blur"), top: true } : null;
  }
  const local = resolveAttachment(noteId, p.image);
  if (local) return { key: local, sharp: local };
  const a = db.getAttachment(noteId, p.image);
  if (!s || !a?.rec || !a.file) return null;
  const at = (z: ThumbSize) => photoThumbUrl(s, { rec: a.rec!, file: a.file! }, z);
  return { key: `${a.rec}/${a.file}`, sharp: at("sharp"), blur: at("blur") };
}

/** A note's photo by name (the card in the Ask chat draws the one its snapshot names). */
export function Photo({ noteId, name }: { noteId: string; name: string }) {
  const src = sourceOf(noteId, { image: name });
  return src ? <Mosaic sources={[src]} /> : null;
}

function Link({ url }: { url: string }) {
  const p = useLinkPreview(url), s = serverOf();
  const sharp = s ? previewPictureUrl(s, p, "sharp") : undefined;
  return s && p && sharp ? <Mosaic sources={[{ key: p.picture, sharp, blur: previewPictureUrl(s, p, "blur") }]} /> : null;
}

/** `updated` isn't read: memo re-renders the tile when it moves, which is when the body, and so its pictures, may have changed. */
export const NoteThumb = memo(function NoteThumb({ id, path }: { id: string; path: string; updated: number }) {
  const body = db.getBody(path), found = body == null ? null : picturesOf(id, body);
  if (!found) return null;
  if ("link" in found) return <Link url={found.link} />;
  return <Mosaic sources={found.pictures.flatMap((p) => sourceOf(id, p) ?? [])} more={found.more} />;
});
