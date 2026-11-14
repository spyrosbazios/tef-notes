// What the app's own screens share, drawn as the web app draws its phone forms (web/src/components/form-sheet.tsx and
// ui/): the owner's look as a theme (every colour from Look, none written here), the brand's typeface, and the pieces:
// the bottom sheet (the web's drawer: a handle, a centred title, the fields scrolling between it and a bar of buttons;
// dragged down or tapped beside to leave), a button, a field, a tag's chip, a tick box, a spinner. They move on the web
// app's own values (Motion.kt) and answer a finger the same way: no ripple, a press that scales.
package app.tefnotes.companion

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

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

/** The look as Material's roles, by the web app's own mapping (web/src/index.css: its primary is the brand with the
 *  ground's colour on it, a sheet's ground is `raised`, a card's `card`). */
fun Look.colors(): ColorScheme {
    val c = { argb: Int -> Color(argb) }
    return (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c(brand), onPrimary = c(bg), secondary = c(brand), onSecondary = c(bg), tertiary = c(up), onTertiary = c(bg),
        background = c(bg), onBackground = c(fg), surface = c(bg), onSurface = c(fg),
        surfaceVariant = c(card), onSurfaceVariant = c(dim), surfaceContainerLowest = c(bg), surfaceContainerLow = c(card),
        surfaceContainer = c(card), surfaceContainerHigh = c(raised), surfaceContainerHighest = c(raised),
        secondaryContainer = c(raised), onSecondaryContainer = c(fg), primaryContainer = c(raised), onPrimaryContainer = c(fg),
        outline = c(faint), outlineVariant = c(line), error = c(down), onError = c(bg), scrim = c(scrim),
    )
}

/** The look itself, for what Material has no role for (the washes, `faint`). */
val LocalLook = staticCompositionLocalOf<Look> { error("No look: draw inside Themed") }

@Composable
fun Themed(look: Look, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalLook provides look) { MaterialTheme(colorScheme = look.colors(), typography = Type, content = content) }

@Composable
fun Glyph(drawable: Int, label: String?, tint: Color = MaterialTheme.colorScheme.onSurfaceVariant, size: Dp = 20.dp) =
    Icon(painterResource(drawable), label, Modifier.size(size), tint)

/** The web app's spinner: its loader, turning once a second. */
@Composable
fun Spinner(size: Dp = 16.dp, tint: Color = LocalContentColor.current) {
    val turn by rememberInfiniteTransition(label = "spin").animateFloat(0f, 360f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "turn")
    Icon(painterResource(R.drawable.ic_busy), "Working", Modifier.size(size).graphicsLayer { rotationZ = turn }, tint)
}

// ---- the sheet

/** A sheet's way out, for what closes it from outside its own gestures (a save done, a button). */
class SheetControl {
    internal var leaving by mutableStateOf(false)
    fun close() { leaving = true }
}

private val Tail = 64.dp
private val Radius = 17.dp

/** A sheet from the bottom of the screen over whatever was there: the web app's drawer. It slides in with a hint of
 *  bounce and speeds off its edge; a drag on its top, or on its fields once they are scrolled to their top, takes it along
 *  and lets go past a quarter of its height or with a flick; a tap beside it, Back, or `control.close()` leave too.
 *  `onClosed` runs once it is off the screen. `footer`: its bar of buttons, kept above the keyboard. */
