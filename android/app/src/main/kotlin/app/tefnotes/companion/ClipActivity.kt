// "Save to TEF Notes", from the share sheet (a link, text, one picture) and from the menu over selected text in any app.
// The server's two steps, as the extension and the web app's share page take them (extension/AGENTS.md "Contract"):
// suggest where it fits, then save where the owner picks. A new note and a new task are offered at once, the rest when
// the server has answered; an added note asks again. With the server out of reach, the clip waits in the outbox
// (Outbox.kt) as a new note.
package app.tefnotes.companion

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

class ClipActivity : ComponentActivity() {
    private lateinit var page: ClipPage
    private var picture by mutableStateOf<Picture?>(null)
    private var suggestions by mutableStateOf(Suggestions.NONE)
    private var asking by mutableStateOf(true)
    /** The server can't be reached: the clip can only be kept for later. */
    private var offline by mutableStateOf(false)
    private var note by mutableStateOf("")
    private var summary by mutableStateOf(false)
    private var saving by mutableStateOf<Target?>(null)
    private var done by mutableStateOf<String?>(null)
    private var notice by mutableStateOf<String?>(null)
    private var ask: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val server = Store.server(this)
        val image = if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else null
        val words = (if (intent.action == Intent.ACTION_PROCESS_TEXT) intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) else intent.getCharSequenceExtra(Intent.EXTRA_TEXT))?.toString() ?: ""
        val shared = shareClip(words, intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "", image != null)
        if (server == null || shared == null) {
            if (server == null) OpenActivity.open(this, "/") else Toast.makeText(this, "Nothing to save there", Toast.LENGTH_SHORT).show()
            return finish()
        }
        page = shared
        summary = Store.summary(this)
        val api = Api(server)
        lifecycleScope.launch {
            if (image != null) {
                picture = readPicture(this@ClipActivity, image)
                if (picture == null) {
                    Toast.makeText(this@ClipActivity, "That picture can't be read", Toast.LENGTH_SHORT).show()
                    return@launch finish()
                }
            }
            suggest(api, 0)
        }
        // The lens may have changed since the app last heard: what a new note is tagged with is asked for again.
        lifecycleScope.launch { try { Store.keep(this@ClipActivity, api.hello()) } catch (_: Unreachable) { } catch (_: Refused) { } }
        setContent {
            Sheet(Store.look(this), "Save to TEF Notes", ::finish) {
                val said = done
                if (said != null) Done(said, notice) else Form(api)
            }
        }
    }

    /** Asks where the clip fits, after `pause` (a note being typed asks once the typing stops). */
    private fun suggest(api: Api, pause: Long) {
        ask?.cancel()
        ask = lifecycleScope.launch {
            delay(pause)
            asking = true
            try {
                suggestions = api.suggest(suggestBody(page, note, picture?.look))
                offline = false
            } catch (_: Unreachable) {
                offline = true
            } catch (_: Refused) {
                suggestions = Suggestions.NONE          // no suggestions: a new note and a new task are still offered
            }
            asking = false
        }
    }

    private fun save(api: Api, target: Target) {
        if (saving != null) return
        ask?.cancel()
        saving = target
        val payload = saveBody(page, suggestions.line, target, note, summary, listOfNotNull(Store.tag(this).takeIf { target.makes }))
        val jpeg = picture?.stored.takeIf { sendsFile(page, target) }
        lifecycleScope.launch {
            try {
                val r = api.save(payload, jpeg)
                finished(describe(r), summaryNotice(r))
            } catch (e: Refused) {
                if (e.again) later(payload, jpeg) else {
                    saving = null
                    Toast.makeText(this@ClipActivity, e.message, Toast.LENGTH_LONG).show()
                }
            } catch (_: Unreachable) {
                later(payload, jpeg)
            }
        }
    }

    private suspend fun later(payload: JSONObject, jpeg: ByteArray?) {
        Outbox.addClip(this, payload, jpeg, page.title.ifEmpty { page.url }.ifEmpty { page.selection ?: "A picture" })
        finished("Saved for later", "It is sent when the server is reachable.")
    }

    private suspend fun finished(said: String, about: String?) {
        done = said
        notice = about
        Sync.now(this)
        delay(if (about == null) CLOSE_MS else CLOSE_NOTICE_MS)
        finish()
    }

    @Composable
    private fun Form(api: Api) {
        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(14.dp)) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                picture?.let {
                    Image(it.shown.asImageBitmap(), "The picture", Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                    Spacer(Modifier.width(12.dp))
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (page.title.isNotEmpty()) Text(page.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (page.url.isNotEmpty()) Text(page.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    page.selection?.let { Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis) }
                    if (page.picture && page.selection == null && page.url.isEmpty()) Text("A picture", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        OutlinedTextField(
            note, { note = it; if (!offline) suggest(api, TYPING_MS) }, Modifier.fillMaxWidth(), placeholder = { Text("Add a note (optional)") }, maxLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        Row(Modifier.fillMaxWidth().clickable { summary = !summary }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(summary, { summary = it })
            Text("Add a summary", style = MaterialTheme.typography.bodyMedium)
        }
        if (offline) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(R.drawable.ic_offline, null, MaterialTheme.colorScheme.error)
                Text("The server can't be reached. Is the phone on its network?", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Option(Choice(Target.New, "Save for later, as a new note", null), true, api)
            FilledTonalButton({ suggest(api, 0) }, Modifier.fillMaxWidth(), enabled = !asking && saving == null) { Text("Try again") }
            return
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Save to", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (asking) {
                Text("Finding where it fits", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            }
        }
        // While the server is asked, a new note and a new task are already there to take.
        choices(suggestions, page.picture).forEachIndexed { i, choice -> Option(choice, i == 0 && !asking, api) }
    }

    @Composable
    private fun Option(choice: Choice, top: Boolean, api: Api) {
        val icon = when (choice.target) {
            Target.New -> R.drawable.ic_note
            Target.NewTask -> R.drawable.ic_newtask
            is Target.Note -> R.drawable.ic_append
            is Target.Task -> R.drawable.ic_task
        }
        val content: @Composable () -> Unit = {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (saving == choice.target) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = LocalContentColor.current)
                else Glyph(icon, null, LocalContentColor.current, 18.dp)
                Text(choice.label, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                choice.hint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
        val padding = ButtonDefaults.ContentPadding
        if (top) Button({ save(api, choice.target) }, Modifier.fillMaxWidth(), enabled = saving == null, contentPadding = padding) { content() }
        else FilledTonalButton({ save(api, choice.target) }, Modifier.fillMaxWidth(), enabled = saving == null, contentPadding = padding) { content() }
    }

    @Composable
    private fun Done(said: String, about: String?) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Glyph(R.drawable.ic_check, null, MaterialTheme.colorScheme.tertiary, 24.dp)
            Column {
                Text(said, style = MaterialTheme.typography.titleMedium)
                about?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }

    private companion object {
        /** The pause in typing a note after which the suggestions are asked for again (the extension's 0.9 s). */
        const val TYPING_MS = 900L
        /** How long the result is shown before the sheet leaves; longer when it has something more to say. */
        const val CLOSE_MS = 1_500L
        const val CLOSE_NOTICE_MS = 5_000L
    }
}
