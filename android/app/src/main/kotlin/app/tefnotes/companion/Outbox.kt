// What was saved with the server out of reach (the phone off its network): a clip or a new task, kept as a file each
// until the sync (Sync.kt) can send it. A clip waits as its whole save request, so it is sent as it would have been: its
// payload in the entry, its files (pictures' JPEGs, PDFs) copied beside it, named after it.
// One the server refuses for good stays, marked with why, until the owner discards it in Settings: nothing the owner
// saved is dropped silently. A send whose answer was lost is sent again, so every entry carries an id of its own (a clip in
// its payload, a task beside its title), made before the first send was tried and kept with the entry: the server records
// what it did under that id and answers the second send as the first, so nothing lands twice and nothing is lost.
// A crash leaves loose ends (a draft `.json.part` that was never renamed, files copied for an entry that was never written):
// `sweep` removes them.
package app.tefnotes.companion

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

object Outbox {
    class Waiting(val file: File, val what: String, val refused: String?)

    private fun dir(context: Context) = File(context.filesDir, "outbox").apply { mkdirs() }
    private fun entries(context: Context): List<File> = dir(context).listFiles { f -> f.extension == "json" }?.sortedBy { it.lastModified() } ?: emptyList()
    /** The files kept beside an entry: every one named after it. */
    private fun beside(entry: File): List<File> {
        val stem = entry.nameWithoutExtension
        return entry.parentFile?.listFiles { f -> f != entry && (f.name.startsWith("$stem-") || f.name.startsWith("$stem.")) }?.toList() ?: emptyList()
    }

    /** The entry's file written whole or not at all: under another name first, then renamed. */
    private fun write(file: File, entry: JSONObject) {
        val draft = File(file.parentFile, "${file.name}.part")
        draft.writeText(entry.toString())
        if (!draft.renameTo(file)) throw IOException("${file.name} could not be written")
    }

    private fun add(context: Context, entry: JSONObject, parts: List<Part> = emptyList()) {
        val file = File(dir(context), "${System.currentTimeMillis()}-${UUID.randomUUID()}.json")
        val kept = JSONArray()
        parts.forEachIndexed { i, p ->
            val copy = File(file.parentFile, "${file.nameWithoutExtension}-${i + 1}.${p.ext}")
            p.file.copyTo(copy, overwrite = true)
            kept.put(JSONObject().put("file", copy.name).put("type", p.type))
        }
        write(file, if (parts.isEmpty()) entry else entry.put("parts", kept))      // the entry last: it is what makes it wait
    }

    /** An entry's files, as the save sends them; null when one is gone. */
    private fun partsOf(file: File, entry: JSONObject): List<Part>? {
        val kept = entry.optJSONArray("parts") ?: return emptyList()
        return (0 until kept.length()).map { i ->
            val p = kept.optJSONObject(i) ?: return null
            Part(File(file.parentFile, p.optString("file")).takeIf { p.optString("file").isNotEmpty() && it.isFile } ?: return null, p.optString("type"))
        }
    }

    private fun read(file: File): JSONObject? = try { JSONObject(file.readText()) } catch (_: JSONException) { null } catch (_: IOException) { null }

    /** A clip waits as the request it would have been: `payload` carries the save's `id` (saveBody), the one the first,
     *  direct send used. */
    fun addClip(context: Context, payload: JSONObject, parts: List<Part>, what: String) =
        add(context, JSONObject().put("kind", "clip").put("what", what).put("payload", payload), parts)

    /** A task waits under the `id` its direct send used (newId), so the server makes it once if that send had landed. */
    fun addTask(context: Context, id: String, title: String, list: String) =
        add(context, JSONObject().put("kind", "task").put("what", title).put("id", id).put("title", title).put("list", list))

    fun list(context: Context): List<Waiting> = entries(context).map { f ->
        read(f)?.let { Waiting(f, it.optString("what"), it.optString("refused").ifEmpty { null }) } ?: Waiting(f, "Something saved", UNREADABLE)
    }

    fun discard(entry: Waiting) = gone(entry.file)

    private fun gone(file: File) {
        beside(file).forEach { it.delete() }
        file.delete()
    }

    /** Removes what a crash left: a draft entry (`*.json.part`) and files copied for an entry that was never written.
     *  Only what is older than `GRACE_MS`: an entry being written right now has both for a moment. */
    fun sweep(context: Context, now: Long = System.currentTimeMillis()) {
        val all = dir(context).listFiles() ?: return
        val stale = { f: File -> now - f.lastModified() > GRACE_MS }
        val written = all.filter { it.extension == "json" }.map { it.nameWithoutExtension }.toSet()
        for (f in all) {
            val orphan = when {
                f.name.endsWith(".json.part") -> true
                f.extension == "json" -> false
                else -> PART_NAME.matchEntire(f.name)?.groupValues?.get(1)?.let { it !in written } ?: false
            }
            if (orphan && stale(f)) f.delete()
        }
    }

    /** The id an entry is sent under: the one it was made with; one with none (an entry the app wrote before entries
     *  carried one) is given one now, and kept in the entry before the first send is tried, so every later send has it. */
    private fun withId(file: File, entry: JSONObject, payload: JSONObject?): String {
        val holder = payload ?: entry
        holder.optString("id").takeIf { it.isNotEmpty() }?.let { return it }
        val id = newId()
        holder.put("id", id)
        write(file, entry)
        return id
    }

    /** Sends what waits, oldest first. Throws Unreachable (or a Refused worth trying again) at the first one that can't go
     *  now, leaving it and the rest; one refused for good is marked and passed over. */
    suspend fun send(context: Context, api: Api) {
        sweep(context)
        for (file in entries(context)) {
            val entry = read(file) ?: continue          // shown in Settings as unreadable, for the owner to discard
            if (entry.has("refused")) continue
            val payload = entry.optJSONObject("payload")
            try {
                when {
                    entry.optString("kind") == "task" -> api.addTask(withId(file, entry, null), entry.optString("title"), entry.optString("list"))
                    payload != null -> { withId(file, entry, payload); api.save(payload, partsOf(file, entry) ?: throw Refused(400, "a file of it is gone")) }
                    else -> throw Refused(400, UNREADABLE)
                }
                gone(file)
            } catch (e: Refused) {
                if (e.again) throw e
                write(file, entry.put("refused", e.message))
            }
        }
    }

    private const val UNREADABLE = "it can't be read back"
    /** A copied file's name: `<entry's stem>-<n>.<ext>`. */
    private val PART_NAME = Regex("^(.+)-\\d+\\.(?:jpg|pdf)$")
    private const val GRACE_MS = 60_000L
}
