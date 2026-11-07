// A note's pictures, full screen: swipe between them, pinch to zoom, double-tap to zoom in and out, drag a zoomed one
// around. The pictures are the note's photos and its drawings' PNG previews, as the editor page or the preview lists
// them (`../attachments/<note-id>/<name>`, or the file:// copy a preview shows; opened by `openPhotos` in note.tsx); each is fetched when this phone has none.
// Zoom is gesture-handler and Reanimated, both in the app already: no viewer library, so no native module to add.
import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View, type ViewToken } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { clamp, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { attachmentLink } from "@/core/photos";
import { ensureAttachment } from "@/store/attachments";
import { ScreenHeader, T } from "./ds";
import { goBack } from "./note";
import { useTheme } from "./use-theme";

const MAX_ZOOM = 5, DOUBLE_TAP_ZOOM = 2.5;

/** A picture's URI on this phone: an attachment is fetched first when it isn't here yet, an address elsewhere is its own.
 *  undefined while it comes; null when there is nothing to show. */
function useUri(src: string): string | null | undefined {
  const a = attachmentLink(src);
  const [fetched, setFetched] = useState<{ src: string; uri: string | null }>();
  const noteId = a?.noteId, name = a?.name;
  useEffect(() => {
    if (!noteId || !name) return;
    let live = true;
    ensureAttachment(noteId, name).then((u) => { if (live) setFetched({ src, uri: u ?? null }); }, () => { if (live) setFetched({ src, uri: null }); });
    return () => { live = false; };
  }, [src, noteId, name]);
  if (!a) return src;
  return fetched?.src === src ? fetched.uri : undefined;
}

/** One picture, as wide and tall as the screen's body, with its zoom. `onZoom`: whether it is zoomed in, so the pager stands still while it is dragged. */
function Zoomable({ src, width, height, onZoom }: { src: string; width: number; height: number; onZoom: (zoomed: boolean) => void }) {
  const { C } = useTheme();
  const uri = useUri(src);
  const scale = useSharedValue(1), base = useSharedValue(1);
  const x = useSharedValue(0), y = useSharedValue(0), fromX = useSharedValue(0), fromY = useSharedValue(0);

  /** The picture can't be dragged further than its own edge. */
  const keep = (s: number) => {
    "worklet";
    const mx = (width * (s - 1)) / 2, my = (height * (s - 1)) / 2;
    x.set(clamp(x.get(), -mx, mx));
    y.set(clamp(y.get(), -my, my));
  };
  const reset = () => {
    "worklet";
    scale.set(withTiming(1)); base.set(1);
    x.set(withTiming(0)); y.set(withTiming(0));
  };

  useAnimatedReaction(() => scale.get() > 1.01, (zoomed, was) => { if (zoomed !== was) scheduleOnRN(onZoom, zoomed); });
  useEffect(() => () => onZoom(false), [onZoom]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => { scale.set(clamp(base.get() * e.scale, 1, MAX_ZOOM)); keep(scale.get()); })
    .onEnd(() => { if (scale.get() < 1.05) reset(); else base.set(scale.get()); });
  // Active only while zoomed in: at 1 the touch is the pager's
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => { if (scale.get() > 1.01) state.activate(); else state.fail(); })
    .onStart(() => { fromX.set(x.get()); fromY.set(y.get()); })
    .onUpdate((e) => { x.set(fromX.get() + e.translationX); y.set(fromY.get() + e.translationY); keep(scale.get()); });
  const twice = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    if (scale.get() > 1.01) reset(); else { scale.set(withTiming(DOUBLE_TAP_ZOOM)); base.set(DOUBLE_TAP_ZOOM); }
  });
  const gesture = Gesture.Race(twice, Gesture.Simultaneous(pinch, pan));
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
      {uri === undefined ? <ActivityIndicator color={C.brand} accessibilityLabel="Loading" /> : uri === null ? (
        <T tone="dim" size={14} className="px-8 text-center">This picture isn&apos;t on this phone yet, and there is no copy on the server to fetch.</T>
      ) : (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{ width, height }, style]}>
            <Image source={{ uri }} contentFit="contain" style={{ width, height }} accessibilityLabel="Picture" />
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

export function PhotosScreen({ srcs, index }: { srcs: string[]; index: number }) {
  const { C } = useTheme();
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(Math.min(Math.max(index, 0), Math.max(srcs.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const [body, setBody] = useState(0);                        // the room under the header
  // FlatList wants the same function for its whole life: a new one throws.
  const seen = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => { const i = viewableItems[0]?.index; if (i != null) setAt(i); }, []);
  const page = body || height;
  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={srcs.length > 1 ? `${at + 1} / ${srcs.length}` : "Picture"} back={() => goBack()} compact />
      <View className="flex-1" onLayout={(e) => setBody(e.nativeEvent.layout.height)}>
        {srcs.length ? (
          <FlatList horizontal pagingEnabled data={srcs} keyExtractor={(s, i) => `${i}:${s}`} scrollEnabled={!zoomed} showsHorizontalScrollIndicator={false}
            initialScrollIndex={at} getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
            onViewableItemsChanged={seen} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            renderItem={({ item }) => <Zoomable src={item} width={width} height={page} onZoom={setZoomed} />}
            style={{ backgroundColor: C.bg }} />
        ) : <T tone="dim" size={14} className="px-5 py-3">Nothing to show.</T>}
      </View>
    </View>
  );
}
