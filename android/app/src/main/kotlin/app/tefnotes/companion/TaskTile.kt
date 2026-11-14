// The quick-settings tile: "New task" from anywhere, the shade included.
package app.tefnotes.companion

import android.app.PendingIntent
import android.content.Intent
import android.service.quicksettings.TileService

class TaskTile : TileService() {
    override fun onClick() {
        val intent = Intent(this, TaskActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
    }
}
