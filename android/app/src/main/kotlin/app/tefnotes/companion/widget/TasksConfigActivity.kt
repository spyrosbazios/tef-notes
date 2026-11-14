// Which list a Tasks widget shows: asked when the launcher offers it (placing the widget, or its "reconfigure"); a
// widget placed without it shows Today.
package app.tefnotes.companion.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.lifecycle.lifecycleScope
import app.tefnotes.companion.ButtonKind
import app.tefnotes.companion.Sheet
import app.tefnotes.companion.SheetControl
import app.tefnotes.companion.Store
import app.tefnotes.companion.Sync
import app.tefnotes.companion.TASK_LISTS
import app.tefnotes.companion.TfButton
import kotlinx.coroutines.launch

class TasksConfigActivity : ComponentActivity() {
    private val sheet = SheetControl()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val widget = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        // Leaving without a pick leaves the widget as it was.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
        if (widget == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()
        setContent {
            Sheet(Store.look(this), "Which list?", sheet, ::leave) {
                for ((list, label) in TASK_LISTS) Box(Modifier.padding(bottom = 8.dp)) {
                    TfButton({ pick(widget, list) }, Modifier.fillMaxWidth(), ButtonKind.Secondary) { Text(label) }
                }
            }
        }
    }

    private fun pick(widget: Int, list: String) = lifecycleScope.launch {
        val id = GlanceAppWidgetManager(this@TasksConfigActivity).getGlanceIdBy(widget)
        updateAppWidgetState(this@TasksConfigActivity, id) { it[Keys.List] = list; it.remove(Keys.Feed) }
        TasksWidget().update(this@TasksConfigActivity, id)
        Sync.now(this@TasksConfigActivity)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widget))
        sheet.close()
    }

    /** The sheet is off the screen: the window goes with no move of its own. */
    private fun leave() {
        overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
        finish()
    }
}
