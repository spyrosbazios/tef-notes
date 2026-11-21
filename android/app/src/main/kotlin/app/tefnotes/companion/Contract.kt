// The server's answers as this app reads them, and the few rules it holds a copy of. The contract is
// packages/core/src/companion.ts (feeds, hello) and packages/core/src/clip.ts (a share's two steps); the copies (how a
// share reads as a clip, a picture's sizes and qualities, a clip's choices and what its save says, the contract, the task
// lists, the server's address, a ticked task's leaving the feed) are run over the core's own cases,
// packages/core/test/companion-cases.json, by CasesTest. Pure: no Android here, so the JVM tests cover it.
package app.tefnotes.companion

import java.text.Collator
import org.json.JSONArray
import org.json.JSONObject

/** The contract this build draws (companion.ts COMPANION_CONTRACT). */
const val CONTRACT = 3
const val APP = "tefnotes"

// ---- the look

/** The owner's colours, each as ARGB: the palette, and the washes the sheets are drawn with (`muted` a quiet fill,
 *  `soft` the brand's under something chosen, `scrim` what dims the screen under a sheet). */
data class Look(
    val dark: Boolean, val bg: Int, val card: Int, val raised: Int, val line: Int, val fg: Int, val dim: Int,
    val faint: Int, val brand: Int, val up: Int, val down: Int, val warn: Int, val muted: Int, val soft: Int, val scrim: Int,
)

/** `#rrggbb` (opaque) or `#rrggbbaa` as ARGB; null when it is neither. */
fun colorOf(hex: String?): Int? = when {
    hex == null -> null
    Regex("^#[0-9a-fA-F]{6}$").matches(hex) -> (0xFF000000 or hex.substring(1).toLong(16)).toInt()
    Regex("^#[0-9a-fA-F]{8}$").matches(hex) -> ((hex.substring(7).toLong(16) shl 24) or hex.substring(1, 7).toLong(16)).toInt()
    else -> null
}

/** A `Look` from its JSON; null when a colour is missing, so a half-read look is never drawn. */
fun lookOf(j: JSONObject?): Look? {
    if (j == null) return null
    fun c(name: String) = colorOf(j.optString(name))
    return Look(
        dark = j.optString("scheme") != "light",
        bg = c("bg") ?: return null, card = c("card") ?: return null, raised = c("raised") ?: return null,
        line = c("line") ?: return null, fg = c("fg") ?: return null, dim = c("dim") ?: return null,
        faint = c("faint") ?: return null, brand = c("brand") ?: return null, up = c("up") ?: return null,
        down = c("down") ?: return null, warn = c("warn") ?: return null, muted = c("muted") ?: return null,
        soft = c("soft") ?: return null, scrim = c("scrim") ?: return null,
    )
}

/** `GET hello`. `look`: its JSON as it came, kept to draw with before the next answer. */
data class Hello(val contract: Int, val look: String, val summary: Boolean, val tag: String?)

/** null when the answer is not a TEF Notes server's. */
fun helloOf(j: JSONObject): Hello? {
    val look = j.optJSONObject("look")
    if (j.optString("app") != APP || lookOf(look) == null) return null
    return Hello(j.optInt("contract"), look!!.toString(), j.optBoolean("summary"), j.optString("tag").takeIf { !j.isNull("tag") && it.isNotEmpty() })
}

// ---- the feeds

/** A lens a widget can turn on (companion.ts `LensChoice`). `id`: "" is none. `on`: the one on now. */
data class LensChoice(val id: String, val name: String, val on: Boolean)

/** What a widget's heading offers (companion.ts `Switches`). `lenses`: empty when there is none to switch to. `ask`: where
 *  the web app opens with the assistant ready. */
data class Switches(val lenses: List<LensChoice>, val ask: String)

