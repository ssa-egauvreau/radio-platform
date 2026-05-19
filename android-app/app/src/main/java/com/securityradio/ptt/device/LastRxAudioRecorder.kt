package com.securityradio.ptt.device

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * Records the most recent completed inbound voice transmission (PCM 16 kHz mono)
 * and can play it back on demand (hardware "replay last message").
 */
class LastRxAudioRecorder {

    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()

    private val currentChunks = ArrayList<ByteArray>(64)
    private var currentBytes = 0
    private var lastChunkAtMs = 0L
    private var lastCompletePcm = ByteArray(0)

    private var replayTrack: AudioTrack? = null

    /** Append peer PCM from the voice relay (not local sidetone). */
    fun onInboundPcm(chunk: ByteArray) {
        if (chunk.isEmpty()) return
        val now = SystemClock.elapsedRealtime()
        synchronized(lock) {
            if (lastChunkAtMs > 0L && now - lastChunkAtMs > RX_GAP_MS) {
                finalizeCurrentTransmissionLocked()
                currentChunks.clear()
                currentBytes = 0
            }
            lastChunkAtMs = now
            val room = MAX_TRANSMISSION_BYTES - currentBytes
            if (room <= 0) return
            val take = minOf(chunk.size, room)
            if (take < chunk.size) {
                currentChunks.add(chunk.copyOfRange(0, take))
            } else {
                currentChunks.add(chunk)
            }
            currentBytes += take
        }
    }

    fun hasLastTransmission(): Boolean =
        synchronized(lock) { lastCompletePcm.size >= MIN_TRANSMISSION_BYTES }

    /** Play the last completed RX transmission; returns false if none stored. */
    fun playLast(): Boolean {
        val pcm = synchronized(lock) {
            finalizeCurrentTransmissionLocked()
            if (lastCompletePcm.size < MIN_TRANSMISSION_BYTES) {
                return false
            }
            lastCompletePcm.copyOf()
        }
        main.post {
            stopReplayLocked()
            val track = createReplayTrack() ?: return@post
            replayTrack = track
            try {
                var offset = 0
                while (offset < pcm.size) {
                    val wrote = track.write(pcm, offset, pcm.size - offset)
                    if (wrote <= 0) break
                    offset += wrote
                }
                track.setPlaybackPositionUpdateListener(
                    object : AudioTrack.OnPlaybackPositionUpdateListener {
                        override fun onMarkerReached(track: AudioTrack?) {
                            stopReplayLocked()
                        }

                        override fun onPeriodicNotification(track: AudioTrack?) {}
                    },
                )
                val frames = pcm.size / 2
                if (frames > 0) {
                    track.notificationMarkerPosition = frames
                }
            } catch (_: Exception) {
                stopReplayLocked()
            }
        }
        return true
    }

    fun stopReplay() {
        main.post { stopReplayLocked() }
    }

    fun release() {
        main.post {
            stopReplayLocked()
            synchronized(lock) {
                currentChunks.clear()
                currentBytes = 0
                lastCompletePcm = ByteArray(0)
            }
        }
    }

    private fun finalizeCurrentTransmissionLocked() {
        if (currentBytes < MIN_TRANSMISSION_BYTES) {
            currentChunks.clear()
            currentBytes = 0
            return
        }
        val merged = ByteArray(currentBytes)
        var pos = 0
        for (chunk in currentChunks) {
            System.arraycopy(chunk, 0, merged, pos, chunk.size)
            pos += chunk.size
        }
        lastCompletePcm = merged
        currentChunks.clear()
        currentBytes = 0
    }

    private fun stopReplayLocked() {
        replayTrack?.runCatching {
            setPlaybackPositionUpdateListener(null)
            if (playState == AudioTrack.PLAYSTATE_PLAYING) {
                pause()
                flush()
            }
            release()
        }
        replayTrack = null
    }

    private fun createReplayTrack(): AudioTrack? {
        val minBuf = AudioTrack.getMinBufferSize(
            VoiceAudioSpecs.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_OUT_MONO,
            VoiceAudioSpecs.PCM_ENCODING,
        )
        if (minBuf <= 0) return null
        val bufBytes = maxOf(minBuf * 4, minBuf + 8192)
        val t =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setSampleRate(VoiceAudioSpecs.SAMPLE_RATE_HZ)
                            .setEncoding(VoiceAudioSpecs.PCM_ENCODING)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    )
                    .setBufferSizeInBytes(bufBytes)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                AudioTrack(
                    VoiceAudioSpecs.LEGACY_STREAM_MUSIC,
                    VoiceAudioSpecs.SAMPLE_RATE_HZ,
                    AudioFormat.CHANNEL_OUT_MONO,
                    VoiceAudioSpecs.PCM_ENCODING,
                    bufBytes,
                    AudioTrack.MODE_STREAM,
                )
            }
        if (t.state != AudioTrack.STATE_INITIALIZED) {
            t.release()
            return null
        }
        t.play()
        return t
    }

    private companion object {
        const val RX_GAP_MS = 500L
        const val MAX_TRANSMISSION_BYTES = 30 * VoiceAudioSpecs.SAMPLE_RATE_HZ * 2
        const val MIN_TRANSMISSION_BYTES = VoiceAudioSpecs.SAMPLE_RATE_HZ / 5 * 2
    }
}
