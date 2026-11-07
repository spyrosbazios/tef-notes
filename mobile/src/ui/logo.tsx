// The app's mark, drawn in the brand: Home's header wears it where the web shows the wordmark. The picture is the notification
// silhouette (assets/images/notification-icon.png, white on transparent, written by scripts/icons.ts from assets/logo/monochrome.svg)
// tinted, so the mark has one source and no copy of its path lives here.
import { Image } from "expo-image";
import { useTheme } from "./use-theme";

export function Logo({ size = 28 }: { size?: number }) {
  const { C } = useTheme();
  return <Image source={require("../../assets/images/notification-icon.png")} tintColor={C.brand} style={{ width: size, height: size }} accessibilityLabel="TEF Notes" />;
}
