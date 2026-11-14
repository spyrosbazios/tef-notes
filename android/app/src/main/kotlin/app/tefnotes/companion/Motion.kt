// How things move here: as they do in the web app. The values are Animate UI's motion tokens, the ones the web app reads
// (Tokens.kt, generated from that package), turned into Compose's own specs; the pieces below are the web app's recipes
// (web/README.md "Motion"): a press that scales, a label that swaps in place through a light blur, a field in error
// shaking once, a list whose rows come and go while the rest closes the gap. Nothing here picks a duration or a curve of
// its own. The system's "remove animations" setting stills all of it: Compose runs every spec at the animator scale.
package app.tefnotes.companion

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.unit.dp
import kotlin.math.sqrt

/** A spring as Animate UI gives it: stiffness and damping at mass 1. */
data class SpringToken(val stiffness: Float, val damping: Float) {
    /** As Compose's: the damping as a share of the critical one. */
    fun <T> spec(): SpringSpec<T> = spring(dampingRatio = damping / (2f * sqrt(stiffness)), stiffness = stiffness)
}

/** A timed move: its length and wait in ms, and its curve as a cubic bezier's four numbers. */
data class TweenToken(val ms: Int, val a: Float, val b: Float, val c: Float, val d: Float, val delay: Int) {
    val easing get() = CubicBezierEasing(a, b, c, d)
    fun <T> spec(): TweenSpec<T> = tween(ms, delay, easing)
}

/** The scale of something under a finger: down to `to` on the press spring, back when it lifts. */
@Composable
fun pressScale(source: InteractionSource, to: Float = Tokens.Scales.press): State<Float> {
    val pressed by source.collectIsPressedAsState()
    return animateFloatAsState(if (pressed) to else 1f, Tokens.Springs.press.spec(), label = "press")
}

/** One thing taking another's place in the same spot: the old one fades out through `haze` of blur, the new one comes in
 *  from it (after `wait` ms), and the box around them follows the new one's size. Nothing moves when it is first shown. */
@Composable
private fun <S> Change(state: S, modifier: Modifier, enter: TweenToken, exit: TweenToken, wait: Int, haze: Float, align: Alignment, content: @Composable (S) -> Unit) =
    AnimatedContent(
        state, modifier, contentAlignment = align, label = "change",
        transitionSpec = {
            fadeIn(tween(enter.ms, wait, enter.easing)) togetherWith fadeOut(exit.spec()) using SizeTransform(clip = false) { _, _ -> Tokens.Springs.height.spec() }
        },
    ) { shown ->
        val blur by transition.animateFloat({ if (targetState == EnterExitState.Visible) tween(enter.ms, wait, enter.easing) else exit.spec() }, label = "blur") {
            if (it == EnterExitState.Visible) 0f else haze
        }
        Box(Modifier.blur(blur.dp, BlurredEdgeTreatment.Unbounded)) { content(shown) }
    }

/** A label or an icon taking another's place (Save, then Saving…): both at once, through a light blur. */
@Composable
fun <S> Swap(state: S, modifier: Modifier = Modifier, content: @Composable (S) -> Unit) =
    Change(state, modifier, Tokens.Tweens.swap, Tokens.Tweens.swap, 0, Tokens.Blurs.icon, Alignment.Center, content)

/** A whole panel giving way to the next (a form, then what became of it): the one leaving goes first, then the next
 *  comes in where it was. */
@Composable
fun <S> Panels(state: S, modifier: Modifier = Modifier, content: @Composable (S) -> Unit) =
    Change(state, modifier, Tokens.Tweens.panelIn, Tokens.Tweens.panelOut, Tokens.Tweens.panelOut.ms, Tokens.Blurs.panel, Alignment.TopStart, content)

/** Something that is there or not, opening and closing its own space as it fades (the web's Auto Height). */
@Composable
fun Unfolding(shown: Boolean, modifier: Modifier = Modifier, content: @Composable () -> Unit) = AnimatedVisibility(
    shown, modifier,
    enter = expandVertically(Tokens.Springs.height.spec()) + fadeIn(Tokens.Tweens.reveal.spec()),
    exit = shrinkVertically(Tokens.Springs.height.spec()) + fadeOut(Tokens.Tweens.fade.spec()),
) { content() }

/** Something popping in where it stands, once, as it is first shown (a check landing). */
@Composable
fun PopIn(content: @Composable () -> Unit) = AnimatedVisibility(
    remember { MutableTransitionState(false).apply { targetState = true } },
    enter = scaleIn(Tokens.Springs.checkPop.spec(), Tokens.Scales.icon) + fadeIn(Tokens.Tweens.fade.spec()),
) { content() }

/** A field saying "no": a few dying swings, once per `go()`. `x` is how far it stands off, in dp. */
class Shake {
    private val swing = Animatable(0f)
    val x get() = swing.value

    suspend fun go() {
        swing.snapTo(0f)
        swing.animateTo(0f, keyframes {
            val shake = Tokens.Tweens.shake
            val far = Tokens.Shifts.shake
            durationMillis = shake.ms
            listOf(0f, -1f, 1f, -0.66f, 0.66f, -0.33f, 0.33f, 0f).forEachIndexed { i, share -> far * share at shake.ms * i / 7 using shake.easing }
        })
    }
}

/** A column's rows as `items` change: a new one unfolds as it fades in, one gone folds away as it fades, and the others
 *  close the gap. The rows there when it is first shown stand still. A row brings its own space under it (padding in
 *  `content`), so the space folds with it. */
@Composable
fun <T> AnimatedRows(items: List<T>, id: (T) -> Any, content: @Composable (T) -> Unit) {
    class Row(val id: Any, item: T, shown: Boolean) {
        var item by mutableStateOf(item)
        val visible = MutableTransitionState(shown).apply { targetState = true }
    }
    val rows = remember { mutableStateListOf<Row>().apply { items.forEach { add(Row(id(it), it, shown = true)) } } }
    LaunchedEffect(items) {
        val had = rows.toList()
        val next = items.map { item ->
            had.firstOrNull { it.id == id(item) }?.also { it.item = item; it.visible.targetState = true } ?: Row(id(item), item, shown = false)
        }.toMutableList()
        // A row that is gone stays where it was, after the row it followed, while it folds away.
        had.forEachIndexed { i, row ->
            if (row in next) return@forEachIndexed
            row.visible.targetState = false
            val before = had.take(i).lastOrNull { it in next }
            next.add(if (before == null) 0 else next.indexOf(before) + 1, row)
        }
        rows.clear()
        rows.addAll(next)
    }
    for (row in rows) key(row.id) {
        AnimatedVisibility(
            row.visible,
            enter = fadeIn(Tokens.Tweens.fade.spec()) + expandVertically(Tokens.Springs.reflow.spec()),
            exit = fadeOut(Tokens.Tweens.fade.spec()) + shrinkVertically(Tokens.Springs.reflow.spec()),
        ) { content(row.item) }
        val gone = !row.visible.currentState && !row.visible.targetState
        LaunchedEffect(gone) { if (gone) rows.remove(row) }
    }
}