private fun choices(a: JSONArray?) = a.list { LensChoice(it.optString("id"), it.optString("name"), it.optBoolean("on")) }
private fun switchesOf(j: JSONObject) = Switches(choices(j.optJSONArray("lenses")), j.optString("ask"))

/** The choices as the JSON they came in, and back: how a widget hands them to its picker. */
fun lensesJson(lenses: List<LensChoice>): String =
    JSONArray().apply { for (l in lenses) put(JSONObject().put("id", l.id).put("name", l.name).put("on", l.on)) }.toString()
fun lensChoicesOf(json: String?): List<LensChoice> = try { choices(json?.let(::JSONArray)) } catch (_: Exception) { emptyList() }

data class FeedTask(val id: String, val title: String, val detail: String, val late: Boolean, val url: String)
data class TaskSection(val label: String, val tasks: List<FeedTask>)
data class TasksFeed(val title: String, val url: String, val sections: List<TaskSection>, val more: Int, val look: Look?, val switches: Switches)

data class FeedNote(val id: String, val title: String, val peek: String, val pinned: Boolean, val url: String, val bg: Int?, val fg: Int?)
data class NotesFeed(val title: String, val url: String, val notes: List<FeedNote>, val more: Int, val look: Look?, val switches: Switches)

private fun <T> JSONArray?.list(of: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(of) }

private fun parsed(json: String?): JSONObject? = try { json?.let(::JSONObject) } catch (_: Exception) { null }

/** What the owner is told when the server and this build draw different contracts: which side to update. */
fun mismatchMessage(contract: Int) = "That server and this app are of different versions: update the ${if (contract > CONTRACT) "app" else "server"}."

/** The words for a feed that is of another contract than this build draws (`tasksFeedOf` and `notesFeedOf` answer null for
 *  it, which a widget would take for "not loaded yet"); null for anything else: none, no feed, or one this build draws. */
fun feedMismatch(json: String?): String? {
    val contract = parsed(json)?.takeIf { it.has("contract") }?.optInt("contract") ?: return null
    return if (contract == CONTRACT) null else mismatchMessage(contract)
}

/** A tasks feed from its JSON; null when it is none, or one of another contract. */
fun tasksFeedOf(json: String?): TasksFeed? {
    val j = parsed(json)?.takeIf { it.optInt("contract") == CONTRACT } ?: return null
    return TasksFeed(
        j.optString("title"), j.optString("url"),
        j.optJSONArray("sections").list { s ->
            TaskSection(s.optString("label"), s.optJSONArray("tasks").list { t ->
                FeedTask(t.optString("id"), t.optString("title"), t.optString("detail"), t.optBoolean("late"), t.optString("url"))
            })
        },
        j.optInt("more"), lookOf(j.optJSONObject("look")), switchesOf(j),
    )
}

/** The feed's JSON without the task `id`: what a widget shows from the tick until the server has it. */
fun withoutTask(json: String, id: String): String {
    val j = parsed(json) ?: return json
    val sections = JSONArray()
    for (s in j.optJSONArray("sections").list { it }) {
        val left = JSONArray()
        for (t in s.optJSONArray("tasks").list { it }) if (t.optString("id") != id) left.put(t)
        if (left.length() > 0) sections.put(JSONObject(s.toString()).put("tasks", left))
    }
    return j.put("sections", sections).toString()
}

fun notesFeedOf(json: String?): NotesFeed? {
    val j = parsed(json)?.takeIf { it.optInt("contract") == CONTRACT } ?: return null
    return NotesFeed(
        j.optString("title"), j.optString("url"),
        j.optJSONArray("notes").list { n ->
            val color = n.optJSONObject("color")
            FeedNote(n.optString("id"), n.optString("title"), n.optString("peek"), n.optBoolean("pinned"), n.optString("url"),
                colorOf(color?.optString("bg")), colorOf(color?.optString("fg")))
        },
        j.optInt("more"), lookOf(j.optJSONObject("look")), switchesOf(j),
    )
}

