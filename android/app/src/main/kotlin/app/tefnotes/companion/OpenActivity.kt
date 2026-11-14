// Opens the web app at a place the server named (a feed's or a row's `url`). A plain link: the default browser takes
// it, and Chrome hands a link inside an installed web app's scope to that app. No screen of its own.
package app.tefnotes.companion

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.core.net.toUri

class OpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        open(this, intent.getStringExtra(URL) ?: "/")
        finish()
    }

    companion object {
        const val URL = "url"

        /** The web app at `path`; the app's own Settings when no server is set. */
        fun open(context: Context, path: String) {
            val server = Store.server(context)
            val intent = if (server == null) Intent(context, SettingsActivity::class.java)
                else Intent(Intent.ACTION_VIEW, (server + path).toUri()).addCategory(Intent.CATEGORY_BROWSABLE)
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(context, "No browser to open TEF Notes in", Toast.LENGTH_LONG).show()
            }
        }
    }
}
