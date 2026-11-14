// "Save to TEF Notes", from the share sheet (a link, text, one picture) and from the menu over selected text in any app.
// The server's two steps, as the extension and the web app's share page take them (extension/AGENTS.md "Contract"):
// suggest where it fits, then save where the owner picks. A new note and a new task are offered at once, the rest unfold
// when the server has answered; an added note asks again. Tags are asked for beside the suggestions, as the clipper's
// are, and shown as the web app's tag editor shows them: the server's picks are on, the likely ones beside them, every
// other defined tag a tap away, each put on or taken off where it stands; once the owner has changed them they are no
// longer asked for again. With the server out of reach, the clip waits in the outbox (Outbox.kt) as a new note.
package app.tefnotes.companion

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ClipActivity : ComponentActivity() {
    private val sheet = SheetControl()
    private lateinit var page: ClipPage
    private var picture by mutableStateOf<Picture?>(null)
    private var suggestions by mutableStateOf(Suggestions.NONE)
    private var asking by mutableStateOf(true)
    /** The server can't be reached: the clip can only be kept for later. */
    private var offline by mutableStateOf(false)
    private var note by mutableStateOf("")
    /** Every defined tag as the server scored it; the ones on; whether the owner changed them (then they stay theirs);
     *  whether every tag is shown, not only the likely ones. */
    private var tags by mutableStateOf(emptyList<ScoredTag>())
    private var picked by mutableStateOf(emptyList<String>())
    private var touched = false
    private var tagging by mutableStateOf(true)
    private var allTags by mutableStateOf(false)
    private var summary by mutableStateOf(false)
    private var saving by mutableStateOf<Target?>(null)
    /** What the server said when it refused the save. */
    private var refused by mutableStateOf<String?>(null)
    /** What became of the clip, once saved: the line, and what else there is to say. */
    private var done by mutableStateOf<Pair<String, String?>?>(null)
    private var ask: Job? = null
    private var askTags: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val server = Store.server(this)
        // A picture is read through its provider only (a content address): never a file path another app names.
        val image = if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true)
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)?.takeIf { it.scheme == "content" } else null
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
            Sheet(Store.look(this), "Save to TEF Notes", sheet, ::leave) {
                Panels(done) { said -> if (said != null) Done(said.first, said.second) else Column { Form(api) } }
            }
        }
    }

    /** Asks which tags the clip belongs under, after `pause`; not once the owner has changed them. */
    private fun tag(api: Api, pause: Long) {
        if (touched) return
        askTags?.cancel()
        askTags = lifecycleScope.launch {
            delay(pause)
            tagging = true
            try {
                val t = api.tags(suggestBody(page, note, null))
                tags = t.tags
                if (!touched) picked = t.picked
            } catch (_: Unreachable) { } catch (_: Refused) { }      // no tags to offer: the clip is saved without
            tagging = false
        }
    }

    private fun pick(name: String, on: Boolean) {
        touched = true
        askTags?.cancel()
        tagging = false
        picked = if (on) picked + name else picked - name
        window.decorView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }

    /** Asks where the clip fits, after `pause` (a note being typed asks once the typing stops). */
    private fun suggest(api: Api, pause: Long) {
        tag(api, pause)
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
        askTags?.cancel()
        asking = false
        tagging = false
        refused = null
        saving = target
        val sent = savedTags(picked, listOfNotNull(Store.tag(this).takeIf { target.makes }))
        val payload = saveBody(page, suggestions.line, target, note, summary, sent)
        val jpeg = picture?.stored.takeIf { sendsFile(page, target) }
        lifecycleScope.launch {
            try {
                val r = api.save(payload, jpeg)
                finished(describe(r), summaryNotice(r), sent)
            } catch (e: Refused) {
                if (e.again) later(payload, jpeg) else {
                    saving = null
                    refused = e.message
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.REJECT)
                }
            } catch (_: Unreachable) {
                later(payload, jpeg)
            }
        }
    }

    private suspend fun later(payload: JSONObject, jpeg: ByteArray?) {
        withContext(Dispatchers.IO) { Outbox.addClip(this@ClipActivity, payload, jpeg, page.title.ifEmpty { page.url }.ifEmpty { page.selection ?: "A picture" }) }
        finished("Saved for later", "It is sent when the server is reachable.")
    }

    /** Shows what became of the clip, then leaves: after a moment, or a longer one when there is something to read. */
    private suspend fun finished(said: String, about: String?, tagged: List<String> = emptyList()) {
        done = said to listOfNotNull(tagged.takeIf { it.isNotEmpty() }?.let { "Tagged ${it.joinToString(", ")}" }, about).joinToString("\n").ifEmpty { null }
        window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        Sync.now(this)
        delay(if (about == null) CLOSE_MS else CLOSE_NOTICE_MS)
        sheet.close()
    }

    /** The sheet is off the screen: the window goes with no move of its own. */
    private fun leave() {
        overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        finish()
    }

    @Composable
    private fun Form(api: Api) {
        Shared()
        Tags()
        TfField(
            note, { note = it; if (!offline) suggest(api, TYPING_MS) }, "Add a note (optional)", Modifier.padding(top = 12.dp), singleLine = false, minLines = 2, maxLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        TickBox(summary, { summary = it }, "Add a summary", Modifier.fillMaxWidth().padding(top = 4.dp))
        Unfolding(refused != null) {
            Text(refused ?: "", Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        Row(Modifier.padding(top = 4.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (offline) "Out of reach" else "Save to", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Swap(asking && !offline) { busy ->
                if (busy) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Finding where it fits", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spinner(14.dp, MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Unfolding(offline) {
            Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(R.drawable.ic_offline, null, MaterialTheme.colorScheme.error, 18.dp)
                Text("The server can't be reached. Is the phone on its network?", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        // While the server is asked, a new note and a new task are already there to take; out of reach, only keeping it.
        val options = if (offline) listOf(Choice(Target.New, "Save for later, as a new note", null)) else choices(suggestions, page.picture)
        AnimatedRows(options, { it.target }) { choice -> Box(Modifier.padding(bottom = 8.dp)) { Option(choice, choice == options.first() && (offline || !asking), api) } }
        Unfolding(offline) {
            TfButton({ suggest(api, 0) }, Modifier.fillMaxWidth(), ButtonKind.Ghost, enabled = !asking && saving == null) {
                Swap(asking) { busy -> if (busy) Spinner() else Text("Try again") }
            }
        }
    }

    /** What was shared, as the web app's share page shows it: the picture or a link's mark, the page's title and address,
     *  the words. */
    @Composable
    private fun Shared() {
        val shape = RoundedCornerShape(16.dp)
        Row(
            Modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val shown = picture
            when {
                shown != null -> Image(shown.shown.asImageBitmap(), "The picture", Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop)
                page.picture -> Box(Modifier.size(56.dp).clip(RoundedCornerShape(6.dp)).background(Color(LocalLook.current.muted)), contentAlignment = Alignment.Center) { Spinner() }
                page.url.isNotEmpty() -> Glyph(R.drawable.ic_link, null, size = 18.dp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (page.title.isNotEmpty()) Text(page.title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (page.url.isNotEmpty()) Text(page.url, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                page.selection?.let { Text(it, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), maxLines = 6, overflow = TextOverflow.Ellipsis) }
                if (page.picture && page.selection == null && page.url.isEmpty()) Text("A picture", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }

    /** The tags: each where the server ranked it, on or off at a tap. The likely ones show beside the ones on; "All tags"
     *  brings out the rest. Nothing while there is no tag to show: none defined, or the server not reached. */
    @Composable
    private fun Tags() = Unfolding(tags.isNotEmpty() || tagging) {
        Column(Modifier.padding(top = 12.dp)) {
            Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Tags", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Swap(tagging) { busy -> if (busy) Spinner(14.dp, MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            val rest = unpickedTags(tags, picked)
            FlowRow {
                for (t in tags) {
                    val on = t.name in picked
                    val likely = rest.offered.any { it.name == t.name }
                    AnimatedVisibility(
                        on || likely || allTags,
                        enter = expandHorizontally(Tokens.Springs.reflow.spec()) + scaleIn(Tokens.Springs.pop.spec(), Tokens.Scales.icon) + fadeIn(Tokens.Tweens.fade.spec()),
                        exit = shrinkHorizontally(Tokens.Springs.reflow.spec()) + scaleOut(Tokens.Tweens.popOut.spec(), Tokens.Scales.icon) + fadeOut(Tokens.Tweens.popOut.spec()),
                    ) { Box(Modifier.padding(end = 8.dp, bottom = 8.dp)) { TagChip(t.name, on, { pick(t.name, !on) }, hint = percent(t.p).takeIf { likely }) } }
                }
                if (rest.more.isNotEmpty() || allTags) TfButton({ allTags = !allTags }, Modifier.padding(bottom = 8.dp), ButtonKind.Ghost, round = true, height = 36.dp) {
                    Swap(allTags) { all -> Text(if (all) "Fewer" else "All tags", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }

    @Composable
    private fun Option(choice: Choice, top: Boolean, api: Api) {
        val icon = when (choice.target) {
            Target.New -> R.drawable.ic_note
            Target.NewTask -> R.drawable.ic_newtask
            is Target.Note -> R.drawable.ic_append
            is Target.Task -> R.drawable.ic_task
        }
        // A picture still being read has no bytes to send yet.
        val ready = saving == null && (!page.picture || picture != null)
        TfButton({ save(api, choice.target) }, Modifier.fillMaxWidth(), if (top) ButtonKind.Primary else ButtonKind.Secondary, enabled = ready || saving == choice.target) {
            Swap(saving == choice.target) { busy -> if (busy) Spinner(18.dp) else Glyph(icon, null, LocalContentColor.current, 18.dp) }
            Text(choice.label, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            choice.hint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }

    @Composable
    private fun Done(said: String, about: String?) {
        Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PopIn { Glyph(R.drawable.ic_check, null, MaterialTheme.colorScheme.tertiary, 24.dp) }
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