// ---- a share as a clip (clip.ts)

/** What is clipped: a page's link and title, the words shared, and the files that came with them: how many pictures, and
 *  each PDF's name. Their bytes are the save's file parts, the pictures' JPEGs then the PDFs (`Part`). */
data class ClipPage(val url: String, val title: String, val selection: String?, val pictures: Int, val pdfs: List<String>) {
    val files get() = pictures + pdfs.size

    /** The page as the clip routes take it; `look`: the first picture as JEV sees it, on the suggest step. */
    fun json(look: String? = null): JSONObject = JSONObject().put("url", url).put("title", title).apply {
        if (selection != null) put("selection", selection)
        if (pictures > 0) put("images", JSONArray((0 until pictures).map { i -> JSONObject().put("src", "").apply { if (i == 0 && look != null) put("look", look) } }))
        if (pdfs.isNotEmpty()) put("pdfs", JSONArray(pdfs.map { JSONObject().put("name", it) }))
    }
}

/** At most this many pictures and PDFs in one clip, and a PDF's size at most (clip.ts CLIP_FILES, photos.ts MAX_PDF). */
const val CLIP_FILES = 10
const val MAX_PDF = 25L * 1024 * 1024

/** What a clip's files are called in a line the owner reads (clip.ts `filesWord`); null for none. */
fun filesWord(page: ClipPage): String? {
    val i = page.pictures
    val p = page.pdfs.size
    return when {
        i > 0 && p > 0 -> "files"
        i > 0 -> if (i > 1) "pictures" else "picture"
        p > 0 -> if (p > 1) "PDFs" else "PDF"
        else -> null
    }
}

private val URL = Regex("""\bhttps?://[^\s<>]+""")
private val isUrl = Regex("""^https?://\S+$""")::matches

/** A sentence's trailing punctuation isn't the link's, nor a `)` it didn't open (links.ts `trimUrl`). */
private fun trimUrl(found: String): String {
    var u = found
    while (true) {
        u = when {
            u.isNotEmpty() && u.last() in ".,;:!?" -> u.dropLast(1)
            u.endsWith(")") && u.count { it == ')' } > u.count { it == '(' } -> u.dropLast(1)
            else -> return u
        }
    }
}

private fun firstUrl(text: String): String? = URL.find(text)?.value?.let(::trimUrl)

/** What another app shared, as a clip (companion.ts `shareClip`): the first link found is the page, the subject its
 *  title, the words the selection unless they say no more than the link and the title; the pictures and PDFs its files.
 *  null: nothing to clip. */
fun shareClip(text: String, subject: String, pictures: Int, pdfs: List<String>): ClipPage? {
    val title = subject.trim()
    val url = listOf(text, subject).firstNotNullOfOrNull { s -> s.trim().takeIf(isUrl) ?: firstUrl(s) }
    var words = text.trim()
    val rest = if (url != null) words.replaceFirst(url, "").trim() else words
    if (url != null && (rest.isEmpty() || rest == title)) words = ""
    if (words.isEmpty() && url == null && pictures == 0 && pdfs.isEmpty()) return null
    return ClipPage(url ?: "", if (isUrl(title)) "" else title, words.ifEmpty { null }, pictures, pdfs)
}

/** Where a clip goes. */
sealed interface Target {
    data object New : Target
    data object NewTask : Target
    data class Note(val path: String) : Target
    data class Task(val id: String) : Target

    fun json(): JSONObject = when (this) {
        New -> JSONObject().put("kind", "new")
        NewTask -> JSONObject().put("kind", "newtask")
        is Note -> JSONObject().put("kind", "note").put("path", path)
        is Task -> JSONObject().put("kind", "task").put("id", id)
    }

    /** Made by the save: what the lens on tags. */
    val makes get() = this == New || this == NewTask
}

