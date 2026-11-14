// What the two widgets share: where each keeps what it draws (Glance's per-widget state: the feed as the server sent it,
// whether it is out of date, and for a tasks widget its list), the frame and the actions. A widget is drawn by the
// launcher from a description, so everything here is Glance's, not the app's own Compose: the system's typeface, and the
// owner's colours from the feed's own look.
package app.tefnotes.companion.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.tefnotes.companion.Api
import app.tefnotes.companion.Look
import app.tefnotes.companion.OpenActivity
import app.tefnotes.companion.R
import app.tefnotes.companion.SettingsActivity
import app.tefnotes.companion.Store
import app.tefnotes.companion.Sync
import app.tefnotes.companion.withoutTask

object Keys {
    /** A tasks widget's list (Contract.kt TASK_LISTS); Today until the owner picks another. */
    val List = stringPreferencesKey("list")
    /** The feed's JSON, as the server sent it. */
    val Feed = stringPreferencesKey("feed")
    /** The last try to read the feed found no server: what is drawn may be old. */
    val Stale = booleanPreferencesKey("stale")
}

object Widgets {
    private suspend fun tasks(context: Context) = GlanceAppWidgetManager(context).getGlanceIds(TasksWidget::class.java)
    private suspend fun notes(context: Context) = GlanceAppWidgetManager(context).getGlanceIds(NotesWidget::class.java)

    /** Every widget's feed read again. A task ticked on a widget and not yet sent stays out of what is drawn. */
    suspend fun refresh(context: Context, api: Api) {
        val ticked = Store.ticks(context)
        val lists = mutableMapOf<String, String>()
        for (id in tasks(context)) {
            val list = getAppWidgetState(context, PreferencesGlanceStateDefinition, id)[Keys.List] ?: "today"
            val feed = lists.getOrPut(list) { ticked.fold(api.tasks(list), ::withoutTask) }
            updateAppWidgetState(context, id) { it[Keys.Feed] = feed; it[Keys.Stale] = false }
            TasksWidget().update(context, id)
        }
        val ids = notes(context)
        if (ids.isEmpty()) return
        val feed = api.notes()
        for (id in ids) {
            updateAppWidgetState(context, id) { it[Keys.Feed] = feed; it[Keys.Stale] = false }
            NotesWidget().update(context, id)
        }
    }

    /** The server couldn't be reached: each widget keeps what it has, and says it may be old. */
    suspend fun stale(context: Context) {
        for (id in tasks(context)) { updateAppWidgetState(context, id) { it[Keys.Stale] = true }; TasksWidget().update(context, id) }
        for (id in notes(context)) { updateAppWidgetState(context, id) { it[Keys.Stale] = true }; NotesWidget().update(context, id) }
    }

    /** A task ticked on one widget leaves them all at once, before the server has heard. */
    suspend fun dropTask(context: Context, task: String) {
        for (id in tasks(context)) {
            updateAppWidgetState(context, id) { s -> s[Keys.Feed]?.let { s[Keys.Feed] = withoutTask(it, task) } }
            TasksWidget().update(context, id)
        }
    }
}

class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) = Sync.now(context)
}

/** A tick: the row goes at once, the server hears with the next sync (Sync.kt), now or when it is back in reach. */
class TickAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val task = parameters[Task] ?: return
        Store.addTick(context, task)
        Widgets.dropTask(context, task)
        Sync.now(context)
    }

    companion object { val Task = ActionParameters.Key<String>("task") }
}

internal fun tint(argb: Int) = ColorProvider(Color(argb))
internal fun text(argb: Int, size: Int, bold: Boolean = false) =
    TextStyle(color = tint(argb), fontSize = size.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)

/** The web app at `url` (a feed's or a row's own). */
internal fun open(url: String): Action = actionStartActivity<OpenActivity>(actionParametersOf(ActionParameters.Key<String>(OpenActivity.URL) to url))

@Composable
internal fun Button(icon: Int, label: String, color: Int, onClick: Action) =
    Box(GlanceModifier.size(36.dp).clickable(onClick), contentAlignment = Alignment.Center) {
        Image(ImageProvider(icon), label, GlanceModifier.size(18.dp), colorFilter = ColorFilter.tint(tint(color)))
    }

/** A widget: the mark and its heading (which opens the web app there), a refresh, `add` when it has something to add,
 *  and under them `content`. */
@Composable
internal fun Frame(look: Look, title: String, url: String, stale: Boolean, add: Action?, content: @Composable () -> Unit) =
    Column(GlanceModifier.fillMaxSize().appWidgetBackground().background(tint(look.bg)).cornerRadius(22.dp)) {
        Row(GlanceModifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(ImageProvider(R.drawable.ic_mark), null, GlanceModifier.size(18.dp), colorFilter = ColorFilter.tint(tint(look.brand)))
            Text(title, GlanceModifier.defaultWeight().padding(start = 8.dp).clickable(open(url)), text(look.fg, 15, bold = true), maxLines = 1)
            if (stale) Image(ImageProvider(R.drawable.ic_offline), "Not up to date", GlanceModifier.size(16.dp), colorFilter = ColorFilter.tint(tint(look.warn)))
            Button(R.drawable.ic_refresh, "Refresh", look.dim, actionRunCallback<RefreshAction>())
            if (add != null) Button(R.drawable.ic_add, "New task", look.brand, add)
        }
        content()
    }

/** What a widget says in place of its rows. */
@Composable
internal fun Message(look: Look, words: String, onClick: Action) =
    Box(GlanceModifier.fillMaxSize().padding(16.dp).clickable(onClick), contentAlignment = Alignment.Center) { Text(words, style = text(look.dim, 13)) }

/** What a widget with no feed says: there is no server yet, it couldn't be reached, or it hasn't been asked. */
@Composable
internal fun Unread(context: Context, look: Look, stale: Boolean) = when {
    Store.server(context) == null -> Message(look, "Tap to set your server", actionStartActivity<SettingsActivity>())
    stale -> Message(look, "The server can't be reached. Tap to try again", actionRunCallback<RefreshAction>())
    else -> Message(look, "Loading", actionRunCallback<RefreshAction>())
}
