// The lens on, picked from a widget's heading: the choices are the feed's own (companion.ts `Switches`), and the pick is
// the owner's preference on the server, so the web app and every widget follow it. Nothing is kept here: with the server
// out of reach the sheet says so and the lens stays as it was.
package app.tefnotes.companion.widget

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import app.tefnotes.companion.Api
import app.tefnotes.companion.ButtonKind
import app.tefnotes.companion.LensChoice
import app.tefnotes.companion.OpenActivity
import app.tefnotes.companion.Refused
import app.tefnotes.companion.Sheet
import app.tefnotes.companion.SheetControl
import app.tefnotes.companion.Store
import app.tefnotes.companion.Sync
import app.tefnotes.companion.TfButton
import app.tefnotes.companion.Unreachable
import app.tefnotes.companion.lensChoicesOf
import kotlinx.coroutines.launch

class LensActivity : ComponentActivity() {
    private val sheet = SheetControl()
    private var busy by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val lenses = lensChoicesOf(intent.getStringExtra(LENSES))
        if (lenses.isEmpty()) return finish()
        if (Store.server(this) == null) {
            OpenActivity.open(this, "/")
            return finish()
        }
        setContent {
            Sheet(Store.look(this), "Lens", sheet, ::leave) {
                for (lens in lenses) Box(Modifier.padding(bottom = 8.dp)) {
                    // The one on is the filled button; tapping it leaves things as they are.
                    if (lens.on) TfButton(sheet::close, Modifier.fillMaxWidth()) { Text(lens.name) }
                    else TfButton({ pick(lens) }, Modifier.fillMaxWidth(), ButtonKind.Secondary, enabled = !busy) { Text(lens.name) }
                }
            }
        }
    }

    private fun pick(lens: LensChoice) {
        if (busy) return
        busy = true
        lifecycleScope.launch {
            try {
                Api(Store.server(this@LensActivity)!!).setLens(lens.id)
            } catch (e: Refused) {
                return@launch failed(e.message ?: "The server refused")
            } catch (_: Unreachable) {
                return@launch failed("The server can't be reached")
            }
            // The widgets are drawn again from the server, under the lens now on.
            Sync.now(this@LensActivity)
            sheet.close()
        }
    }

    /** The sheet is off the screen: the window goes with no move of its own. */
    private fun leave() {
        overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        finish()
    }

    private fun failed(why: String) {
        busy = false
        Toast.makeText(this, why, Toast.LENGTH_LONG).show()
    }

    companion object { const val LENSES = "lenses" }
}
