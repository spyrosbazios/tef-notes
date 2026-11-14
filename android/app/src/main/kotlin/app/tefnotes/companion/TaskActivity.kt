// A new task, from the quick-settings tile, the launcher's shortcut or a widget's plus: a title, the list it goes to,
// and it is gone. With the server out of reach the task waits in the outbox (Outbox.kt) and is added when it can be.
package app.tefnotes.companion

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
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
import kotlinx.coroutines.launch

class TaskActivity : ComponentActivity() {
    private var title by mutableStateOf("")
    private var list by mutableStateOf("inbox")
    private var busy by mutableStateOf(false)

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
            Sheet(Store.look(this), "New task", ::finish) {
                OutlinedTextField(
                    title, { title = it }, Modifier.fillMaxWidth().focusRequester(focus), placeholder = { Text("What needs doing?") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { add() }),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((name, label) in TASK_LISTS.filter { it.first != "upcoming" }.reversed())
                        FilterChip(list == name, { list = name }, { Text(label) })
                }
                Button(::add, Modifier.fillMaxWidth(), enabled = title.isNotBlank() && !busy) { Text("Add task") }
            }
            LaunchedEffect(Unit) { focus.requestFocus() }
        }
    }

    private fun add() {
        if (title.isBlank() || busy) return
        busy = true
        lifecycleScope.launch {
            val said = try {
                Api(Store.server(this@TaskActivity)!!).addTask(title.trim(), list)
                "Added to ${listLabel(list)}"
            } catch (e: Refused) {
                // A no for good: the sheet stays as it is, so nothing typed is lost.
                if (!e.again) return@launch refused(e)
                later()
            } catch (_: Unreachable) {
                later()
            }
            Sync.now(this@TaskActivity)
            Toast.makeText(this@TaskActivity, said, Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun later(): String {
        Outbox.addTask(this, title.trim(), list)
        return "Saved. It is added when the server is reachable"
    }

    private fun refused(e: Refused) {
        busy = false
        Toast.makeText(this, e.message, Toast.LENGTH_LONG).show()
    }

    companion object { const val LIST = "list" }
}
