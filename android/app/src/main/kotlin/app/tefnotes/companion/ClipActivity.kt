// "Save to TEF Notes", from the share sheet (a link, text, pictures, PDFs) and from the menu over selected text in any app.
// The server's two steps, as the extension and the web app's share page take them (extension/AGENTS.md "Contract"):
// suggest where it fits, then save where the owner picks. A new note and a new task are offered at once, the rest unfold
// when the server has answered; an added note asks again. Tags are asked for beside the suggestions, as the clipper's
// are, and shown as the web app's tag editor shows them: the server's picks are on, the likely ones beside them, every
// other defined tag a tap away, each put on or taken off where it stands; once the owner has changed them they are no
// longer asked for again. With the server out of reach, the clip waits in the outbox (Outbox.kt) as a new note.
// The files are read once, as the sheet opens, into a folder of the clip's own in the cache: each picture as the JPEG that
// is stored (Picture.kt), each PDF as it is; the save streams them from there, and the folder goes with the sheet.
package app.tefnotes.companion

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
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
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import org.json.JSONObject

class ClipActivity : ComponentActivity() {
    private val sheet = SheetControl()
    private lateinit var page: ClipPage
    /** The clip's own folder in the cache, where its files are read to; gone with the sheet. */
    private val staged by lazy { File(cacheDir, "clip-${UUID.randomUUID()}") }
    /** The pictures as read so far, to show and for JEV to look at the first of. */
    private var pictures by mutableStateOf(emptyList<Picture>())
    /** Every file read and ready to send, the pictures then the PDFs; null until they are. */
    private var parts by mutableStateOf<List<Part>?>(null)
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
        val server = Store.server(this) ?: return run { OpenActivity.open(this, "/"); finish() }
        val files = sharedFiles() ?: return refuse("Only pictures and PDFs can be saved")
        if (files.pictures.size + files.pdfs.size > CLIP_FILES) return refuse("At most $CLIP_FILES pictures and PDFs at once")
        val words = (if (intent.action == Intent.ACTION_PROCESS_TEXT) intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) else intent.getCharSequenceExtra(Intent.EXTRA_TEXT))?.toString() ?: ""
        page = shareClip(words, intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "", files.pictures.size, files.pdfs.map { it.second })
            ?: return refuse("Nothing to save there")
        summary = Store.summary(this)
        val api = Api(server)
        lifecycleScope.launch {
            val problem = stage(files)
            if (problem != null) {
                Toast.makeText(this@ClipActivity, problem, Toast.LENGTH_LONG).show()
                return@launch finish()
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

    /** What was shared: the pictures, and each PDF with its name. A file is read through its provider only (a content
     *  address): never a file path another app names. null when something shared is neither a picture nor a PDF. */
    private class Files(val pictures: List<Uri>, val pdfs: List<Pair<Uri, String>>)

    private fun refuse(why: String) {
        Toast.makeText(this, why, Toast.LENGTH_SHORT).show()
        finish()
    }

    private fun sharedFiles(): Files? {
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }.filter { it.scheme == "content" }
        val pictures = mutableListOf<Uri>()
        val pdfs = mutableListOf<Pair<Uri, String>>()
        for (uri in uris) {
            val name = nameOf(uri)
            val type = contentResolver.getType(uri) ?: intent.type ?: ""
            when {
                type.startsWith("image/") -> pictures += uri
                type == Part.PDF_TYPE || name.endsWith(".pdf", ignoreCase = true) -> pdfs += uri to name.ifEmpty { "document.pdf" }
                else -> return null
            }
        }
        return Files(pictures, pdfs)
    }

    /** The name the providing app gives a file; "" when it gives none. */
    private fun nameOf(uri: Uri): String = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0).orEmpty() else ""
        } ?: ""
    } catch (_: Exception) {
        ""          // whatever the other app's provider threw, it gave no name
    }

    /** Reads the shared files into the clip's folder: each picture as its stored JPEG, each PDF as it is, no larger than
     *  the server takes. What is wrong, for the owner, when one can't be read. */
    private suspend fun stage(files: Files): String? {
        staged.mkdirs()
        val read = mutableListOf<Part>()
        for ((i, uri) in files.pictures.withIndex()) {
            val p = readPicture(this, uri) ?: return if (files.pictures.size > 1) "Picture ${i + 1} can't be read" else "That picture can't be read"
            val file = File(staged, "picture-${i + 1}.jpg")
            withContext(Dispatchers.IO) { file.writeBytes(p.stored) }
            pictures = pictures + p
            read += Part(file, Part.JPEG_TYPE)
        }
        for ((i, pdf) in files.pdfs.withIndex()) {
            val (uri, name) = pdf
            val file = File(staged, "pdf-${i + 1}.pdf")
            val copied = withContext(Dispatchers.IO) {
                try {
                    contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { out -> copyAtMost(input, out, MAX_PDF) } }
                } catch (_: IOException) { null } catch (_: SecurityException) { null }
            }
            when (copied) {
                null -> return "$name can't be read"
                false -> return "$name is over ${MAX_PDF / 1024 / 1024} MB"
                true -> read += Part(file, Part.PDF_TYPE)
            }
        }
        parts = read
        return null
    }

    /** Copies `input` into `out`; false, having stopped, once it runs past `max` bytes. */
    private fun copyAtMost(input: InputStream, out: OutputStream, max: Long): Boolean {
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val n = input.read(buf)
            if (n < 0) return true
            total += n
            if (total > max) return false
            out.write(buf, 0, n)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) staged.deleteRecursively()
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
                suggestions = api.suggest(suggestBody(page, note, pictures.firstOrNull()?.look))
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
        val sent = picked                               // the owner's picks: the server adds the lens's tag to what it makes
        val payload = saveBody(page, suggestions.line, target, note, summary, sent)
        val files = if (sendsFiles(page, target)) parts.orEmpty() else emptyList()
        lifecycleScope.launch {
            try {
                val r = api.save(payload, files)
                finished(describe(r), summaryNotice(r), sent)
            } catch (e: Refused) {
                if (e.again) later(payload, files) else {
                    saving = null
                    refused = e.message
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.REJECT)
                }
            } catch (_: Unreachable) {
                later(payload, files)
            }
        }
    }

    private suspend fun later(payload: JSONObject, files: List<Part>) {
        val what = page.title.ifEmpty { page.url }.ifEmpty { page.selection ?: page.pdfs.singleOrNull()?.takeIf { page.pictures == 0 } ?: filesWord(page) ?: "" }
        withContext(Dispatchers.IO) { Outbox.addClip(this@ClipActivity, payload, files, what.replaceFirstChar { it.uppercase() }) }
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
        val options = if (offline) listOf(Choice(Target.New, "Save for later, as a new note", null)) else choices(suggestions, filesWord(page))
        AnimatedRows(options, { it.target }) { choice -> Box(Modifier.padding(bottom = 8.dp)) { Option(choice, choice == options.first() && (offline || !asking), api) } }
        Unfolding(offline) {
            TfButton({ suggest(api, 0) }, Modifier.fillMaxWidth(), ButtonKind.Ghost, enabled = !asking && saving == null) {
                Swap(asking) { busy -> if (busy) Spinner() else Text("Try again") }
            }
        }
    }

    /** What was shared, as the web app's share page shows it: the pictures, a link's mark, the page's title and address,
     *  the words, the PDFs by name. */
    @Composable
    private fun Shared() {
        val shape = RoundedCornerShape(16.dp)
        Column(
            Modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (page.pictures > 0) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val tile = Modifier.size(56.dp).clip(RoundedCornerShape(6.dp))
                val shown = minOf(page.pictures, THUMBS)
                for (i in 0 until shown) {
                    val p = pictures.getOrNull(i)
                    if (p != null) Image(p.shown.asImageBitmap(), "Picture ${i + 1}", tile, contentScale = ContentScale.Crop)
                    else Box(tile.background(Color(LocalLook.current.muted)), contentAlignment = Alignment.Center) { Spinner() }
                }
                if (page.pictures > shown) Box(tile.background(Color(LocalLook.current.muted)), contentAlignment = Alignment.Center) {
                    Text("+${page.pictures - shown}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (page.title.isNotEmpty() || page.url.isNotEmpty() || page.selection != null || page.pdfs.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (page.url.isNotEmpty()) Glyph(R.drawable.ic_link, null, size = 18.dp)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (page.title.isNotEmpty()) Text(page.title, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (page.url.isNotEmpty()) Text(page.url, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    page.selection?.let { Text(it, style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp), maxLines = 6, overflow = TextOverflow.Ellipsis) }
                    for (name in page.pdfs) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Glyph(R.drawable.ic_pdf, null, size = 16.dp)
                        Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
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
        // Files still being read have no bytes to send yet.
        val ready = saving == null && parts != null
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
        /** Pictures shown as tiles; past them, how many more. */
        const val THUMBS = 4
    }
}
