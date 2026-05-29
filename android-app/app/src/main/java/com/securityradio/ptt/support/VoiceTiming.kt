package com.securityradio.ptt.support

/**
 * Cross-platform voice / air timing — keep in sync with [docs/voice-timing.md].
 *
 * Poll intervals here match iOS [VoiceTiming.swift] and web [voiceTiming.ts].
 */
object VoiceTiming {
    /** Server `/v1/air` TTL when `release_air` is not sent. */
    const val VOICE_AIR_TTL_MS = 900L

    /** Gap between inbound voice frames that starts a new talk-spurt. */
    const val TALK_SPURT_GAP_MS = 300L

    /** RX replay / last-RX segmentation — same as talk-spurt gap on other clients. */
    const val RX_GAP_MS = TALK_SPURT_GAP_MS

    /** Nanosecond form for [System.nanoTime] comparisons. */
    const val TALK_SPURT_GAP_NS = TALK_SPURT_GAP_MS * 1_000_000L

    /** Poll `/v1/air` while PTT is held. */
    const val AIR_POLL_WHILE_PTT_MS = 250L

    /** Default talk-activity poll (idle). */
    const val TALK_ACTIVITY_POLL_MS = 1200L

    /** Faster talk-activity poll while someone appears on air or PTT held. */
    const val TALK_ACTIVITY_FAST_POLL_MS = 400L

    const val INBOX_POLL_MS = 2000L
    const val PRESENCE_POLL_MS = 12_000L
    const val CATALOG_POLL_MS = 15_000L
}
