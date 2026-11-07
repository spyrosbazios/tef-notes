// A note's pictures full screen, opened by tapping a photo or a drawing in a note (ui/photos.tsx openPhotos).
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { PhotosScreen } from "@/ui/photos";

export default function Photos() {
  const { srcs, index } = useLocalSearchParams<{ srcs: string; index: string }>();
  const list = useMemo<string[]>(() => { try { const v: unknown = JSON.parse(srcs); return Array.isArray(v) ? v.filter((s) => typeof s === "string") : []; } catch { return []; } }, [srcs]);
  return <PhotosScreen srcs={list} index={Number(index) || 0} />;
}
