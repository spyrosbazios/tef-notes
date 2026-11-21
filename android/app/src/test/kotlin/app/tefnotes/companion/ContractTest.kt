// The server's answers as the app reads them: defensively, so a wrong or older answer draws nothing rather than garbage.
package app.tefnotes.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractTest {
    private val look = """{"scheme":"light","bg":"#ffffff","card":"#f4f4f5","raised":"#e4e4e7","line":"#d4d4d8","fg":"#18181b","dim":"#52525b","faint":"#a1a1aa","brand":"#6d28d9","up":"#15803d","down":"#b91c1c","warn":"#b45309","muted":"#18181b12","soft":"#6d28d91a","scrim":"#0000008c"}"""

    @Test
    fun aLookNeedsEveryColour() {
        val l = lookOf(JSONObject(look))!!
        assertEquals(false, l.dark)
        assertEquals(0xFFFFFFFF.toInt(), l.bg)
        assertEquals(0xFF6D28D9.toInt(), l.brand)
        assertEquals(0x1A6D28D9, l.soft)
        assertEquals(0x8C000000.toInt(), l.scrim)
        assertNull(lookOf(JSONObject(look).apply { remove("scrim") }))
        assertNull(lookOf(JSONObject(look).put("brand", "violet")))
        assertNull(lookOf(JSONObject(look).apply { remove("line") }))
        assertNull(colorOf("#fff"))
    }

    @Test
    fun helloIsOnlyATefNotesServers() {
        val h = helloOf(JSONObject("""{"app":"tefnotes","contract":4,"look":$look,"summary":true}"""))!!
        assertEquals(Hello(4, JSONObject(look).toString(), true), h)
        assertNull(helloOf(JSONObject("""{"app":"other","look":$look}""")))
        assertNull(helloOf(JSONObject("""{"message":"Not found"}""")))
    }

    private val feed = """{"contract":4,"list":"today","title":"Today · Work","url":"/today","more":2,"look":$look,"sections":[
        {"label":"","tasks":[{"id":"a","title":"A","detail":"09:30","late":false,"url":"/today?t=a"},{"id":"b","title":"B","detail":"Due Nov 12","late":true,"url":"/today?t=b"}]},
        {"label":"This Evening","tasks":[{"id":"c","title":"C","detail":"","late":false,"url":"/today?t=c"}]}]}"""

    @Test
    fun aTasksFeed() {
        val f = tasksFeedOf(feed)!!
        assertEquals("Today · Work", f.title)
        assertEquals(listOf("", "This Evening"), f.sections.map { it.label })
        assertEquals(FeedTask("b", "B", "Due Nov 12", true, "/today?t=b"), f.sections[0].tasks[1])
        assertEquals(2, f.more)
        assertTrue(f.look != null)
    }

    @Test
    fun aFeedsSwitches() {
        val lenses = """[{"id":"","name":"No lens","on":false},{"id":"w","name":"Work","on":true}]"""
        val f = tasksFeedOf(feed.replace("\"more\":2", "\"more\":2,\"ask\":\"/?ask=1\",\"lenses\":$lenses"))!!
        assertEquals(Switches(listOf(LensChoice("", "No lens", false), LensChoice("w", "Work", true)), "/?ask=1"), f.switches)
        assertEquals(f.switches.lenses, lensChoicesOf(lensesJson(f.switches.lenses)))
        assertEquals(Switches(emptyList(), ""), tasksFeedOf(feed)!!.switches)
        assertEquals(emptyList<LensChoice>(), lensChoicesOf("no list"))
        assertEquals(emptyList<LensChoice>(), lensChoicesOf(null))
    }

    @Test
    fun aFeedOfAnotherContractOrNoFeedIsNotDrawn() {
        assertNull(tasksFeedOf(feed.replace("\"contract\":4", "\"contract\":5")))
        assertNull(tasksFeedOf("<html>"))
        assertNull(tasksFeedOf(null))
        assertNull(notesFeedOf("{}"))
    }

    @Test
    fun aFeedOfAnotherContractIsNamedSoAWidgetDoesNotSayLoadingForever() {
        val newer = feed.replace("\"contract\":4", "\"contract\":5")
        val older = feed.replace("\"contract\":4", "\"contract\":2")
        assertEquals(mismatchMessage(5), feedMismatch(newer))
        assertEquals(mismatchMessage(2), feedMismatch(older))
        assertEquals("That server and this app are of different versions: update the app.", mismatchMessage(CONTRACT + 1))
        assertEquals("That server and this app are of different versions: update the server.", mismatchMessage(CONTRACT - 1))
        assertNull(feedMismatch(feed))
        for (none in listOf(null, "<html>", "{}", "")) assertNull(feedMismatch(none))
    }

    @Test
    fun aTickedTaskLeavesTheFeedAndAnEmptySectionWithIt() {
        val f = tasksFeedOf(withoutTask(feed, "c"))!!
        assertEquals(listOf(""), f.sections.map { it.label })
        assertEquals(listOf("a"), tasksFeedOf(withoutTask(withoutTask(feed, "b"), "c"))!!.sections.flatMap { s -> s.tasks.map { it.id } })
        assertEquals("not a feed", withoutTask("not a feed", "a"))
    }

    @Test
    fun aNotesFeed() {
        val f = notesFeedOf("""{"contract":4,"title":"Notes","url":"/notes","more":0,"look":$look,"notes":[
            {"id":"a","title":"A","peek":"words","pinned":true,"url":"/note/a","color":{"bg":"#172331","fg":"#d2e2f3","line":"#6a92bd"}},
            {"id":"b","title":"B","peek":"","pinned":false,"url":"/note/b"}]}""")!!
        assertEquals(FeedNote("a", "A", "words", true, "/note/a", 0xFF172331.toInt(), 0xFFD2E2F3.toInt()), f.notes[0])
        assertEquals(FeedNote("b", "B", "", false, "/note/b", null, null), f.notes[1])
    }

    @Test
    fun theRequestsAClipSends() {
        val page = ClipPage("https://example.com", "Example", "a quote", 2, listOf("a.pdf"))
        assertEquals(
            JSONObject("""{"url":"https://example.com","title":"Example","selection":"a quote","images":[{"src":"","look":"QUJD"},{"src":""}],"pdfs":[{"name":"a.pdf"}],"note":"mine"}""").toString(),
            suggestBody(page, " mine ", "QUJD").toString(),
        )
        assertEquals(
            JSONObject("""{"url":"https://example.com","title":"Example","selection":"a quote","images":[{"src":""},{"src":""}],"pdfs":[{"name":"a.pdf"}],"id":"abcdefghij01234","target":{"kind":"new"},"line":"the line","tags":["work"],"summary":true}""").toString(),
            saveBody("abcdefghij01234", page, "the line", Target.New, "", true, listOf("work")).toString(),
        )
        assertEquals(true, sendsFiles(page, Target.NewTask))
        assertEquals(false, sendsFiles(page, Target.Task("t")))
        assertEquals(false, sendsFiles(page.copy(pictures = 0, pdfs = emptyList()), Target.New))
        assertEquals(true, sendsFiles(page.copy(pictures = 0), Target.New))
    }

    @Test
    fun anIdIsARecordIdsShapeAndANewOneEveryTime() {
        val ids = List(50) { newId() }.toSet()
        assertEquals(50, ids.size)
        for (id in ids) assertTrue(id, Regex("^[a-z0-9]{15}$").matches(id))
    }

    @Test
    fun theTagsRoutesAnswer() {
        val t = clipTagsOf(JSONObject("""{"tags":[{"name":"work","p":0.91},{"name":"home","p":0},{"p":0.5}],"picked":["work"]}"""))
        assertEquals(ClipTags(listOf(ScoredTag("work", 0.91), ScoredTag("home", 0.0)), listOf("work")), t)
        assertEquals(ClipTags(emptyList(), emptyList()), clipTagsOf(JSONObject("{}")))
        assertEquals("91%", percent(0.91))
    }
}
