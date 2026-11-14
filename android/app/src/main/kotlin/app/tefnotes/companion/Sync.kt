// The one background job: sends what waits (a widget's ticks, the outbox), then reads the feeds the widgets draw. It runs
// when something was just done (a tick, a save, a widget added) and every half hour while a widget is on the home screen,
// only with a network. With the server out of reach, what waits stays, and a second piece of work tries again with a
// growing pause until it is sent; that never holds up a run asked for meanwhile (a refresh tapped once back in reach).
package app.tefnotes.companion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.tefnotes.companion.widget.Widgets
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    // One run at a time, whichever piece of work it is: a clip's save is not sent twice by two runs side by side.
    override suspend fun doWork(): Result = running.withLock {
        val context = applicationContext
        val api = Store.server(context)?.let(::Api) ?: return Result.success()
        // A send and the note that it was sent go together: stopped between the two (the system ends the work, the last
        // widget is removed), the next run would send it again, and a repeating task ticked twice rolls over twice.
        val sent = withContext(NonCancellable) {
            try {
                for (id in Store.ticks(context)) {
                    // A refusal for good (the task is gone) meets the wish as far as it can be met.
                    try { api.tick(id) } catch (e: Refused) { if (e.again) throw e }
                    Store.dropTick(context, id)
                }
                Outbox.send(context, api)
                true
            } catch (_: Unreachable) { false } catch (_: Refused) { false } catch (_: IOException) { false }
        }
        try { Store.keep(context, api.hello()) } catch (_: Unreachable) { } catch (_: Refused) { }
        Widgets.refresh(context, api)
        when {
            sent -> Result.success()
            inputData.getBoolean(AGAIN, false) -> Result.retry()
            else -> { Sync.again(context); Result.success() }
        }
    }

    companion object {
        /** This piece of work is the one that tries again until everything is sent. */
        const val AGAIN = "again"
        private val running = Mutex()
    }
}

object Sync {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Soon, after a run already asked for. */
    fun now(context: Context) {
        val work = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniqueWork("sync", ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }

    /** Something couldn't be sent: tried again in a minute, then after twice as long each time, until it is. One such
     *  piece of work at most. */
    fun again(context: Context) {
        val work = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).setInputData(workDataOf(SyncWorker.AGAIN to true))
            .setInitialDelay(1, TimeUnit.MINUTES).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniqueWork("again", ExistingWorkPolicy.KEEP, work)
    }

    /** Every half hour from now on: what keeps a widget fresh. Asked again, it stays as it is. */
    fun keepFresh(context: Context) {
        val work = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("fresh", ExistingPeriodicWorkPolicy.KEEP, work)
    }

    /** No widget is left to keep fresh. */
    fun rest(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("fresh")
    }
}
