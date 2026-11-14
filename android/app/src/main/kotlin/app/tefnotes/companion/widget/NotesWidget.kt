// The Notes widget: the pinned notes, then the latest, each in its own colour when it has one; a tap opens the note in
// the web app.
package app.tefnotes.companion.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.Text
import app.tefnotes.companion.FeedNote
import app.tefnotes.companion.Look
import app.tefnotes.companion.NotesFeed
import app.tefnotes.companion.R
import app.tefnotes.companion.Store
import app.tefnotes.companion.Sync
import app.tefnotes.companion.notesFeedOf

class NotesWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        val state = currentState<Preferences>()
        val feed = notesFeedOf(state[Keys.Feed])
        val look = feed?.look ?: Store.look(context)
        val stale = state[Keys.Stale] == true
        Frame(look, feed?.title ?: "Notes", feed?.url ?: "/notes", stale && feed != null, null) {
            when {
                feed == null -> Unread(context, look, stale)
                feed.notes.isEmpty() -> Message(look, "No notes here", open(feed.url))
                else -> Rows(feed, look)
            }
        }
    }
}

@Composable
private fun Rows(feed: NotesFeed, look: Look) = LazyColumn(GlanceModifier.fillMaxSize()) {
    items(feed.notes) { NoteRow(it, look) }
    if (feed.more > 0) item {
        Text("${feed.more} more in TEF Notes", GlanceModifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clickable(open(feed.url)), text(look.dim, 12))
    }
}

@Composable
private fun NoteRow(note: FeedNote, look: Look) = Box(GlanceModifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 3.dp)) {
    Column(GlanceModifier.fillMaxWidth().background(tint(note.bg ?: look.card)).cornerRadius(12.dp).padding(horizontal = 12.dp, vertical = 8.dp).clickable(open(note.url))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (note.pinned) Image(ImageProvider(R.drawable.ic_pin), "Pinned", GlanceModifier.size(12.dp), colorFilter = ColorFilter.tint(tint(note.fg ?: look.dim)))
            Text(note.title, GlanceModifier.padding(start = if (note.pinned) 6.dp else 0.dp), text(note.fg ?: look.fg, 14, bold = true), maxLines = 1)
        }
        if (note.peek.isNotEmpty()) Text(note.peek, style = text(note.fg ?: look.dim, 12), maxLines = 2)
    }
}

class NotesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = NotesWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        Sync.keepFresh(context)
        Sync.now(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        restIfNone(context, TasksWidgetReceiver::class.java)
    }
}
