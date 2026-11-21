// The server, as this app reaches it: its address (the one thing the owner sets here), the last look it answered with,
// and the requests. There is no key and no sign-in, as for every client: the private network the server sits on is the
// gate, so the phone must be on it (SECURITY.md). Only https is spoken.
package app.tefnotes.companion

import android.content.Context
import androidx.core.content.edit
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

/** Nothing answered, or what answered was not the server (a sign-in page of some network, a proxy with nothing behind
 *  it): worth trying again later. */
class Unreachable(cause: Throwable? = null) : Exception("The server can't be reached", cause)

/** The server answered no. `again`: it may say yes later (it is restarting, or busy). */
class Refused(val status: Int, message: String) : Exception(message) {
    val again get() = status >= 500 || status == 408 || status == 429
}

/** What the app keeps: the server's address, the look and choices of the owner's it last answered with, and the ticks
 *  made on a widget that the server doesn't have yet. */
object Store {
    private fun prefs(context: Context) = context.getSharedPreferences("tefnotes", Context.MODE_PRIVATE)

    fun server(context: Context): String? = prefs(context).getString("server", null)

    fun setServer(context: Context, origin: String, hello: Hello) {
        prefs(context).edit { putString("server", origin) }
        keep(context, hello)
    }

    fun keep(context: Context, hello: Hello) =
        prefs(context).edit { putString("look", hello.look).putBoolean("summary", hello.summary) }

    /** The owner's look as last answered; before any answer, the default theme (generated from the core's). */
    fun look(context: Context): Look = prefs(context).getString("look", null)?.let { lookOf(JSONObject(it)) } ?: Look(
        dark = context.resources.getBoolean(R.bool.tf_dark),
        bg = context.getColor(R.color.tf_bg), card = context.getColor(R.color.tf_card), raised = context.getColor(R.color.tf_raised),
        line = context.getColor(R.color.tf_line), fg = context.getColor(R.color.tf_fg), dim = context.getColor(R.color.tf_dim),
        faint = context.getColor(R.color.tf_faint), brand = context.getColor(R.color.tf_brand), up = context.getColor(R.color.tf_up),
        down = context.getColor(R.color.tf_down), warn = context.getColor(R.color.tf_warn), muted = context.getColor(R.color.tf_muted),
        soft = context.getColor(R.color.tf_soft), scrim = context.getColor(R.color.tf_scrim),
    )

    /** "Add a summary", as the owner last left it in the app. */
    fun summary(context: Context) = prefs(context).getBoolean("summary", false)

    // A widget's tick and the sync both change the set: one at a time, so neither undoes the other's.
    @Synchronized fun ticks(context: Context): Set<String> = prefs(context).getStringSet("ticks", emptySet())!!.toSet()
    @Synchronized fun addTick(context: Context, id: String) = prefs(context).edit { putStringSet("ticks", ticks(context) + id) }
    @Synchronized fun dropTick(context: Context, id: String) = prefs(context).edit { putStringSet("ticks", ticks(context) - id) }
}

/** A file a save sends as a `file` part: where its bytes are, and its type (a picture's JPEG, or a PDF as shared). */
class Part(val file: File, val type: String) {
    val ext get() = if (type == PDF_TYPE) "pdf" else "jpg"

    companion object {
        const val JPEG_TYPE = "image/jpeg"
        const val PDF_TYPE = "application/pdf"
    }
}

class Api(private val origin: String) {
    suspend fun hello(): Hello = helloOf(json("GET", "/agent/companion/hello")) ?: throw Unreachable()

    /** A task list's feed, as its JSON (a widget keeps it as it came). */
    suspend fun tasks(list: String): String = text("GET", "/agent/companion/tasks?list=${URLEncoder.encode(list, "UTF-8")}")
    suspend fun notes(): String = text("GET", "/agent/companion/notes")

    suspend fun addTask(title: String, list: String) {
        json("POST", "/agent/companion/tasks", JSONObject().put("title", title).put("list", list))
    }

