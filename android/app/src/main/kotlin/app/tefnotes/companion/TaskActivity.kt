// A new task, from the quick-settings tile, the launcher's shortcut or a widget's plus: the web app's New task sheet cut
// down to a title and the list it goes to. With the server out of reach the task waits in the outbox (Outbox.kt) and is
// added when it can be.
package app.tefnotes.companion

import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class TaskActivity : ComponentActivity() {
    private val sheet = SheetControl()
    private val shake = Shake()
    private var title by mutableStateOf("")
    private var list by mutableStateOf("inbox")
    private var busy by mutableStateOf(false)
    /** What the server said when it refused the task; shown under the field, which shakes once. */
    private var refused by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (Store.server(this) == null) {
            OpenActivity.open(this, "/")
            return finish()
        }
        // Upcoming holds only dated tasks: one added from there goes to the Inbox.
        if (intent.getStringExtra(LIST) == "today") list = "today"
        setContent {
            val focus = remember { FocusRequester() }
            Sheet(Store.look(this), "New task", sheet, ::leave, footer = {
                TfButton(sheet::close, Modifier.weight(1f), ButtonKind.Ghost, round = true) { Text("Cancel") }
                TfButton(::add, Modifier.weight(1f), enabled = title.isNotBlank() && !busy, round = true) {
                    Swap(if (busy) "Adding…" else "Add to ${listLabel(list)}") { Text(it, maxLines = 1) }
                }
            }) {
                TfField(
                    title, { title = it; refused = null }, "What needs doing?", Modifier.focusRequester(focus), invalid = refused != null, shake = shake.x,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { add() }),
                )
                Unfolding(refused != null) { Text(refused ?: "", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((name, label) in TASK_LISTS.filter { it.first != "upcoming" }.reversed()) TagChip(label, list == name, { list = name })
                }
            }
            LaunchedEffect(Unit) { focus.requestFocus() }
        }
    }

    private fun add() {
        if (title.isBlank() || busy) return
        busy = true
        val id = newId()                                // the task's own, for every send of it: the outbox keeps it if this one is lost
        lifecycleScope.launch {
            val said = try {
                Api(Store.server(this@TaskActivity)!!).addTask(id, title.trim(), list)
                "Added to ${listLabel(list)}"
            } catch (e: Refused) {
                // A no for good: the sheet stays as it is, so nothing typed is lost.
                if (!e.again) return@launch no(e)
                later(id)
            } catch (_: Unreachable) {
                later(id)
            }
            Sync.now(this@TaskActivity)
            window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            Toast.makeText(this@TaskActivity, said, Toast.LENGTH_SHORT).show()
            sheet.close()
        }
    }

    private suspend fun later(id: String): String {
        withContext(Dispatchers.IO) { Outbox.addTask(this@TaskActivity, id, title.trim(), list) }
        return "Saved. It is added when the server is reachable"
    }

    private suspend fun no(e: Refused) {
        busy = false
        refused = e.message
        window.decorView.performHapticFeedback(HapticFeedbackConstants.REJECT)
        shake.go()
    }

    /** The sheet is off the screen: the window goes with no move of its own. */
    private fun leave() {
        overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        finish()
    }

    companion object { const val LIST = "list" }
}
