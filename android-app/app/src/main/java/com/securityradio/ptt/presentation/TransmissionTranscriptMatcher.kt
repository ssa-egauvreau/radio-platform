package com.securityradio.ptt.presentation

import android.os.Build
import com.securityradio.ptt.data.remote.RadioTransmissionDto
import com.securityradio.ptt.device.RxMessageHistory.Entry as RxHistoryEntry
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Matches locally recorded RX clips to server [RadioTransmissionDto] rows and
 * picks the Whisper transcript text for message history / replay.
 */
internal object TransmissionTranscriptMatcher {

    private const val MAX_TIME_SKEW_MS = 5 * 60 * 1000L
    private const val MAX_DURATION_DELTA_MS = 20_000L

    fun parseStartedAtMs(raw: String): Long? {
        val t = raw.trim()
        if (t.isEmpty()) return null
        t.toLongOrNull()?.let { n ->
            return if (n > 1_000_000_000_000L) n else n * 1000L
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            for (candidate in isoCandidates(t)) {
                try {
                    return java.time.Instant.parse(candidate).toEpochMilli()
                } catch (_: Exception) {
                    /* try next */
                }
                try {
                    return java.time.OffsetDateTime.parse(candidate).toInstant().toEpochMilli()
                } catch (_: Exception) {
                    /* try next */
                }
            }
        }
        for (pattern in LEGACY_PATTERNS) {
            try {
                return pattern.parse(t)?.time
            } catch (_: Exception) {
                /* try next */
            }
        }
        return null
    }

    fun extractRxUnitId(caption: String): String? {
        val trimmed = caption.trim()
        if (trimmed.isEmpty()) return null
        val afterRx = trimmed.removePrefix("RX:").removePrefix("RX").trim()
        val parts = afterRx.split('•', limit = 2).map { it.trim() }.filter { it.isNotEmpty() }
        val unit = parts.firstOrNull()?.uppercase(Locale.US)?.takeIf { it.isNotEmpty() }
        return unit
    }

    fun match(entry: RxHistoryEntry, serverTx: List<RadioTransmissionDto>): RadioTransmissionDto? {
        val channel = entry.channelName.trim()
        if (channel.isEmpty()) return null
        val entryStartMs = entry.capturedAtMs - entry.durationMs
        val entryUnit = extractRxUnitId(entry.caption)
        var best: RadioTransmissionDto? = null
        var bestScore = Long.MAX_VALUE
        for (tx in serverTx) {
            if (!tx.channelName.trim().equals(channel, ignoreCase = true)) continue
            val started = parseStartedAtMs(tx.startedAt) ?: continue
            val timeDelta = kotlin.math.abs(started - entryStartMs)
            if (timeDelta > MAX_TIME_SKEW_MS) continue
            val durDelta = kotlin.math.abs(tx.durationMs - entry.durationMs)
            if (durDelta > MAX_DURATION_DELTA_MS) continue
            val txUnit = tx.unitId?.trim()?.uppercase(Locale.US).orEmpty()
            if (entryUnit != null && txUnit.isNotEmpty() && txUnit != entryUnit) continue
            val score = timeDelta + durDelta
            if (score < bestScore) {
                bestScore = score
                best = tx
            }
        }
        return best
    }

    fun matchNewestOnChannel(
        channelLabel: String,
        durationMs: Long,
        caption: String,
        capturedAtMs: Long,
        serverTx: List<RadioTransmissionDto>,
    ): RadioTransmissionDto? {
        val channel = channelLabel.trim()
        if (channel.isEmpty()) return null
        val pseudo =
            RxHistoryEntry(
                id = 0L,
                capturedAtMs = capturedAtMs,
                channelName = channel,
                caption = caption,
                transcript = "",
                pcm = ByteArray(0),
                durationMs = durationMs,
            )
        return match(pseudo, serverTx)
    }

    fun transcriptFromServer(tx: RadioTransmissionDto?): String? {
        if (tx == null) return null
        val status = tx.transcriptStatus.trim().lowercase(Locale.US)
        val text = tx.transcript?.trim().orEmpty()
        return when (status) {
            "done" -> text.ifEmpty { null }
            "pending" -> text.ifEmpty { null }
            else -> null
        }
    }

    fun resolveTranscript(
        entry: RxHistoryEntry,
        serverTx: List<RadioTransmissionDto>,
        online: Boolean,
    ): String {
        val matched = match(entry, serverTx)
        val status = matched?.transcriptStatus?.trim()?.lowercase(Locale.US).orEmpty()
        val serverText = transcriptFromServer(matched)
        when (status) {
            "done" -> {
                if (!serverText.isNullOrEmpty()) return serverText
                return "No speech detected."
            }
            "pending" -> return serverText?.takeIf { it.isNotEmpty() } ?: "Transcribing…"
            "failed" -> return "Could not transcribe this message."
            "disabled" -> return "Transcription is turned off on the server."
        }
        if (online && serverTx.isEmpty()) {
            return "Loading transcript…"
        }
        return fallbackCaptionText(entry.caption, entry.channelName)
    }

    fun resolveReplayTranscript(
        channelLabel: String,
        durationMs: Long,
        caption: String,
        capturedAtMs: Long,
        serverTx: List<RadioTransmissionDto>,
        localEntry: RxHistoryEntry?,
    ): String {
        val matched =
            localEntry?.let { match(it, serverTx) }
                ?: matchNewestOnChannel(channelLabel, durationMs, caption, capturedAtMs, serverTx)
        val status = matched?.transcriptStatus?.trim()?.lowercase(Locale.US).orEmpty()
        val serverText = transcriptFromServer(matched)
        when (status) {
            "done" -> return serverText?.takeIf { it.isNotEmpty() } ?: "No speech detected."
            "pending" -> return serverText?.takeIf { it.isNotEmpty() } ?: "Transcribing…"
            "failed" -> return "Could not transcribe this message."
            "disabled" -> return "Transcription is turned off on the server."
        }
        if (localEntry != null) {
            return resolveTranscript(localEntry, serverTx, online = true)
        }
        return caption.trim().ifBlank { "Transcribing…" }
    }

    private fun fallbackCaptionText(caption: String, channelName: String): String {
        val trimmed = caption.trim()
        if (trimmed.isEmpty()) {
            return "Voice on ${channelName.ifBlank { "channel" }} — waiting for transcript…"
        }
        val afterRx = trimmed.removePrefix("RX:").removePrefix("RX").trim()
        val parts = afterRx.split('•', limit = 2).map { it.trim() }.filter { it.isNotEmpty() }
        return when (parts.size) {
            2 -> "${parts[0]}\n${parts[1]}\n\nWaiting for transcript…"
            1 -> "${parts[0]}\n\nWaiting for transcript…"
            else -> "$afterRx\n\nWaiting for transcript…"
        }
    }

    private fun isoCandidates(raw: String): List<String> {
        val out = ArrayList<String>(4)
        out.add(raw)
        val spaced = raw.replace(' ', 'T')
        if (spaced != raw) out.add(spaced)
        val hasTimezoneOffset =
            raw.contains('+') || raw.indexOf('-', startIndex = 10) >= 0
        if (!raw.endsWith("Z", ignoreCase = true) && !hasTimezoneOffset) {
            out.add("${spaced}Z")
            out.add("${raw}Z")
        }
        return out
    }

    private val LEGACY_PATTERNS =
        listOf(
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSX", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
        )
}
