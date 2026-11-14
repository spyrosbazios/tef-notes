// The app's one screen of its own, and what its launcher icon opens: the server's address (the only thing set here; every
// other preference is the web app's), the ways in it adds to the phone, and what waits to be sent.
package app.tefnotes.companion

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
    private var look by mutableStateOf<Look?>(null)
    private var server by mutableStateOf<String?>(null)
    private var address by mutableStateOf("")
    private var busy by mutableStateOf(false)
    private var said by mutableStateOf<String?>(null)
    private var waiting by mutableStateOf(emptyList<Outbox.Waiting>())

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        server = Store.server(this)
        address = server ?: ""
        setContent {
            Themed(look ?: Store.look(this)) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(
                        Modifier.windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) { Screen() }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        waiting = Outbox.list(this)
    }

    /** The address as typed, asked whether it is a TEF Notes server this build can draw for; kept only when it is. */
    private fun connect() {
        val origin = serverAddress(address) ?: run { said = "That is not an https address."; return }
        busy = true
        said = null
        lifecycleScope.launch {
            said = try {
                val hello = Api(origin).hello()
                if (hello.contract != CONTRACT) "That server and this app are of different versions: update the ${if (hello.contract > CONTRACT) "app" else "server"}."
                else {
                    Store.setServer(this@SettingsActivity, origin, hello)
                    server = origin
                    address = origin
                    look = lookOf(JSONObject(hello.look))
                    Sync.now(this@SettingsActivity)
                    "Connected."
                }
            } catch (_: Unreachable) {
                "Nothing answered as TEF Notes at that address. Is the phone on the server's network?"
            } catch (e: Refused) {
                if (e.status == 404) "That server is older than this app: update the server." else e.message
            }
            busy = false
        }
    }

    private fun pin(widget: Class<out GlanceAppWidgetReceiver>) {
        lifecycleScope.launch { if (!GlanceAppWidgetManager(this@SettingsActivity).requestPinGlanceAppWidget(widget)) said = "This launcher adds widgets from its own menu: hold an empty spot on the home screen." }
    }

    @Composable
    private fun Screen() {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Glyph(R.drawable.ic_mark, null, MaterialTheme.colorScheme.primary, 28.dp)
            Text("TEF Notes Companion", style = MaterialTheme.typography.headlineSmall)
        }
        Text("Widgets, sharing and a quick-settings tile for your TEF Notes. The app itself is the web app; this only opens it.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Heading("Server")
        OutlinedTextField(
            address, { address = it }, Modifier.fillMaxWidth(), label = { Text("Address") }, placeholder = { Text("notes.example.ts.net") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onGo = { connect() }),
        )
        Button(::connect, Modifier.fillMaxWidth(), enabled = !busy && address.isNotBlank()) { Text(if (busy) "Connecting" else if (server == null) "Connect" else "Reconnect") }
        said?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        if (server == null) return

        FilledTonalButton({ OpenActivity.open(this, "/") }, Modifier.fillMaxWidth()) { Text("Open TEF Notes") }

        Heading("On this phone")
        Text("Share a link, some text or a picture from any app, or select text anywhere, and pick Save to TEF Notes.", style = MaterialTheme.typography.bodyMedium)
        FilledTonalButton({ pin(TasksWidgetReceiver::class.java) }, Modifier.fillMaxWidth()) { Text("Add the Tasks widget") }
        FilledTonalButton({ pin(NotesWidgetReceiver::class.java) }, Modifier.fillMaxWidth()) { Text("Add the Notes widget") }
        FilledTonalButton({
            getSystemService(StatusBarManager::class.java).requestAddTileService(
                ComponentName(this, TaskTile::class.java), getString(R.string.new_task), Icon.createWithResource(this, R.drawable.ic_newtask), mainExecutor) { }
        }, Modifier.fillMaxWidth()) { Text("Add the New task tile") }

        if (waiting.isEmpty()) return
        Heading("Waiting to be sent")
        for (entry in waiting) Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(entry.what, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
                entry.refused?.let { Text("The server refused it: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
            if (entry.refused != null) TextButton({ Outbox.discard(entry); waiting = Outbox.list(this@SettingsActivity) }) { Text("Discard") }
        }
        if (waiting.any { it.refused == null }) FilledTonalButton({ Sync.now(this) }, Modifier.fillMaxWidth()) { Text("Send now") }
    }

    @Composable
    private fun Heading(text: String) =
        Text(text, Modifier.padding(top = 10.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}
