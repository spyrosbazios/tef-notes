// What the app's own screens share: the owner's look as a Material theme (every colour from Look, none written here), the
// brand's typeface, the bottom sheet the quick screens are, and an icon by its drawable.
package app.tefnotes.companion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val Atkinson = FontFamily(
    Font(R.font.atkinson_400, FontWeight.Normal), Font(R.font.atkinson_500, FontWeight.Medium),
    Font(R.font.atkinson_600, FontWeight.SemiBold), Font(R.font.atkinson_700, FontWeight.Bold),
)

private fun TextStyle.own() = copy(fontFamily = Atkinson)
private val Type = Typography().run {
    Typography(
        displayLarge.own(), displayMedium.own(), displaySmall.own(), headlineLarge.own(), headlineMedium.own(), headlineSmall.own(),
        titleLarge.own(), titleMedium.own(), titleSmall.own(), bodyLarge.own(), bodyMedium.own(), bodySmall.own(),
        labelLarge.own(), labelMedium.own(), labelSmall.own(),
    )
}

/** The look as Material's roles: the web app's own mapping (its primary is the brand, with the ground's colour on it). */
fun Look.colors(): ColorScheme {
    val c = { argb: Int -> Color(argb) }
    return (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c(brand), onPrimary = c(bg), secondary = c(brand), onSecondary = c(bg), tertiary = c(up), onTertiary = c(bg),
        background = c(bg), onBackground = c(fg), surface = c(bg), onSurface = c(fg),
        surfaceVariant = c(card), onSurfaceVariant = c(dim), surfaceContainerLowest = c(bg), surfaceContainerLow = c(card),
        surfaceContainer = c(card), surfaceContainerHigh = c(raised), surfaceContainerHighest = c(raised),
        secondaryContainer = c(raised), onSecondaryContainer = c(fg), primaryContainer = c(raised), onPrimaryContainer = c(fg),
        outline = c(faint), outlineVariant = c(line), error = c(down), onError = c(bg), scrim = c(bg),
    )
}

@Composable
fun Themed(look: Look, content: @Composable () -> Unit) = MaterialTheme(colorScheme = look.colors(), typography = Type, content = content)

@Composable
fun Glyph(drawable: Int, label: String?, tint: Color = MaterialTheme.colorScheme.onSurfaceVariant, size: Dp = 20.dp) =
    Icon(painterResource(drawable), label, Modifier.size(size), tint)

/** A sheet from the bottom of the screen over whatever was there: a tap outside it, or its close button, leaves. */
@Composable
fun Sheet(look: Look, title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) = Themed(look) {
    Box(
        Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null, onClick = onClose)
            .windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime)),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Surface(
            Modifier.fillMaxWidth().widthIn(max = 560.dp), shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground,
        ) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Glyph(R.drawable.ic_mark, null, MaterialTheme.colorScheme.primary, 22.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    IconButton(onClose) { Glyph(R.drawable.ic_close, "Close") }
                }
                content()
            }
        }
    }
}
