// The app's one screen of its own, and what its launcher icon opens: the server's address (the only thing set here; every
// other preference is the web app's), the ways in it adds to the phone, and what waits to be sent.
package app.tefnotes.companion

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Bundle
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.lifecycle.lifecycleScope
import app.tefnotes.companion.widget.NotesWidgetReceiver
import app.tefnotes.companion.widget.TasksWidgetReceiver
import kotlinx.coroutines.launch
import org.json.JSONObject

class SettingsActivity : ComponentActivity() {
    private val shake = Shake()
    private var look by mutableStateOf<Look?>(null)
    private var server by mutableStateOf<String?>(null)
    private var address by mutableStateOf("")
    private var busy by mutableStateOf(false)
    /** What the last Connect came to, and whether that was a no. */
    private var said by mutableStateOf<String?>(null)
    private var failed by mutableStateOf(false)
    private var waiting by mutableStateOf(emptyList<Outbox.Waiting>())

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        server = Store.server(this)
        address = server ?: ""
        setContent {
            Themed(look ?: Store.look(this)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(Modifier.windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime)).verticalScroll(rememberScrollState()).padding(20.dp)) { Screen() }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        waiting = Outbox.list(this)
    }

    private fun no(why: String?) {
        said = why
        failed = true
        window.decorView.performHapticFeedback(HapticFeedbackConstants.REJECT)
        lifecycleScope.launch { shake.go() }
    }

    /** The address as typed, asked whether it is a TEF Notes server this build can draw for; kept only when it is. */
    private fun connect() {
        if (busy || address.isBlank()) return
        val origin = serverAddress(address) ?: return no("That is not an https address.")
        busy = true
        said = null
        failed = false
        lifecycleScope.launch {
            try {
                val hello = Api(origin).hello()
                if (hello.contract != CONTRACT) no("That server and this app are of different versions: update the ${if (hello.contract > CONTRACT) "app" else "server"}.")
                else {
                    Store.setServer(this@SettingsActivity, origin, hello)
                    server = origin
                    address = origin
                    look = lookOf(JSONObject(hello.look))
                    Sync.now(this@SettingsActivity)
                    said = "Connected."
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                }
            } catch (_: Unreachable) {
                no("Nothing answered as TEF Notes at that address. Is the phone on the server's network?")
            } catch (e: Refused) {
                no(if (e.status == 404) "That server is older than this app: update the server." else e.message)
            }
            busy = false
        }
    }

    private fun pin(widget: Class<out GlanceAppWidgetReceiver>) {
        lifecycleScope.launch {
            if (!GlanceAppWidgetManager(this@SettingsActivity).requestPinGlanceAppWidget(widget)) { failed = false; said = "This launcher adds widgets from its own menu: hold an empty spot on the home screen." }
        }
    }

    @Composable
    private fun Screen() {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Glyph(R.drawable.ic_mark, null, MaterialTheme.colorScheme.primary, 28.dp)
            Text("TEF Notes Companion", style = MaterialTheme.typography.headlineSmall)
        }
        Text("Widgets, sharing and a quick-settings tile for your TEF Notes. The app itself is the web app; this only opens it.",
            Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Heading("Server")
        TfField(
            address, { address = it; failed = false }, "notes.example.ts.net", invalid = failed, shake = shake.x,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { connect() }),
        )
        TfButton(::connect, Modifier.fillMaxWidth().padding(top = 12.dp), enabled = !busy && address.isNotBlank()) {
            Swap(if (busy) "Connecting…" else if (server == null) "Connect" else "Reconnect") { Text(it) }
        }
        Unfolding(said != null) {
            Text(said ?: "", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium, color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        }

        // What a connected server opens up unfolds under it.
        Unfolding(server != null) {
            Column {
                Way({ OpenActivity.open(this@SettingsActivity, "/") }, "Open TEF Notes", Modifier.padding(top = 12.dp), ButtonKind.Primary)
                Heading("On this phone")
                Text("Share a link, some text or a picture from any app, or select text anywhere, and pick Save to TEF Notes.",
                    Modifier.padding(bottom = 12.dp), style = MaterialTheme.typography.bodyMedium)
                Way({ pin(TasksWidgetReceiver::class.java) }, "Add the Tasks widget")
                Way({ pin(NotesWidgetReceiver::class.java) }, "Add the Notes widget")
                Way({
                    getSystemService(StatusBarManager::class.java).requestAddTileService(
                        ComponentName(this@SettingsActivity, TaskTile::class.java), getString(R.string.new_task), Icon.createWithResource(this@SettingsActivity, R.drawable.ic_newtask), mainExecutor) { }
                }, "Add the New task tile")
            }
        }

        Unfolding(waiting.isNotEmpty()) {
            Column {
                Heading("Waiting to be sent")
                AnimatedRows(waiting, { it.file.name }) { entry ->
                    Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(entry.what, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
                            entry.refused?.let { Text("Not sent: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                        }
                        if (entry.refused != null) TfButton({ Outbox.discard(entry); waiting = Outbox.list(this@SettingsActivity) }, kind = ButtonKind.Ghost) { Text("Discard") }
                    }
                }
                if (waiting.any { it.refused == null }) Way({ Sync.now(this@SettingsActivity) }, "Send now")
            }
        }
    }

    @Composable
    private fun Heading(text: String) =
        Text(text, Modifier.padding(top = 24.dp, bottom = 12.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)

    /** One of the things the screen does, a full-width button with the space under it. */
    @Composable
    private fun Way(onClick: () -> Unit, label: String, modifier: Modifier = Modifier, kind: ButtonKind = ButtonKind.Secondary) =
        Box(modifier.padding(bottom = 8.dp)) { TfButton(onClick, Modifier.fillMaxWidth(), kind) { Text(label) } }
}