@Composable
fun Sheet(
    look: Look, title: String, control: SheetControl, onClosed: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit,
) = Themed(look) {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var height by remember { mutableFloatStateOf(0f) }
    // How far down the sheet stands from its place, in px; before it is measured, wholly out of sight.
    var y by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    var gone by remember { mutableStateOf(false) }
    var move by remember { mutableStateOf<Job?>(null) }
    fun glide(to: Float, token: TweenToken, then: () -> Unit = {}) {
        move?.cancel()
        move = scope.launch { animate(y, to, animationSpec = token.spec()) { v, _ -> y = v }; then() }
    }
    fun leave() {
        if (gone) return
        gone = true
        glide(height, Tokens.Tweens.drawerOut, onClosed)
    }
    fun drag(by: Float) {
        if (gone) return
        move?.cancel()
        y = (y + by).coerceAtLeast(0f)
    }
    fun settle(speed: Float) {
        if (gone) return
        if (speed > with(density) { FLICK.toPx() } || y > height * LET_GO) leave() else glide(0f, Tokens.Tweens.drawer)
    }
    LaunchedEffect(height > 0f) { if (height > 0f && !gone) { y = height; glide(0f, Tokens.Tweens.drawer) } }
    LaunchedEffect(control.leaving) { if (control.leaving) leave() }
    BackHandler { leave() }

    // The fields' scroll hands the sheet what it can't use: a pull down at their top drags it, and it is pushed back up
    // before they scroll again.
    val pull = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset =
                if (available.y < 0f && y > 0f && source == NestedScrollSource.UserInput) { drag(available.y); Offset(0f, available.y) } else Offset.Zero
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset =
                if (available.y > 0f && source == NestedScrollSource.UserInput) { drag(available.y); Offset(0f, available.y) } else Offset.Zero
            override suspend fun onPreFling(available: Velocity): Velocity = if (y > 0f) { settle(available.y); available } else Velocity.Zero
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val room = maxHeight
        Box(
            Modifier.fillMaxSize().graphicsLayer { alpha = if (height > 0f) (1f - y / height).coerceIn(0f, 1f) else 0f }
                .background(MaterialTheme.colorScheme.scrim).pointerInput(Unit) { detectTapGestures { leave() } },
        )
        Column(
            // Longer than it shows by a tail under the screen's edge, so the bounce at the end of its slide opens no gap.
            Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.statusBars).offset(y = Tail)
                .widthIn(max = 560.dp).fillMaxWidth().heightIn(max = room * MAX_HEIGHT + Tail)
                .onSizeChanged { height = it.height.toFloat() }
                .graphicsLayer { translationY = if (y == Float.MAX_VALUE) size.height else y }
                .clip(RoundedCornerShape(topStart = Radius, topEnd = Radius))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(topStart = Radius, topEnd = Radius))
                .pointerInput(Unit) { detectTapGestures { } },          // the sheet takes its own taps: only one beside it leaves
        ) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
                Column(
                    Modifier.fillMaxWidth().draggable(rememberDraggableState { drag(it) }, Orientation.Vertical, onDragStopped = { settle(it) }),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(Modifier.padding(top = 16.dp).size(100.dp, 4.dp).clip(CircleShape).background(Color(LocalLook.current.muted)))
                    Text(title, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
                        style = MaterialTheme.typography.titleSmall.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold), textAlign = TextAlign.Center)
                }
                val under = WindowInsets.ime.union(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom)
                Column(
                    Modifier.weight(1f, fill = false).nestedScroll(pull).verticalScroll(rememberScrollState())
                        .then(if (footer == null) Modifier.windowInsetsPadding(under) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
                    content = content,
                )
                if (footer != null) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
                    Row(Modifier.fillMaxWidth().windowInsetsPadding(under).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), content = footer)
                }
                Spacer(Modifier.height(Tail))
            }
        }
    }
}

/** A sheet takes at most this much of the screen's height (the web drawer's 92dvh). */
private const val MAX_HEIGHT = 0.92f
/** Let go past this share of its height, or flicked down faster than `FLICK` a second, a sheet leaves (the web
 *  drawer's own: a quarter, 0.4 px a millisecond). */
private const val LET_GO = 0.25f
private val FLICK = 400.dp

// ---- the controls

enum class ButtonKind { Primary, Secondary, Ghost }

/** The web app's button: no ripple; under a finger it scales, and it fades when it can't be pressed. `round`: a pill, as
 *  a sheet's bar has them. `height`: its least, a finger's width unless it stands among smaller things. */
@Composable
fun TfButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, kind: ButtonKind = ButtonKind.Primary, enabled: Boolean = true,
    round: Boolean = false, height: Dp = 44.dp, content: @Composable RowScope.() -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val scale by pressScale(source)
    val scheme = MaterialTheme.colorScheme
    val ground by animateColorAsState(
        when (kind) { ButtonKind.Primary -> scheme.primary; ButtonKind.Secondary -> scheme.surfaceVariant; ButtonKind.Ghost -> Color.Transparent },
        Tokens.Tweens.color.spec(), label = "ground",
    )
    val ink by animateColorAsState(if (kind == ButtonKind.Primary) scheme.onPrimary else scheme.onSurface, Tokens.Tweens.color.spec(), label = "ink")
    val shown by animateFloatAsState(if (enabled) 1f else DISABLED, Tokens.Tweens.color.spec(), label = "enabled")
    val shape = if (round) CircleShape else RoundedCornerShape(12.dp)
    Row(
        modifier.graphicsLayer { scaleX = scale; scaleY = scale; alpha = shown }.heightIn(min = height).clip(shape).background(ground)
            .then(if (kind == ButtonKind.Secondary) Modifier.border(1.dp, scheme.outlineVariant, shape) else Modifier)
            .clickable(source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        CompositionLocalProvider(LocalContentColor provides ink) {
            ProvideTextStyle(MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp), content = { content() })
        }
    }
}

/** How much of a control shows when it can't be used (the web's `disabled:opacity-50`). */
private const val DISABLED = 0.5f

/** The web app's field: a quiet box whose edge takes the brand's colour while it is typed in, the error's when `invalid`.
 *  `shake`: how far it stands off sideways (Motion.kt `Shake`). */
