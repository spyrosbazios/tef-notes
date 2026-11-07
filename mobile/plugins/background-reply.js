// A reply streams on with the app in the background (src/agent/background.ts): Android 14+ wants the foreground
// service's type in the manifest, matching the one it's started with, and HeadlessJS holds a wake lock.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const SERVICE = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = (config) => {
  config = AndroidConfig.Permissions.withPermissions(config, ["android.permission.FOREGROUND_SERVICE_DATA_SYNC", "android.permission.WAKE_LOCK"]);
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({ $: { "android:name": SERVICE, "android:foregroundServiceType": "dataSync", "android:exported": "false" } });
    return c;
  });
};
