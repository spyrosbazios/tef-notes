// A shared picture as the clip routes take it: the JPEG that is stored and the smaller one the server's model looks at
// (sizes: Contract.kt, the core's photos.ts). Read through ImageDecoder, which turns the picture the way its EXIF says.
package app.tefnotes.companion

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.net.Uri
import android.util.Base64
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import java.io.ByteArrayOutputStream
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** `stored`: the save's `file` part. `look`: the suggest step's picture, base64. `shown`: what the sheet draws. */
class Picture(val stored: ByteArray, val look: String, val shown: Bitmap)

private fun jpeg(bitmap: Bitmap, quality: Int): ByteArray =
    ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

/** The picture at `uri`; null when it can't be read (the app that shared it took it back, or it is no picture). */
suspend fun readPicture(context: Context, uri: Uri): Picture? = withContext(Dispatchers.IO) {
    try {
        var full = Size(0, 0)
        val decoded = ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            full = Size(info.size.width, info.size.height)
            val to = storedSize(full.width, full.height)
            decoder.setTargetSize(to.width, to.height)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        // A JPEG has no transparency: what was clear becomes white, not black.
        val flat = if (!decoded.hasAlpha()) decoded else createBitmap(decoded.width, decoded.height).also {
            Canvas(it).apply { drawColor(Color.WHITE); drawBitmap(decoded, 0f, 0f, null) }
        }
        val to = lookSize(full.width, full.height)
        val small = flat.scale(to.width, to.height)
        Picture(jpeg(flat, STORED_QUALITY), Base64.encodeToString(jpeg(small, LOOK_QUALITY), Base64.NO_WRAP), small)
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null          // whatever the other app's provider threw, there is no picture to show for it
    }
}
