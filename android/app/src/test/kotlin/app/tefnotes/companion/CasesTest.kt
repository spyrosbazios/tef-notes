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
        val clip = shareClip(i.getString("text"), i.getString("subject"), i.getBoolean("picture"))
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
    fun theChoices() = each("choices") { c ->
        val made = JSONArray()
        for (ch in choices(suggestionsOf(c.getJSONObject("suggestions")), c.getBoolean("picture")))
            made.put(JSONObject().put("target", ch.target.json()).put("label", ch.label).apply { if (ch.hint != null) put("hint", ch.hint) })
        same(c.getJSONArray("choices"), made, c.getString("name"))
    }

    @Test
    fun whatASaveSays() = each("results") { c ->
        val r = clipResultOf(c.getJSONObject("result"))
        assertEquals(c.getString("line"), describe(r))
        assertEquals(if (c.isNull("notice")) null else c.getString("notice"), summaryNotice(r))
    }
}
