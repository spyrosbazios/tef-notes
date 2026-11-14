// What the two widgets share: where each keeps what it draws (Glance's per-widget state: the feed as the server sent it,
// whether it is out of date, and for a tasks widget its list), the frame (its heading's lens switch and assistant button
// are the feed's own, companion.ts `Switches`) and the actions. A widget is drawn by the
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
import androidx.glance.appwidget.GlanceAppWidget
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
import app.tefnotes.companion.Refused
import app.tefnotes.companion.SettingsActivity
import app.tefnotes.companion.Store
import app.tefnotes.companion.Switches
import app.tefnotes.companion.Sync
import app.tefnotes.companion.Unreachable
import app.tefnotes.companion.lensesJson
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

    /** A feed asked for; null when the server couldn't be reached or refused. */
    private suspend fun read(ask: suspend () -> String): String? = try { ask() } catch (_: Unreachable) { null } catch (_: Refused) { null }

    /** One widget given its feed, or, with none, left as it is and marked as maybe old. A widget removed meanwhile is
     *  passed over: the others still get theirs. */
    private suspend fun show(context: Context, id: GlanceId, widget: GlanceAppWidget, feed: String?) {
        try {
            updateAppWidgetState(context, id) { if (feed != null) it[Keys.Feed] = feed; it[Keys.Stale] = feed == null }
            widget.update(context, id)
        } catch (_: IllegalArgumentException) { }
    }

    /** Every widget's feed read again, each on its own: one that can't be read leaves the others fresh. A task ticked on
     *  a widget and not yet sent stays out of what is drawn. */
    suspend fun refresh(context: Context, api: Api) {
        val ticked = Store.ticks(context)
        val lists = mutableMapOf<String, String?>()
        for (id in tasks(context)) {
            val list = try { getAppWidgetState(context, PreferencesGlanceStateDefinition, id)[Keys.List] ?: "today" } catch (_: IllegalArgumentException) { continue }
            if (list !in lists) lists[list] = read { ticked.fold(api.tasks(list), ::withoutTask) }
            show(context, id, TasksWidget(), lists[list])
        }
        val ids = notes(context)
        if (ids.isEmpty()) return
        val feed = read { api.notes() }
        for (id in ids) show(context, id, NotesWidget(), feed)
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

/** The picker of the lens on (LensActivity), given the feed's choices. */
private fun pickLens(switches: Switches): Action =
    actionStartActivity<LensActivity>(actionParametersOf(ActionParameters.Key<String>(LensActivity.LENSES) to lensesJson(switches.lenses)))

/** A widget: its heading (which opens the web app there) after the lens switch, in the brand's colour while a lens is on,
 *  or the mark when there is no lens to switch to; the assistant, a refresh, `add` when it has something to add, and
 *  under them `content`. `switches`: the feed's, null before any feed. */
@Composable
internal fun Frame(look: Look, title: String, url: String, stale: Boolean, switches: Switches?, add: Action?, content: @Composable () -> Unit) =
    Column(GlanceModifier.fillMaxSize().appWidgetBackground().background(tint(look.bg)).cornerRadius(22.dp)) {
        val pick = switches?.takeIf { it.lenses.isNotEmpty() }
        Row(GlanceModifier.fillMaxWidth().padding(start = if (pick == null) 14.dp else 4.dp, end = 6.dp, top = 6.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            if (pick == null) Image(ImageProvider(R.drawable.ic_mark), null, GlanceModifier.size(18.dp), colorFilter = ColorFilter.tint(tint(look.brand)))
            else Button(R.drawable.ic_lens, "Lens", if (pick.lenses.any { it.on && it.id.isNotEmpty() }) look.brand else look.dim, pickLens(pick))
            Text(title, GlanceModifier.defaultWeight().padding(start = if (pick == null) 8.dp else 0.dp).clickable(open(url)), text(look.fg, 15, bold = true), maxLines = 1)
            if (stale) Image(ImageProvider(R.drawable.ic_offline), "Not up to date", GlanceModifier.size(16.dp), colorFilter = ColorFilter.tint(tint(look.warn)))
            if (switches != null && switches.ask.isNotEmpty()) Button(R.drawable.ic_ask, "Ask the assistant", look.dim, open(switches.ask))
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
