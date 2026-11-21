// What a sync run sends (Sync.sendWaiting, the part of SyncWorker that needs no WorkManager): the widget's ticks, then the
// outbox; and whether it all went. A run that didn't send everything is the one the worker tries again.
package app.tefnotes.companion

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SyncTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var context: FakeContext
    private val server = FakeServer()

    @Before fun phone() { context = FakeContext(tmp.newFolder("files")) }
    @After fun close() = server.close()

    private fun run() = runBlocking { Sync.sendWaiting(context, server.api) }
    private fun paths() = server.seen.map { it.path }

    @Test
    fun withNothingWaitingItSendsNothingAndAllIsWell() {
        assertTrue(run())
        assertEquals(emptyList<String>(), paths())
    }

    @Test
    fun eachTickIsSentOnceAndForgottenWhenTheServerHasIt() {
        Store.addTick(context, "abc")
        Store.addTick(context, "def")

        assertTrue(run())

        assertEquals(setOf("/agent/companion/tasks/abc/done", "/agent/companion/tasks/def/done"), paths().toSet())
        assertEquals(2, server.seen.size)
        assertTrue(server.seen.all { it.method == "POST" })
        assertEquals(emptySet<String>(), Store.ticks(context))
        assertTrue(run())
        assertEquals("a tick is not sent again", 2, server.seen.size)
    }

    @Test
    fun ticksGoBeforeTheOutbox() {
        Outbox.addTask(context, newId(), "t", "inbox")
        Store.addTick(context, "abc")

        assertTrue(run())

        assertEquals(listOf("/agent/companion/tasks/abc/done", "/agent/companion/tasks"), paths())
        assertTrue(Outbox.list(context).isEmpty())
    }

    @Test
    fun aTickForATaskThatIsGoneIsDroppedAndTheRunGoesOn() {
        server.answer = { if (it.path.endsWith("/gone/done")) 404 to """{"error":"No such task."}""" else 200 to "{}" }
        Store.addTick(context, "gone")
        Outbox.addTask(context, newId(), "t", "inbox")

        assertTrue(run())

        assertEquals(emptySet<String>(), Store.ticks(context))
        assertTrue(Outbox.list(context).isEmpty())
        assertEquals(2, server.seen.size)
    }

    @Test
    fun aBusyServerStopsTheRunWithTheTickStillWaitingAndTheOutboxUntouched() {
        server.answer = { 503 to """{"error":"busy"}""" }
        Store.addTick(context, "abc")
        Outbox.addTask(context, newId(), "t", "inbox")

        assertFalse(run())

        assertEquals(setOf("abc"), Store.ticks(context))
        assertEquals(listOf("/agent/companion/tasks/abc/done"), paths())
        assertEquals(listOf("t" to null), Outbox.list(context).map { it.what to it.refused })
    }

    @Test
    fun aServerOutOfReachLeavesEverythingWaiting() {
        Store.addTick(context, "abc")
        Outbox.addTask(context, newId(), "t", "inbox")
        server.close()

        assertFalse(run())

        assertEquals(setOf("abc"), Store.ticks(context))
        assertEquals(listOf("t" to null), Outbox.list(context).map { it.what to it.refused })
    }

    @Test
    fun aBusyServerMidOutboxLeavesTheRestForTheNextRun() {
        Outbox.addTask(context, newId(), "first", "inbox")
        Outbox.addTask(context, newId(), "second", "inbox")
        Outbox.list(context).single { it.what == "first" }.file.setLastModified(1_000)
        Outbox.list(context).single { it.what == "second" }.file.setLastModified(2_000)
        server.answer = { if (JSONObject(it.text).getString("title") == "first") 200 to "{}" else 429 to """{"error":"slow down"}""" }

        assertFalse(run())

        assertEquals(listOf("second" to null), Outbox.list(context).map { it.what to it.refused })
        server.answer = { 200 to "{}" }
        assertTrue(run())
        assertTrue(Outbox.list(context).isEmpty())
    }

    @Test
    fun anEntryRefusedForGoodDoesNotMakeTheRunFailOrKeepRetrying() {
        server.answer = { 400 to """{"error":"No such list."}""" }
        Outbox.addTask(context, newId(), "t", "nowhere")

        assertTrue(run())

        assertEquals(listOf("t" to "No such list."), Outbox.list(context).map { it.what to it.refused })
    }
}