    /** The lens `id` on for every screen of the owner's; "" for none. */
    suspend fun setLens(id: String) {
        json("POST", "/agent/companion/lens", JSONObject().put("lens", id))
    }

    suspend fun tick(id: String) {
        json("POST", "/agent/companion/tasks/${URLEncoder.encode(id, "UTF-8")}/done")
    }

    suspend fun suggest(body: JSONObject): Suggestions = suggestionsOf(json("POST", "/api/tefnotes/clip/suggest", body))

    /** Every defined tag scored for the clip (the suggest step's body; the picture is not looked at). */
    suspend fun tags(body: JSONObject): ClipTags = clipTagsOf(json("POST", "/api/tefnotes/clip/tags", body))

    /** The save: the payload as the form's `@jsonPayload`, then each file as a `file` part, in the payload's order. The
     *  files are streamed from disk: a few PDFs are more than the app should hold in memory. */
    suspend fun save(payload: JSONObject, parts: List<Part>): ClipResult {
        val boundary = "tefnotes-${UUID.randomUUID()}"
        val heads = listOf("Content-Disposition: form-data; name=\"@jsonPayload\"" to payload.toString().toByteArray()) +
            parts.mapIndexed { i, p -> "Content-Disposition: form-data; name=\"file\"; filename=\"file-${i + 1}.${p.ext}\"\r\nContent-Type: ${p.type}" to null }
        fun open(head: String) = "--$boundary\r\n$head\r\n\r\n".toByteArray()
        val close = "\r\n".toByteArray()
        val end = "--$boundary--\r\n".toByteArray()
        val size = heads.sumOf { (head, _) -> open(head).size.toLong() + close.size } + (heads[0].second?.size ?: 0) +
            parts.sumOf { it.file.length() } + end.size
        val body = Body("multipart/form-data; boundary=$boundary", size) { out ->
            heads.forEachIndexed { i, (head, bytes) ->
                out.write(open(head))
                if (bytes != null) out.write(bytes) else parts[i - 1].file.inputStream().use { it.copyTo(out) }
                out.write(close)
            }
            out.write(end)
        }
        return clipResultOf(read(request("POST", "/api/tefnotes/clip", body)))
    }

    private suspend fun json(method: String, path: String, body: JSONObject? = null): JSONObject = read(text(method, path, body))

    private suspend fun text(method: String, path: String, body: JSONObject? = null): String =
        request(method, path, body?.toString()?.toByteArray()?.let { bytes -> Body("application/json", bytes.size.toLong()) { it.write(bytes) } })

    /** An answer that is not JSON did not come from the server. */
    private fun read(answer: String): JSONObject = try { JSONObject(answer) } catch (e: JSONException) { throw Unreachable(e) }

    /** A request's body: its type, its length in bytes, and how it is written. */
    private class Body(val type: String, val size: Long, val write: (OutputStream) -> Unit)

    private suspend fun request(method: String, path: String, body: Body?): String = withContext(Dispatchers.IO) {
        val c = try { URL(origin + path).openConnection() as HttpURLConnection } catch (e: IOException) { throw Unreachable(e) }
        try {
            c.requestMethod = method
            c.connectTimeout = CONNECT_MS
            c.readTimeout = READ_MS
            c.setRequestProperty("Accept", "application/json")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", body.type)
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { body.write(it) }
            }
            val status = c.responseCode
            val answer = (if (status < 400) c.inputStream else c.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            if (status >= 400) throw Refused(status, said(answer) ?: "The server answered $status")
            answer
        } catch (e: IOException) {
            throw Unreachable(e)
        } finally {
            c.disconnect()
        }
    }

    /** What a refusal says: the app's routes answer `{error}`, PocketBase's own `{message}`. */
    private fun said(answer: String): String? = try {
        JSONObject(answer).let { j -> j.optString("error").ifEmpty { j.optString("message") }.ifEmpty { null } }
    } catch (_: JSONException) { null }

    private companion object {
        const val CONNECT_MS = 8_000
        // The suggest step asks a model and a save may tidy a note or write a summary with one.
        const val READ_MS = 90_000
    }
}
