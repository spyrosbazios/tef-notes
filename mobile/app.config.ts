// The app's config. Colours come from packages/core/src/theme.ts, the one palette; native behaviour is config plugins here, never edits in android/.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExpoConfig } from "expo/config";
import { C } from "../packages/core/src/theme.ts";
import { widgetConfig } from "./src/widget/config.ts";

/** The repo's one version, from ../scripts/version.sh (TEF_NOTES_VERSION, else the latest git tag, else 0.0.0). */
const VERSION = execFileSync("sh", [fileURLToPath(new URL("../scripts/version.sh", import.meta.url))], { encoding: "utf8" }).trim();
const [major = 0, minor = 0, patch = 0] = VERSION.split(/[-+]/)[0].split(".").map(Number);

const config: ExpoConfig = {
  name: "TEF Notes",
  slug: "tefnotes",
  version: VERSION,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "tefnotes",
  userInterfaceStyle: "dark",
  ios: { bundleIdentifier: "app.tefnotes.mobile" },
  android: {
    package: "app.tefnotes.mobile",
    // 0.1.0 -> 100, 1.2.3 -> 10203 (at least 1: an untagged build is 0.0.0). Android installs an update only for a higher code.
    versionCode: Math.max(1, major * 10000 + minor * 100 + patch),
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: C.bg,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    permissions: ["android.permission.RECORD_AUDIO"],
  },
  plugins: [
    "expo-router",
    // imageWidth is Android's whole 288 dp splash canvas: the mark sits in its central 66%, as in the launcher foreground
    ["expo-splash-screen", { backgroundColor: C.bg, image: "./assets/images/splash-icon.png", imageWidth: 288 }],
    "expo-secure-store",
    ["expo-build-properties", { android: { buildArchs: ["arm64-v8a"] } }],
    [
      "expo-font",
      {
        fonts: [
          "./assets/fonts/AtkinsonHyperlegibleNext_400Regular.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_500Medium.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_600SemiBold.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_700Bold.ttf",
          "./assets/fonts/AtkinsonHyperlegibleNext_800ExtraBold.ttf",
          "./assets/fonts/AtkinsonHyperlegibleMono_400Regular.ttf",
        ],
      },
    ],
    ["expo-notifications", { icon: "./assets/images/notification-icon.png", color: C.brand }],
    [
      "expo-share-intent",
      {
        androidIntentFilters: ["text/*", "image/*", "application/pdf"],
        androidMultiIntentFilters: ["image/*", "application/pdf"],
        disableIOS: true,
      },
    ],
    "./plugins/background-reply",
    "./plugins/live-update",
    "./plugins/task-alarms",
    "./plugins/release-signing",
    ["react-native-android-widget", widgetConfig],
    "expo-sqlite",
    "expo-image",
    ["expo-image-picker", { photosPermission: "Attach a photo to a note.", cameraPermission: "Attach a photo to a note." }],
  ],
  experiments: { reactCompiler: true },
  backgroundColor: C.bg,
};

export default config;