fun targetOf(j: JSONObject?): Target? = when (j?.optString("kind")) {
    "new" -> Target.New
    "newtask" -> Target.NewTask
    "note" -> Target.Note(j.optString("path"))
    "task" -> Target.Task(j.optString("id"))
    else -> null
}

data class Suggestion(val target: Target, val title: String, val p: Double)

/** The suggest step's answer. `line`: the page's own line on what it is, sent back with the save. */
data class Suggestions(val suggestions: List<Suggestion>, val pick: Target, val line: String?) {
    companion object { val NONE = Suggestions(emptyList(), Target.New, null) }
}

fun suggestionsOf(j: JSONObject): Suggestions = Suggestions(
    j.optJSONArray("suggestions").list { s -> targetOf(s)?.let { Suggestion(it, s.optString("title"), s.optDouble("p", 0.0)) } }.filterNotNull(),
    targetOf(j.optJSONObject("pick")) ?: Target.New,
    j.optString("line").takeIf { it.isNotEmpty() },
)

/** One option offered to the owner. */
data class Choice(val target: Target, val label: String, val hint: String?)

/** The pick first, then the others best first, then a new note unless that is the pick, then a new task (clip.ts
 *  `choices`). `files`: what the clip's files are called (`filesWord`), null for none: an existing task keeps none of
 *  them, a new task keeps them in a note of its own. */
fun choices(s: Suggestions, files: String?): List<Choice> {
    val rest = s.suggestions.map { x ->
        val pct = percent(x.p)
        if (x.target is Target.Task) Choice(x.target, "Add to task ${x.title}", if (files != null) "$pct, no $files" else pct)
        else Choice(x.target, "Append to ${x.title}", pct)
    }
    val fresh = Choice(Target.New, "New note", null)
    val task = Choice(Target.NewTask, "New task", files?.let { "$it in a linked note" })
    val top = rest.find { it.target == s.pick }
    return if (top != null) listOf(top) + rest.filter { it !== top } + fresh + task else listOf(fresh) + rest + task
}

/** A defined tag and the chance the server gives that the clip belongs under it. */
data class ScoredTag(val name: String, val p: Double)

/** The clip/tags route's answer: every defined tag, best first, and the ones preselected. */
data class ClipTags(val tags: List<ScoredTag>, val picked: List<String>)

fun clipTagsOf(j: JSONObject): ClipTags {
    val picked = j.optJSONArray("picked")
    return ClipTags(
        j.optJSONArray("tags").list { ScoredTag(it.optString("name"), it.optDouble("p", 0.0)) }.filter { it.name.isNotEmpty() },
        if (picked == null) emptyList() else (0 until picked.length()).map { picked.optString(it) }.filter { it.isNotEmpty() },
    )
}

/** Offered beside the picked tags: one given at least this chance (clip.ts TAG_OFFER). */
private const val TAG_OFFER = 0.3

/** The tags not picked: `offered` the likely ones, to add with a tap; `more` every other by name, for a list. */
data class Unpicked(val offered: List<ScoredTag>, val more: List<String>)

fun unpickedTags(all: List<ScoredTag>, picked: List<String>): Unpicked {
    val rest = all.filter { it.name !in picked }
    return Unpicked(rest.filter { it.p >= TAG_OFFER }, rest.filter { it.p < TAG_OFFER }.map { it.name }.sortedWith(Collator.getInstance()))
}

/** The tags a save sends: the owner's picks, then what the lens on tags a new note or task with, each once, ignoring
 *  case (clip.ts `savedTags`). */
fun savedTags(picked: List<String>, made: List<String>): List<String> = (picked + made).distinctBy { it.lowercase() }

/** A chance as the owner reads it. */
fun percent(p: Double) = "${Math.round(p * 100)}%"

/** The suggest request's body. `note`: the owner's words, context for where it goes. */
fun suggestBody(page: ClipPage, note: String, look: String?): JSONObject =
    page.json(look).apply { if (note.isNotBlank()) put("note", note.trim()) }

