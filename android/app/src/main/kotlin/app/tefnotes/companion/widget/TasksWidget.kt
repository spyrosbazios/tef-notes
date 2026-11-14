// The Tasks widget: one of the task lists (Today, unless the owner picked another when placing it), each task with a box
// to tick and a tap to open it in the web app, and a plus for a new task in that list.
package app.tefnotes.companion.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.Text
import app.tefnotes.companion.FeedTask
import app.tefnotes.companion.Look
import app.tefnotes.companion.R
import app.tefnotes.companion.Store
import app.tefnotes.companion.Sync
import app.tefnotes.companion.TaskActivity
import app.tefnotes.companion.TasksFeed
import app.tefnotes.companion.listLabel
import app.tefnotes.companion.tasksFeedOf

class TasksWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        val state = currentState<Preferences>()
        val list = state[Keys.List] ?: "today"
        val feed = tasksFeedOf(state[Keys.Feed])
        val look = feed?.look ?: Store.look(context)
        val stale = state[Keys.Stale] == true
        val add = actionStartActivity<TaskActivity>(actionParametersOf(ActionParameters.Key<String>(TaskActivity.LIST) to list))
        Frame(look, feed?.title ?: listLabel(list), feed?.url ?: "/$list", stale && feed != null, add) {
            when {
                feed == null -> Unread(context, look, stale)
                feed.sections.isEmpty() -> Message(look, "Nothing here", open(feed.url))
                else -> Rows(feed, look, state[Keys.Ticked].orEmpty())
            }
        }
    }
}

@Composable
private fun Rows(feed: TasksFeed, look: Look, ticked: Set<String>) = LazyColumn(GlanceModifier.fillMaxSize()) {
    for (section in feed.sections) {
        if (section.label.isNotEmpty()) item {
            Text(section.label, GlanceModifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, bottom = 2.dp), text(look.dim, 12, bold = true), maxLines = 1)
        }
        items(section.tasks) { TaskRow(it, look, it.id in ticked) }
    }
    if (feed.more > 0) item {
        Text("${feed.more} more in TEF Notes", GlanceModifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clickable(open(feed.url)), text(look.dim, 12))
    }
}

@Composable
private fun TaskRow(task: FeedTask, look: Look, ticked: Boolean) = Row(GlanceModifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    // Just ticked: shown ticked and faded for its moment, the box taking the tick back.
    val tick = actionRunCallback<TickAction>(actionParametersOf(TickAction.Task to task.id))
    if (ticked) Button(R.drawable.ic_done, "Undo", look.brand, tick) else Button(R.drawable.ic_box, "Done", look.dim, tick)
    Column(GlanceModifier.defaultWeight().padding(vertical = 6.dp).clickable(open(task.url))) {
        Text(task.title, style = text(if (ticked) look.faint else look.fg, 14), maxLines = 2)
        if (task.detail.isNotEmpty()) Text(task.detail, style = text(if (ticked) look.faint else if (task.late) look.down else look.dim, 12), maxLines = 1)
    }
}

class TasksWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = TasksWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        Sync.keepFresh(context)
        Sync.now(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        restIfNone(context, NotesWidgetReceiver::class.java)
    }
}

/** The last widget of one kind is gone: when none of the `other` kind is left either, nothing needs keeping fresh. */
internal fun restIfNone(context: Context, other: Class<out GlanceAppWidgetReceiver>) {
    if (AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, other)).isEmpty()) Sync.rest(context)
}
