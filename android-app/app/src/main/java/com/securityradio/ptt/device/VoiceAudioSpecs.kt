package com.securityradio.ptt.device

import android.media.AudioFormat

/** Shared PCM format for uplink/downlink (mono 16 kHz PCM16). */
object VoiceAudioSpecs {
    const val SAMPLE_RATE_HZ = 16_000
    val PCM_ENCODING: Int = AudioFormat.ENCODING_PCM_16BIT
}