@Composable
fun TfField(
    value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, singleLine: Boolean = true,
    minLines: Int = 1, maxLines: Int = if (singleLine) 1 else 6, invalid: Boolean = false, shake: Float = 0f,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val scheme = MaterialTheme.colorScheme
    val edge by animateColorAsState(
        when { invalid -> scheme.error; focused -> scheme.primary.copy(alpha = FOCUS_EDGE); else -> scheme.outlineVariant },
        Tokens.Tweens.color.spec(), label = "edge",
    )
    val shape = RoundedCornerShape(12.dp)
    val text = MaterialTheme.typography.bodyLarge.copy(color = scheme.onSurface)
    BasicTextField(
        value, onValueChange, modifier.offset(x = shake.dp), textStyle = text, singleLine = singleLine, minLines = minLines, maxLines = maxLines,
        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions, interactionSource = source, cursorBrush = SolidColor(scheme.primary),
        decorationBox = { field ->
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(shape).background(scheme.surfaceVariant).border(1.dp, edge, shape).padding(horizontal = 12.dp, vertical = 10.dp),
                contentAlignment = if (singleLine) Alignment.CenterStart else Alignment.TopStart,
            ) {
                if (value.isEmpty()) Text(placeholder, style = text, color = Color(LocalLook.current.faint), maxLines = 1)
                field()
            }
        },
    )
}

/** The brand's share in a focused field's edge (the web's `focus:border-brand/60`). */
private const val FOCUS_EDGE = 0.6f

/** A tag to put on or take off, as the web app's tag editor has them: a pill that takes the brand's colour and a check
 *  when it is on. `hint`: said beside it while it is off (how likely it fits). */
@Composable
fun TagChip(name: String, on: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier, hint: String? = null) {
    val source = remember { MutableInteractionSource() }
    val scale by pressScale(source)
    val scheme = MaterialTheme.colorScheme
    val soft = Color(LocalLook.current.soft)
    val ground by animateColorAsState(if (on) soft else soft.copy(alpha = 0f), Tokens.Tweens.color.spec(), label = "ground")
    val edge by animateColorAsState(if (on) scheme.primary else scheme.outlineVariant, Tokens.Tweens.color.spec(), label = "edge")
    val ink by animateColorAsState(if (on) scheme.primary else scheme.onSurfaceVariant, Tokens.Tweens.color.spec(), label = "ink")
    Row(
        modifier.graphicsLayer { scaleX = scale; scaleY = scale }.height(36.dp).clip(CircleShape).background(ground).border(1.dp, edge, CircleShape)
            .clickable(source, indication = null, role = Role.Checkbox, onClickLabel = if (on) "Remove tag $name" else "Add tag $name", onClick = onToggle)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(
            on,
            enter = expandHorizontally(Tokens.Springs.reflow.spec()) + scaleIn(Tokens.Springs.checkPop.spec(), Tokens.Scales.icon) + fadeIn(Tokens.Tweens.fade.spec()),
            exit = shrinkHorizontally(Tokens.Springs.reflow.spec()) + scaleOut(Tokens.Tweens.popOut.spec(), Tokens.Scales.icon) + fadeOut(Tokens.Tweens.popOut.spec()),
        ) { Row { Glyph(R.drawable.ic_check, null, ink, 14.dp); Spacer(Modifier.width(6.dp)) } }
        Text(name, style = MaterialTheme.typography.bodyMedium, color = ink, maxLines = 1)
        AnimatedVisibility(
            !on && hint != null,
            enter = expandHorizontally(Tokens.Springs.reflow.spec()) + fadeIn(Tokens.Tweens.fade.spec()),
            exit = shrinkHorizontally(Tokens.Springs.reflow.spec()) + fadeOut(Tokens.Tweens.popOut.spec()),
        ) { Text(" ${hint ?: ""}", style = MaterialTheme.typography.bodySmall, color = Color(LocalLook.current.faint), maxLines = 1) }
    }
}

/** A tick box with its words, as the web app's checkbox: the box fills with the brand's colour, growing from within as it
 *  fades in, and then the check draws itself; unticked, the check erases as the fill goes. */
@Composable
fun TickBox(checked: Boolean, onChange: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val fill by animateFloatAsState(if (checked) 1f else 0f, Tokens.Tweens.fill.spec(), label = "fill")
    val drawn by animateFloatAsState(if (checked) 1f else 0f, (if (checked) Tokens.Tweens.check else Tokens.Tweens.uncheck).spec(), label = "check")
    val shape = RoundedCornerShape(5.dp)
    Row(
        modifier.clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Checkbox, onClick = { onChange(!checked) }).heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(20.dp).clip(shape).border(1.dp, scheme.outlineVariant, shape), contentAlignment = Alignment.Center) {
            val from = Tokens.Scales.fill
            Box(Modifier.fillMaxSize().graphicsLayer { val s = from + (1f - from) * fill; scaleX = s; scaleY = s; alpha = fill }.background(scheme.primary, shape))
            Canvas(Modifier.size(14.dp)) {
                // lucide's check (M20 6 9 17l-5-5 in a box of 24), drawn from its short end as far as `drawn`.
                val unit = size.width / 24f
                val whole = Path().apply { moveTo(4f * unit, 12f * unit); lineTo(9f * unit, 17f * unit); lineTo(20f * unit, 6f * unit) }
                val part = Path()
                PathMeasure().apply { setPath(whole, false); getSegment(0f, length * drawn, part, true) }
                drawPath(part, scheme.onPrimary, style = Stroke(2.5f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
