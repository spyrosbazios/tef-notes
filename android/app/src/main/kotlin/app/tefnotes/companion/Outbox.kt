// What was saved with the server out of reach (the phone off its network): a clip or a new task, kept as a file each
// until the sync (Sync.kt) can send it. A clip waits as its whole save request, so it is sent as it would have been.
// One the server refuses for good stays, marked with why, until the owner discards it in Settings: nothing the owner
// saved is dropped silently. A send whose answer was lost is sent again, so a clip can land twice; the other way round
// would lose it.
package app.tefnotes.companion

import android.content.Context
import java.io.File
import java.io.IOException
import java.util.UUID
import org.json.JSONException
import org.json.JSONObject

object Outbox {
    class Waiting(val file: File, val what: String, val refused: String?)

    private fun dir(context: Context) = File(context.filesDir, "outbox").apply { mkdirs() }
    private fun entries(context: Context): List<File> = dir(context).listFiles { f -> f.extension == "json" }?.sortedBy { it.lastModified() } ?: emptyList()
    private fun picture(entry: File) = File(entry.parentFile, "${entry.nameWithoutExtension}.jpg")

    /** The entry's file written whole or not at all: under another name first, then renamed. */
    private fun write(file: File, entry: JSONObject) {
        val draft = File(file.parentFile, "${file.name}.part")
        draft.writeText(entry.toString())
        if (!draft.renameTo(file)) throw IOException("${file.name} could not be written")
    }

    private fun add(context: Context, entry: JSONObject, jpeg: ByteArray? = null) {
        val file = File(dir(context), "${System.currentTimeMillis()}-${UUID.randomUUID()}.json")
        if (jpeg != null) picture(file).writeBytes(jpeg)
        write(file, entry)
    }

    private fun read(file: File): JSONObject? = try { JSONObject(file.readText()) } catch (_: JSONException) { null } catch (_: IOException) { null }

    fun addClip(context: Context, payload: JSONObject, jpeg: ByteArray?, what: String) =
        add(context, JSONObject().put("kind", "clip").put("what", what).put("payload", payload), jpeg)

    fun addTask(context: Context, title: String, list: String) =
        add(context, JSONObject().put("kind", "task").put("what", title).put("title", title).put("list", list))

    fun list(context: Context): List<Waiting> = entries(context).map { f ->
        read(f)?.let { Waiting(f, it.optString("what"), it.optString("refused").ifEmpty { null }) } ?: Waiting(f, "Something saved", UNREADABLE)
    }

    fun discard(entry: Waiting) {
        picture(entry.file).delete()
        entry.file.delete()
    }

    /** Sends what waits, oldest first. Throws Unreachable (or a Refused worth trying again) at the first one that can't go
     *  now, leaving it and the rest; one refused for good is marked and passed over. */
    suspend fun send(context: Context, api: Api) {
        for (file in entries(context)) {
            val entry = read(file) ?: continue          // shown in Settings as unreadable, for the owner to discard
            if (entry.has("refused")) continue
            val payload = entry.optJSONObject("payload")
            try {
                when {
                    entry.optString("kind") == "task" -> api.addTask(entry.optString("title"), entry.optString("list"))
                    payload != null -> api.save(payload, picture(file).takeIf { it.exists() }?.readBytes())
                    else -> throw Refused(400, UNREADABLE)
                }
                picture(file).delete()
                file.delete()
            } catch (e: Refused) {
                if (e.again) throw e
                write(file, entry.put("refused", e.message))
            }
        }
    }

    private const val UNREADABLE = "it can't be read back"
}
