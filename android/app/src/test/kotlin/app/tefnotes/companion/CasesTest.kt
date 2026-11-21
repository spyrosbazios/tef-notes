// The rules this app copies from the core, run over the core's own cases: packages/core/test/companion-cases.json, the
// file packages/core/test/companion.test.ts runs. A case added there is checked here on the next test run.
package app.tefnotes.companion

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CasesTest {
    // Gradle runs a module's tests from the module's directory (android/app).
    private val cases = JSONObject(File("../../packages/core/test/companion-cases.json").readText())

    private fun each(group: String, check: (JSONObject) -> Unit) {
        val list = cases.getJSONArray(group)
        check(list.length() > 0) { "no $group cases" }
        for (i in 0 until list.length()) check(list.getJSONObject(i))
    }

    /** Compared as JSON values: key order aside. */
    private fun same(expected: Any?, actual: Any?, what: String) {
        fun norm(v: Any?): Any? = when (v) {
            null, JSONObject.NULL -> null
            is JSONObject -> v.keys().asSequence().sorted().associateWith { norm(v.get(it)) }
            is JSONArray -> (0 until v.length()).map { norm(v.get(it)) }
            else -> v
        }
        assertEquals(what, norm(expected), norm(actual))
    }

    @Test
    fun aShareAsAClip() = each("share") { c ->
        val i = c.getJSONObject("in")
        val clip = shareClip(i.getString("text"), i.getString("subject"), i.getInt("pictures"), i.getJSONArray("pdfs").strings())
        same(c.opt("clip"), clip?.json(), c.getString("name"))
    }

    @Test
    fun thePictureStored() = each("stored") { c ->
        val s = storedSize(c.getInt("width"), c.getInt("height"))
        same(c.getJSONObject("size"), JSONObject().put("width", s.width).put("height", s.height), "stored $c")
    }

    @Test
    fun thePictureJevLooksAt() = each("look") { c ->
        val s = lookSize(c.getInt("width"), c.getInt("height"))
        same(c.getJSONObject("size"), JSONObject().put("width", s.width).put("height", s.height), "look $c")
    }

    @Test
    fun whatAClipsFilesAreCalled() = each("files") { c ->
        val page = ClipPage("", "", null, c.getInt("pictures"), List(c.getInt("pdfs")) { "a.pdf" })
        assertEquals("files $c", if (c.isNull("word")) null else c.getString("word"), filesWord(page))
    }

    @Test
    fun theLimits() {
        val l = cases.getJSONObject("limits")
        assertEquals(l.getInt("files"), CLIP_FILES)
        assertEquals(l.getLong("pdf"), MAX_PDF)
    }

    @Test
    fun theChoices() = each("choices") { c ->
        val made = JSONArray()
        for (ch in choices(suggestionsOf(c.getJSONObject("suggestions")), if (c.isNull("files")) null else c.getString("files")))
            made.put(JSONObject().put("target", ch.target.json()).put("label", ch.label).apply { if (ch.hint != null) put("hint", ch.hint) })
        same(c.getJSONArray("choices"), made, c.getString("name"))
    }

    private fun JSONArray.strings() = (0 until length()).map { getString(it) }
    private fun JSONArray.scored() = (0 until length()).map { getJSONObject(it).let { t -> ScoredTag(t.getString("name"), t.getDouble("p")) } }

    @Test
    fun theTagsNotPicked() = each("tags") { c ->
        val u = unpickedTags(c.getJSONArray("all").scored(), c.getJSONArray("picked").strings())
        assertEquals(c.getString("name"), c.getJSONArray("offered").scored(), u.offered)
        assertEquals(c.getString("name"), c.getJSONArray("more").strings(), u.more)
    }

    @Test
    fun theTagsASaveSends() = each("saved") { c ->
        assertEquals(c.getJSONArray("tags").strings(), savedTags(c.getJSONArray("picked").strings(), c.getJSONArray("made").strings()))
    }

    @Test
    fun theContractIsTheServers() = assertEquals(cases.getInt("contract"), CONTRACT)

    @Test
    fun theTaskListsAndTheirNames() {
        val l = cases.getJSONArray("taskLists")
        assertEquals((0 until l.length()).map { l.getJSONArray(it).let { p -> p.getString(0) to p.getString(1) } }, TASK_LISTS)
    }

    @Test
    fun theJpegQualities() {
        val q = cases.getJSONObject("jpeg")
        assertEquals(q.getInt("stored"), STORED_QUALITY)
        assertEquals(q.getInt("look"), LOOK_QUALITY)
    }

    @Test
    fun theServersAddressAsTyped() = each("addresses") { c ->
        assertEquals(c.getString("input"), if (c.isNull("origin")) null else c.getString("origin"), serverAddress(c.getString("input")))
    }

    @Test
    fun aTickedTaskLeavesTheFeedAsTheServerWouldSendIt() = each("withoutTask") { c ->
        same(c.getJSONObject("after"), JSONObject(withoutTask(c.getJSONObject("feed").toString(), c.getString("tick"))), c.getString("name"))
    }

    @Test
    fun whatASaveSays() = each("results") { c ->
        val r = clipResultOf(c.getJSONObject("result"))
        assertEquals(c.getString("line"), describe(r))
        assertEquals(if (c.isNull("notice")) null else c.getString("notice"), summaryNotice(r))
    }
}