/** The save request's `@jsonPayload`. `tags`: the owner's, carried by what the save makes. */
fun saveBody(page: ClipPage, line: String?, target: Target, note: String, summary: Boolean, tags: List<String>): JSONObject =
    page.json().put("target", target.json()).apply {
        if (line != null) put("line", line)
        if (note.isNotBlank()) put("note", note.trim())
        if (tags.isNotEmpty()) put("tags", JSONArray(tags))
        if (summary) put("summary", true)
    }

/** Whether a save sends the files' bytes: to a note, a new note or a new task, never to an existing task (clip.ts
 *  `sendsFiles`). */
fun sendsFiles(page: ClipPage, target: Target) = page.files > 0 && target !is Target.Task

/** The save's answer, as far as it is told. */
data class ClipResult(val task: Boolean, val created: Boolean, val summary: String?)

fun clipResultOf(j: JSONObject) = ClipResult(j.optString("kind") == "task", j.optString("action") == "created", j.optString("summary").takeIf { it.isNotEmpty() })

/** What was done, in a line (clip.ts `describe`). */
fun describe(r: ClipResult) = when {
    r.task -> if (r.created) "Created a new task" else "Added to a task"
    else -> if (r.created) "Created a new note" else "Appended to a note"
}

/** What the owner is told when a summary was asked for and not written (clip.ts `summaryNotice`). */
fun summaryNotice(r: ClipResult) = when (r.summary) {
    "skipped" -> "Saved without a summary: there was no text to write it from."
    "failed" -> "Saved without a summary: it couldn't be written."
    else -> null
}

// ---- a picture's sizes (photos.ts)

data class Size(val width: Int, val height: Int)

private const val STORED = 1600
private const val LOOK = 768
private const val LOOK_MIN = 280
private const val LOOK_MAX = 1568
const val STORED_QUALITY = 82
const val LOOK_QUALITY = 80

private fun scaled(width: Int, height: Int, k: Double) = Size(maxOf(1, Math.round(width * k).toInt()), maxOf(1, Math.round(height * k).toInt()))

/** The picture as it is stored: its long edge brought down to 1600, never enlarged (`fit`). */
fun storedSize(width: Int, height: Int): Size {
    val long = maxOf(width, height)
    return if (long <= STORED) Size(width, height) else scaled(width, height, STORED.toDouble() / long)
}

/** The picture JEV looks at: long edge 768, a small one made up to 280 on its short side (`lookSize`). */
fun lookSize(width: Int, height: Int): Size {
    val long = maxOf(width, height)
    val short = minOf(width, height)
    if (long <= 0 || short <= 0) return Size(LOOK, LOOK)
    var k = minOf(1.0, LOOK.toDouble() / long)
    if (short * k < LOOK_MIN) k = minOf(LOOK_MIN.toDouble() / short, LOOK_MAX.toDouble() / long)
    return scaled(width, height, k)
}

// ---- the server's address

/** What the owner typed as the server's origin: `https://host[:port]`, nothing after it. null when it is no https address
 *  (the web app needs https to install, so the server already has it). */
fun serverAddress(input: String): String? {
    val typed = input.trim()
    val m = Regex("""^(?:https://)?([A-Za-z0-9.-]+)(:\d{1,5})?(?:/.*)?$""").matchEntire(typed) ?: return null
    val host = m.groupValues[1].lowercase()
    return if (host.isEmpty() || host.startsWith(".") || host.endsWith(".")) null else "https://$host${m.groupValues[2]}"
}

// ---- the task lists

/** The lists a widget can show and a new task can go to (prefs.ts TASK_LISTS), named for the moments no feed has said it. */
val TASK_LISTS = listOf("today" to "Today", "inbox" to "Inbox", "upcoming" to "Upcoming")
fun listLabel(list: String) = TASK_LISTS.firstOrNull { it.first == list }?.second ?: "Today"
