// What waits while the server is out of reach: kept as files, sent oldest first as the request it would have been, and
// never dropped for being refused. Run against a real server on the loopback (Fakes.kt), so the bytes sent are the app's.
package app.tefnotes.companion

import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class OutboxTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var context: FakeContext
    private val server = FakeServer()

    @Before fun phone() { context = FakeContext(tmp.newFolder("files")) }
    @After fun close() = server.close()

    private val outbox get() = File(context.filesDir, "outbox")
    private fun left() = outbox.list()!!.sorted()
    private fun send() = runBlocking { Outbox.send(context, server.api) }
    private fun titles() = server.seen.map { JSONObject(it.text).getString("title") }
    private fun file(name: String, vararg bytes: Int) = tmp.newFile(name).apply { writeBytes(ByteArray(bytes.size) { bytes[it].toByte() }) }

    @Test
    fun aTaskWaitsThenIsSentOnceAndLeavesNothingBehind() {
        Outbox.addTask(context, "Buy milk", "inbox")
        assertEquals(listOf("Buy milk" to null), Outbox.list(context).map { it.what to it.refused })

        send()

        val request = server.seen.single()
        assertEquals("POST", request.method)
        assertEquals("/agent/companion/tasks", request.path)
        assertEquals("application/json", request.type)
        val sent = JSONObject(request.text)
        assertEquals("Buy milk", sent.getString("title"))
        assertEquals("inbox", sent.getString("list"))
        assertTrue(Outbox.list(context).isEmpty())
        assertEquals(emptyList<String>(), left())
        send()
        assertEquals(1, server.seen.size)
    }

    @Test
    fun aClipWaitsWithItsFilesBesideItAndIsSentAsTheSaveWouldHaveBeen() {
        val jpeg = file("shot.jpg", 1, 2, 3)
        val pdf = file("paper.pdf", 4, 5)
        Outbox.addClip(context, JSONObject().put("url", "https://example.com/a").put("title", "Example"), listOf(Part(jpeg, Part.JPEG_TYPE), Part(pdf, Part.PDF_TYPE)), "Example")

        val names = left()
        val entry = names.single { it.endsWith(".json") }
        val stem = entry.removeSuffix(".json")
        assertEquals(listOf(entry, "$stem-1.jpg", "$stem-2.pdf").sorted(), names)
        assertTrue("the shared files are copied, not moved", jpeg.isFile && pdf.isFile)
        assertEquals(listOf("Example" to null), Outbox.list(context).map { it.what to it.refused })

        server.answer = { 200 to """{"kind":"note","action":"created"}""" }
        send()

        val request = server.seen.single()
        assertEquals("/api/tefnotes/clip", request.path)
        assertTrue(request.type!!.startsWith("multipart/form-data; boundary="))
        val body = request.text
        val payload = body.indexOf("name=\"@jsonPayload\"")
        val first = body.indexOf("name=\"file\"; filename=\"file-1.jpg\"\r\nContent-Type: image/jpeg")
        val second = body.indexOf("name=\"file\"; filename=\"file-2.pdf\"\r\nContent-Type: application/pdf")
        assertTrue("payload, then the files in order: $payload $first $second", payload in 0 until first && first < second)
        assertTrue(body.contains("\"url\":\"https://example.com/a\""))
        assertTrue(body.contains("\r\n\r\n\u0001\u0002\u0003\r\n"))
        assertTrue(body.contains("\r\n\r\n\u0004\u0005\r\n"))
        assertEquals(emptyList<String>(), left())
    }

    @Test
    fun whatWaitsIsSentOldestFirst() {
        for (t in listOf("a", "b", "c")) Outbox.addTask(context, t, "inbox")
        val byTitle = Outbox.list(context).associateBy { it.what }
        byTitle.getValue("a").file.setLastModified(3_000)
        byTitle.getValue("b").file.setLastModified(1_000)
        byTitle.getValue("c").file.setLastModified(2_000)

        send()

        assertEquals(listOf("b", "c", "a"), titles())
    }

    @Test
    fun oneRefusedForGoodStaysMarkedWithWhyAndIsPassedOver() {
        server.answer = { if (JSONObject(it.text).getString("title") == "bad") 400 to """{"error":"No such list."}""" else 200 to "{}" }
        Outbox.addTask(context, "bad", "nowhere")
        Outbox.addTask(context, "good", "inbox")
        Outbox.list(context).single { it.what == "bad" }.file.setLastModified(1_000)
        Outbox.list(context).single { it.what == "good" }.file.setLastModified(2_000)

        send()

        assertEquals(listOf("bad", "good"), titles())
        assertEquals(listOf("bad" to "No such list."), Outbox.list(context).map { it.what to it.refused })

        send()
        assertEquals("a refused entry is not sent again", 2, server.seen.size)
    }

    @Test
    fun aRefusalWithoutAnErrorKeyIsWordedByItsStatus() {
        server.answer = { 404 to "<html>nothing here</html>" }
        Outbox.addTask(context, "t", "inbox")
        send()
        assertEquals("The server answered 404", Outbox.list(context).single().refused)
    }

    @Test
    fun discardingARefusedClipRemovesItsFilesToo() {
        server.answer = { 400 to """{"error":"Too many files."}""" }
        Outbox.addClip(context, JSONObject().put("title", "t"), listOf(Part(file("a.jpg", 1), Part.JPEG_TYPE)), "t")
        send()
        val refused = Outbox.list(context).single()
        assertEquals("Too many files.", refused.refused)
        assertEquals(2, left().size)

        Outbox.discard(refused)

        assertTrue(Outbox.list(context).isEmpty())
        assertEquals(emptyList<String>(), left())
    }

    @Test
    fun aRefusalThatMayChangeStopsTheRunAndMarksNothing() {
        var status = 503
        server.answer = { status to """{"error":"restarting"}""" }
        Outbox.addTask(context, "first", "inbox")
        Outbox.addTask(context, "second", "inbox")
        Outbox.list(context).single { it.what == "first" }.file.setLastModified(1_000)
        Outbox.list(context).single { it.what == "second" }.file.setLastModified(2_000)

        val refused = assertThrows(Refused::class.java) { send() }

        assertTrue(refused.again)
        assertEquals("the rest waits behind it", listOf("first"), titles())
        assertEquals(listOf("first" to null, "second" to null), Outbox.list(context).map { it.what to it.refused })

        status = 200
        send()
        assertEquals(listOf("first", "second"), titles().drop(1))
        assertTrue(Outbox.list(context).isEmpty())
    }

    @Test
    fun aServerOutOfReachLeavesEverythingWaiting() {
        Outbox.addTask(context, "t", "inbox")
        Outbox.addClip(context, JSONObject().put("title", "c"), emptyList(), "c")
        server.close()

        assertThrows(Unreachable::class.java) { send() }

        assertEquals(listOf("t" to null, "c" to null).sortedBy { it.first }, Outbox.list(context).map { it.what to it.refused }.sortedBy { it.first })
    }

    @Test
    fun aClipWhoseFileIsGoneIsRefusedAndNothingIsSent() {
        Outbox.addClip(context, JSONObject().put("title", "t"), listOf(Part(file("a.jpg", 1), Part.JPEG_TYPE)), "t")
        outbox.listFiles()!!.single { it.extension == "jpg" }.delete()

        send()

        assertEquals(emptyList<Seen>(), server.seen.toList())
        assertEquals("a file of it is gone", Outbox.list(context).single().refused)
    }

    @Test
    fun anEntryThatCannotBeReadIsShownAndPassedOverUntilItIsDiscarded() {
        outbox.mkdirs()
        File(outbox, "1-broken.json").writeText("not json")
        File(outbox, "2-empty.json").writeText("""{"kind":"clip","what":"Half an entry"}""")
        Outbox.addTask(context, "fine", "inbox")
        File(outbox, "1-broken.json").setLastModified(1_000)
        File(outbox, "2-empty.json").setLastModified(2_000)
        Outbox.list(context).single { it.what == "fine" }.file.setLastModified(3_000)

        send()

        assertEquals(listOf("fine"), titles())
        assertEquals(
            listOf("Something saved" to "it can't be read back", "Half an entry" to "it can't be read back"),
            Outbox.list(context).map { it.what to it.refused },
        )
        Outbox.list(context).forEach { Outbox.discard(it) }
        assertFalse(outbox.listFiles()!!.any { it.extension == "json" })
    }

    @Test
    fun anEntryIsWrittenWholeOrNotAtAll() {
        Outbox.addTask(context, "t", "inbox")
        server.answer = { 400 to """{"error":"no"}""" }
        send()
        assertEquals("no", Outbox.list(context).single().refused)
        assertTrue("no half-written draft is left beside it", left().none { it.endsWith(".part") })
    }
}
