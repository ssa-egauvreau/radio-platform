package com.securityradio.ptt.device

import android.util.Log
import org.concentus.OpusApplication
import org.concentus.OpusDecoder as ConcentusOpusDecoder
import org.concentus.OpusEncoder as ConcentusOpusEncoder

/**
 * Opus encoder + decoder wrapping the Concentus pure-Java Opus port
 * (com.github.lostromb:concentus on JitPack; see app/build.gradle.kts).
 *
 * Pure-Java was chosen for the first cut so the codec ships without an
 * NDK build for libopus; CPU cost on a typical handset for the voice
 * profile below is ~1 ms / 20 ms frame, which is fine for PTT. If a
 * customer hits a CPU ceiling we can swap to libopus via NDK without
 * touching the [VoiceCodecRegistry] wiring.
 *
 * Voice profile:
 *  - sample rate: 16 000 Hz (matches existing 16 kHz uplink/downlink)
 *  - channels: 1 (mono)
 *  - frame size: 20 ms (320 samples) — matches the relay's 20 ms cadence
 *  - bitrate: 20 kbps (wideband sweet spot for clear speech with FEC headroom)
 *  - application: VOIP
 *  - FEC: enabled for resilience to a single-frame loss
 *
 * Wire format: 2-byte magic (0x4F 0x70) + opaque Opus packet. Packet size
 * varies per frame (DTX, complexity), so receivers identify the codec by
 * magic — not by length — on RX.
 */

private const val OPUS_SAMPLE_RATE = 16_000
private const val OPUS_FRAME_SAMPLES = 320  // 20 ms @ 16 kHz
private const val OPUS_BITRATE = 20_000
private const val OPUS_MAX_PACKET_BYTES = 1275  // libopus / Concentus maximum
private const val TAG = "OpusVoiceCodec"

class OpusEncoder : VoiceEncoder {
    override val codec: VoiceCodec = VoiceCodec.OPUS

    private val lock = Any()
    private var encoder: ConcentusOpusEncoder? = null
    private val scratch = ByteArray(OPUS_MAX_PACKET_BYTES)

    init {
        encoder = try {
            ConcentusOpusEncoder(OPUS_SAMPLE_RATE, 1, OpusApplication.OPUS_APPLICATION_VOIP).apply {
                bitrate = OPUS_BITRATE
                useInbandFEC = true
            }
        } catch (e: Throwable) {
            // Concentus jar missing, version mismatch, or constructor threw.
            // Registry falls back to IMBE on TX; logged once at startup so the
            // failure is visible without spamming on every frame.
            Log.w(TAG, "Opus encoder unavailable — falling back to IMBE on TX", e)
            null
        }
    }

    override val isReady: Boolean
        get() = encoder != null

    override fun resetForTalkSpurt() {
        // Concentus has no exposed "reset state" call; constructing a fresh
        // encoder at every talk-spurt boundary is expensive (allocations + the
        // VOIP application setup), so we accept the per-spurt warm-up artefact
        // and leave the prediction state in place. PTT half-duplex means the
        // gap is at least 300 ms so warm-up is rarely audible.
    }

    override fun encodeFrame(pcm16kLe640: ByteArray): ByteArray? {
        val enc = encoder ?: return null
        if (pcm16kLe640.size < OPUS_FRAME_SAMPLES * 2) return null

        // Convert LE bytes → shorts for Concentus.
        val pcm = ShortArray(OPUS_FRAME_SAMPLES)
        var bi = 0
        for (i in 0 until OPUS_FRAME_SAMPLES) {
            val lo = pcm16kLe640[bi].toInt() and 0xFF
            val hi = pcm16kLe640[bi + 1].toInt()
            pcm[i] = ((lo or (hi shl 8))).toShort()
            bi += 2
        }

        val packetLen = synchronized(lock) {
            try {
                enc.encode(pcm, 0, OPUS_FRAME_SAMPLES, scratch, 0, scratch.size)
            } catch (e: Throwable) {
                Log.w(TAG, "Opus encode threw — dropping frame", e)
                return@synchronized -1
            }
        }
        if (packetLen <= 0) return null

        val packet = ByteArray(2 + packetLen)
        packet[0] = codec.magic0
        packet[1] = codec.magic1
        System.arraycopy(scratch, 0, packet, 2, packetLen)
        return packet
    }
}

class OpusDecoder : VoiceDecoder {
    override val codec: VoiceCodec = VoiceCodec.OPUS
    override val nativeSampleRate: Int = OPUS_SAMPLE_RATE

    private val lock = Any()
    private var decoder: ConcentusOpusDecoder? = null
    private val scratch = ShortArray(OPUS_FRAME_SAMPLES)

    init {
        decoder = try {
            ConcentusOpusDecoder(OPUS_SAMPLE_RATE, 1)
        } catch (e: Throwable) {
            Log.w(TAG, "Opus decoder unavailable — inbound Opus frames will drop", e)
            null
        }
    }

    override val isReady: Boolean
        get() = decoder != null

    override fun decodeFrame(framedBytes: ByteArray): ShortArray? {
        val dec = decoder ?: return null
        if (framedBytes.size < 3) return null
        if (framedBytes[0] != codec.magic0 || framedBytes[1] != codec.magic1) return null

        // Strip the magic, hand the raw Opus payload to Concentus.
        val payloadLen = framedBytes.size - 2
        val out = ShortArray(OPUS_FRAME_SAMPLES)

        val produced = synchronized(lock) {
            try {
                dec.decode(framedBytes, 2, payloadLen, out, 0, OPUS_FRAME_SAMPLES, false)
            } catch (e: Throwable) {
                Log.w(TAG, "Opus decode threw — dropping frame", e)
                return@synchronized -1
            }
        }
        if (produced <= 0) return null
        // Concentus may return fewer samples than the buffer holds (rare, for
        // sub-frame Opus configs); copy out only what was filled so the
        // transport's upsample / playback paces correctly.
        return if (produced == OPUS_FRAME_SAMPLES) out else out.copyOf(produced)
    }
}
