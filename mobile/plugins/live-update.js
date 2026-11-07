// The reply in flight as an Android 16 Live Update (a promoted ongoing notification: status-bar chip, expanded card on
// the lock screen). react-native-background-actions owns the foreground service and its notification (id 92901) but builds
// it without the promotion API, so this adds a small native module, `LiveUpdate`, that re-posts that same notification
// id promoted (src/agent/background.ts calls it once the service is up). It does nothing below Android 16 or when
// `canPostPromotedNotifications()` is false (the user's per-app "Live updates" switch), leaving the library's notification
// as it was. POST_PROMOTED_NOTIFICATIONS is a normal permission: declared, never asked.
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withDangerousMod, withMainApplication } = require("expo/config-plugins");

const kotlin = (pkg) => ({
  "LiveUpdateModule.kt": `package ${pkg}

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LiveUpdateModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "LiveUpdate"

  /** Re-post the background service's notification as a Live Update; resolves whether it was (false: not promotable here). */
  @ReactMethod
  fun show(title: String, text: String, chip: String, color: String, uri: String, promise: Promise) {
    try {
      val manager = ctx.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT < 36 || !manager.canPostPromotedNotifications()) {
        promise.resolve(false)
        return
      }
      val icon = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
      val open = PendingIntent.getActivity(
        ctx, 0, Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(ctx.packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val notification = NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(open)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setColor(try { Color.parseColor(color) } catch (e: IllegalArgumentException) { Color.WHITE })
        .setStyle(NotificationCompat.ProgressStyle().setProgressIndeterminate(true))
        .setShortCriticalText(chip)
        .setRequestPromotedOngoing(true)
        .build()
      manager.notify(SERVICE_NOTIFICATION_ID, notification)
      promise.resolve(true)
    } catch (e: RuntimeException) {
      promise.resolve(false)
    }
  }

  /** Drop what show() posted, for a reply that ended while the post was on its way (the service's stop had already removed the rest). */
  @ReactMethod
  fun hide() {
    ctx.getSystemService(NotificationManager::class.java).cancel(SERVICE_NOTIFICATION_ID)
  }

  private companion object {
    // the channel and notification id react-native-background-actions' service uses
    const val CHANNEL = "RN_BACKGROUND_ACTIONS_CHANNEL"
    const val SERVICE_NOTIFICATION_ID = 92901
  }
}
`,
  "LiveUpdatePackage.kt": `package ${pkg}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LiveUpdatePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LiveUpdateModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`,
});

module.exports = (config) => {
  config = AndroidConfig.Permissions.withPermissions(config, ["android.permission.POST_PROMOTED_NOTIFICATIONS"]);
  config = withDangerousMod(config, ["android", async (c) => {
    const pkg = c.android?.package;
    const dir = path.join(c.modRequest.platformProjectRoot, "app/src/main/java", ...pkg.split("."));
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, src] of Object.entries(kotlin(pkg))) fs.writeFileSync(path.join(dir, file), src);
    return c;
  }]);
  return withMainApplication(config, (c) => {
    const src = c.modResults.contents;
    if (src.includes("LiveUpdatePackage()")) return c;
    const hook = "// add(MyReactNativePackage())";
    if (!src.includes(hook)) throw new Error("live-update: MainApplication's package list changed; update the plugin");
    c.modResults.contents = src.replace(hook, `${hook}\n          add(LiveUpdatePackage())`);
    return c;
  });
};
