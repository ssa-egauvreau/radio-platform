package com.securityradio.ptt.support

import org.junit.Assert.assertEquals
import org.junit.Test

/** Guards parity with `docs/voice-timing.md` and other clients. */
class VoiceTimingTest {
    @Test
    fun constants_matchVoiceTimingDoc() {
        assertEquals(900L, VoiceTiming.VOICE_AIR_TTL_MS)
        assertEquals(300L, VoiceTiming.TALK_SPURT_GAP_MS)
        assertEquals(VoiceTiming.TALK_SPURT_GAP_MS, VoiceTiming.RX_GAP_MS)
        assertEquals(300_000_000L, VoiceTiming.TALK_SPURT_GAP_NS)
        assertEquals(250L, VoiceTiming.AIR_POLL_WHILE_PTT_MS)
        assertEquals(1200L, VoiceTiming.TALK_ACTIVITY_POLL_MS)
        assertEquals(400L, VoiceTiming.TALK_ACTIVITY_FAST_POLL_MS)
        assertEquals(2000L, VoiceTiming.INBOX_POLL_MS)
        assertEquals(12_000L, VoiceTiming.PRESENCE_POLL_MS)
    }
}
