// What the JVM tests stand on in place of a phone: a Context whose private files and preferences live in a temp folder
// and in memory, and a real HTTP server on the loopback that records what the app sends it. The app's own `Api` talks
// to the second one over a socket, so what Outbox and Sync send is checked as bytes on the wire.
package app.tefnotes.companion

import android.content.ContextWrapper
import android.content.SharedPreferences
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/** An app's private files (`filesDir`) and its preferences, with nothing of Android under them. */
class FakeContext(private val dir: File) : ContextWrapper(null) {
    private val prefs = HashMap<String, MemoryPrefs>()

    override fun getFilesDir(): File = dir

    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = prefs.getOrPut(name) { MemoryPrefs() }
}

/** SharedPreferences held in a map: a change is visible as soon as `apply` or `commit` runs, as it is to the next reader. */
class MemoryPrefs : SharedPreferences {
    private val values = HashMap<String, Any>()

    override fun getAll(): MutableMap<String, *> = HashMap(values)
    override fun getString(key: String, defValue: String?): String? = values[key] as String? ?: defValue
    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = (values[key] as Set<String>?)?.toMutableSet() ?: defValues
    override fun getInt(key: String, defValue: Int): Int = values[key] as Int? ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as Long? ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as Float? ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as Boolean? ?: defValue
    override fun contains(key: String): Boolean = values.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}

    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val pending = HashMap<String, Any?>()
        private var cleared = false

        private fun put(key: String, value: Any?) = apply { pending[key] = value }
        override fun putString(key: String, value: String?) = put(key, value)
        override fun putStringSet(key: String, values: MutableSet<String>?) = put(key, values?.toSet())
        override fun putInt(key: String, value: Int) = put(key, value)
        override fun putLong(key: String, value: Long) = put(key, value)
        override fun putFloat(key: String, value: Float) = put(key, value)
        override fun putBoolean(key: String, value: Boolean) = put(key, value)
        override fun remove(key: String) = put(key, null)
        override fun clear() = apply { cleared = true }
        override fun commit(): Boolean { apply(); return true }
        override fun apply() {
            if (cleared) values.clear()
            for ((k, v) in pending) if (v == null) values.remove(k) else values[k] = v
        }
    }
}

/** What the server was asked, and what it said. */
class Seen(val method: String, val path: String, val type: String?, val body: ByteArray) {
    val text get() = body.toString(Charsets.ISO_8859_1)
}

/** A server on the loopback port the app's `Api` is pointed at. It records every request and answers each with `answer`
 *  (a status and a JSON body); closed, its port refuses connections, as a server out of reach does. */
class FakeServer(var answer: (Seen) -> Pair<Int, String> = { 200 to "{}" }) : AutoCloseable {
    val seen = CopyOnWriteArrayList<Seen>()

    private val http = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
        createContext("/") { ex ->
            val request = Seen(ex.requestMethod, ex.requestURI.rawPath, ex.requestHeaders.getFirst("Content-Type"), ex.requestBody.readBytes())
            seen += request
            val (status, body) = answer(request)
            val bytes = body.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        start()
    }

    val api = Api("http://127.0.0.1:${http.address.port}")

    private var closed = false

    override fun close() {
        if (!closed) http.stop(0)
        closed = true
    }
}
