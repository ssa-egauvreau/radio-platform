package com.securityradio.ptt.ui.lcd

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val iconStroke = Stroke(width = 1.35f, cap = StrokeCap.Round)
private val toolbarStroke = Stroke(width = 1.85f, cap = StrokeCap.Round)

@Composable
fun LcdSignalBarsIcon(
    bars: Int,
    maxBars: Int,
    colorActive: Color,
    colorInactive: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        val gap = 2.dp.toPx()
        val barWidth = 3.2.dp.toPx()
        val maxH = size.height * 0.85f
        val baseY = size.height * 0.92f
        repeat(maxBars) { index ->
            val active = index < bars.coerceIn(0, maxBars)
            val h = maxH * (0.35f + 0.16f * index)
            val x = index * (barWidth + gap)
            drawRoundRect(
                color = if (active) colorActive else colorInactive,
                topLeft = Offset(x, baseY - h),
                size = Size(barWidth, h),
                cornerRadius = CornerRadius(1.dp.toPx(), 1.dp.toPx()),
            )
        }
    }
}

@Composable
fun LcdGpsIcon(
    active: Color,
    muted: Color,
    locked: Boolean,
    modifier: Modifier = Modifier,
) {
    val stroke = toolbarStroke
    Canvas(modifier) {
        val c = if (locked) active else muted
        val cx = size.width * 0.5f
        val cy = size.height * 0.5f
        val r = size.minDimension * 0.32f
        drawCircle(color = c, radius = r, style = stroke)
        drawLine(
            color = c,
            start = Offset(cx, cy - r * 1.35f),
            end = Offset(cx, cy + r * 1.35f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = c,
            start = Offset(cx - r * 1.35f, cy),
            end = Offset(cx + r * 1.35f, cy),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
fun LcdScanIcon(
    active: Color,
    muted: Color,
    on: Boolean,
    modifier: Modifier = Modifier,
) {
    val stroke = iconStroke
    Canvas(modifier) {
        val c = if (on) active else muted
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(w * 0.18f, h * 0.55f)
            lineTo(w * 0.42f, h * 0.32f)
            lineTo(w * 0.58f, h * 0.68f)
            lineTo(w * 0.82f, h * 0.45f)
        }
        drawPath(path, color = c, style = stroke)
    }
}

@Composable
fun LcdMicIcon(
    color: Color,
    modifier: Modifier = Modifier,
) {
    val stroke = iconStroke
    Canvas(modifier) {
        val cx = size.width * 0.5f
        val bodyW = size.width * 0.38f
        val bodyH = size.height * 0.42f
        val top = size.height * 0.22f
        drawRoundRect(
            color = color,
            topLeft = Offset(cx - bodyW * 0.5f, top),
            size = Size(bodyW, bodyH),
            cornerRadius = CornerRadius(bodyW * 0.5f, bodyW * 0.5f),
            style = stroke,
        )
        drawLine(
            color = color,
            start = Offset(cx, top + bodyH),
            end = Offset(cx, size.height * 0.78f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = color,
            start = Offset(cx - bodyW * 0.55f, size.height * 0.78f),
            end = Offset(cx + bodyW * 0.55f, size.height * 0.78f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
fun LcdEmergencyGlyphIcon(
    color: Color,
    modifier: Modifier = Modifier,
) {
    val stroke = iconStroke
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(w * 0.5f, h * 0.18f)
            lineTo(w * 0.78f, h * 0.82f)
            lineTo(w * 0.22f, h * 0.82f)
            close()
        }
        drawPath(path, color = color, style = stroke)
        drawLine(
            color = color,
            start = Offset(w * 0.5f, h * 0.38f),
            end = Offset(w * 0.5f, h * 0.58f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = color,
            start = Offset(w * 0.5f, h * 0.64f),
            end = Offset(w * 0.5f, h * 0.68f),
            strokeWidth = stroke.width * 1.1f,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
fun LcdListChannelIcon(
    color: Color,
    modifier: Modifier = Modifier,
) {
    val stroke = iconStroke
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        repeat(3) { i ->
            val y = h * (0.28f + i * 0.2f)
            drawLine(
                color = color,
                start = Offset(w * 0.18f, y),
                end = Offset(w * 0.82f, y),
                strokeWidth = stroke.width * 0.9f,
                cap = StrokeCap.Round,
            )
        }
        drawLine(
            color = color,
            start = Offset(w * 0.72f, h * 0.22f),
            end = Offset(w * 0.72f, h * 0.78f),
            strokeWidth = stroke.width,
            cap = StrokeCap.Round,
        )
    }
}

@Composable
fun LcdBluetoothIcon(
    on: Boolean,
    active: Color,
    muted: Color,
    modifier: Modifier = Modifier,
) {
    val stroke = toolbarStroke
    val c = if (on) active else muted
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val stemX = w * 0.34f
        val midY = h * 0.5f
        drawCircle(color = c, radius = w * 0.11f, center = Offset(stemX, midY), style = stroke)
        val wing = Path().apply {
            moveTo(stemX + w * 0.1f, midY - h * 0.28f)
            lineTo(w * 0.92f, midY - h * 0.42f)
            lineTo(w * 0.78f, midY)
            lineTo(w * 0.92f, midY + h * 0.42f)
            lineTo(stemX + w * 0.1f, midY + h * 0.28f)
            close()
        }
        drawPath(wing, color = c, style = stroke)
    }
}

@Composable
fun LcdReplayIcon(
    ready: Color,
    muted: Color,
    hasBuffer: Boolean,
    modifier: Modifier = Modifier,
) {
    val stroke = toolbarStroke
    val c = if (hasBuffer) ready else muted
    Canvas(modifier) {
        val cx = size.width * 0.5f
        val cy = size.height * 0.5f
        val r = size.minDimension * 0.36f
        // Most of a circle, leaving a gap for the arrowhead — a circular arrow.
        drawArc(
            color = c,
            startAngle = 105f,
            sweepAngle = 300f,
            useCenter = false,
            topLeft = Offset(cx - r, cy - r),
            size = Size(r * 2, r * 2),
            style = stroke,
        )
        // Filled triangular arrowhead at the arc end, tangent to the circle.
        val endRad = (105f + 300f) * PI.toFloat() / 180f
        val ex = cx + cos(endRad) * r
        val ey = cy + sin(endRad) * r
        val tanX = cos(endRad + PI.toFloat() / 2f)
        val tanY = sin(endRad + PI.toFloat() / 2f)
        val radX = cos(endRad)
        val radY = sin(endRad)
        val len = r * 0.85f
        val wid = r * 0.52f
        val head = Path().apply {
            moveTo(ex + tanX * len * 0.5f, ey + tanY * len * 0.5f)
            lineTo(ex - tanX * len * 0.5f + radX * wid, ey - tanY * len * 0.5f + radY * wid)
            lineTo(ex - tanX * len * 0.5f - radX * wid, ey - tanY * len * 0.5f - radY * wid)
            close()
        }
        drawPath(head, color = c)
    }
}

@Composable
fun LcdVolumeIcon(
    muted: Color,
    active: Color,
    isMuted: Boolean,
    modifier: Modifier = Modifier,
) {
    val stroke = toolbarStroke
    val c = if (isMuted) muted else active
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val speaker = Path().apply {
            moveTo(w * 0.16f, h * 0.38f)
            lineTo(w * 0.34f, h * 0.38f)
            lineTo(w * 0.52f, h * 0.22f)
            lineTo(w * 0.52f, h * 0.78f)
            lineTo(w * 0.34f, h * 0.62f)
            lineTo(w * 0.16f, h * 0.62f)
            close()
        }
        drawPath(speaker, color = c, style = stroke)
        if (!isMuted) {
            drawArc(
                color = c,
                startAngle = -55f,
                sweepAngle = 70f,
                useCenter = false,
                topLeft = Offset(w * 0.5f, h * 0.28f),
                size = Size(w * 0.38f, h * 0.44f),
                style = stroke,
            )
            drawArc(
                color = c,
                startAngle = -60f,
                sweepAngle = 80f,
                useCenter = false,
                topLeft = Offset(w * 0.58f, h * 0.2f),
                size = Size(w * 0.42f, h * 0.6f),
                style = stroke,
            )
        } else {
            drawLine(
                color = c,
                start = Offset(w * 0.62f, h * 0.3f),
                end = Offset(w * 0.9f, h * 0.72f),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
fun LcdDayNightIcon(
    night: Boolean,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val stroke = iconStroke
    Canvas(modifier) {
        val cx = size.width * 0.5f
        val cy = size.height * 0.5f
        val r = size.minDimension * 0.38f
        if (night) {
            // Crescent moon: a filled disc with an offset disc subtracted.
            val moon = Path().apply {
                addOval(Rect(cx - r, cy - r, cx + r, cy + r))
            }
            val biteR = r * 1.02f
            val biteCx = cx + r * 0.64f
            val biteCy = cy - r * 0.16f
            val bite = Path().apply {
                addOval(Rect(biteCx - biteR, biteCy - biteR, biteCx + biteR, biteCy + biteR))
            }
            drawPath(
                Path().apply { op(moon, bite, PathOperation.Difference) },
                color = color,
            )
        } else {
            // Sun: a filled disc with eight rays.
            drawCircle(
                color = color,
                radius = r * 0.6f,
                center = Offset(cx, cy),
            )
            repeat(8) { i ->
                val ang = i * 45f * PI.toFloat() / 180f
                val dx = cos(ang)
                val dy = sin(ang)
                drawLine(
                    color = color,
                    start = Offset(cx + dx * r * 0.82f, cy + dy * r * 0.82f),
                    end = Offset(cx + dx * r * 1.2f, cy + dy * r * 1.2f),
                    strokeWidth = stroke.width * 1.1f,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}
