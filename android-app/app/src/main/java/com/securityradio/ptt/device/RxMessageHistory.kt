package com.securityradio.ptt.device

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Rolling buffer of recent inbound voice transmissions for the message-history screen.
 * PCM is stored locally; [caption] / [transcript] come from RX attribution at capture time.
 */
class RxMessageHistory {

    data class Entry(
        val id: Long,
        val capturedAtMs: Long,
        val channelName: String,
        val caption: String,
        val transcript: String,
        val pcm: ByteArray,
        val durationMs: Long,
    )

    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    private val entries = ArrayDeque<Entry>()
    private var nextId = 1L
    private var replayTrack: AudioTrack? = null
    private var playingEntryId: Long? = null
    private var playbackPaused = false

    fun append(
        pcm: ByteArray,
        channelName: String,
        caption: String,
        capturedAtMs: Long = System.currentTimeMillis(),
    ) {
        if (pcm.size < LastRxAudioRecorder.MIN_STORE_BYTES) return
        val durationMs = pcm.size / 2 * 1000L / VoiceAudioSpecs.SAMPLE_RATE_HZ
        val transcript = caption.trim()
        synchronized(lock) {
            entries.addFirst(
                Entry(
                    id = nextId++,
                    capturedAtMs = capturedAtMs,
                    channelName = channelName.trim(),
                    caption = caption.trim(),
                    transcript = transcript,
                    pcm = pcm,
                    durationMs = durationMs,
                ),
            )
            while (entries.size > MAX_ENTRIES) {
                entries.removeLast()
            }
        }
    }

    fun snapshot(): List<Entry> = synchronized(lock) { entries.map { it.copy(pcm = it.pcm) } }

    fun isPlaying(entryId: Long): Boolean =
        synchronized(lock) {
            playingEntryId == entryId && !playbackPaused && replayTrack != null
        }

    fun isPaused(entryId: Long): Boolean =
        synchronized(lock) {
            playingEntryId == entryId && playbackPaused
        }

    fun play(entryId: Long, onFinished: () -> Unit = {}): Long {
        val pcm = synchronized(lock) {
            entries.firstOrNull { it.id == entryId }?.pcm?.copyOf()
        } ?: return 0L
        val durationMs = pcm.size / 2 * 1000L / VoiceAudioSpecs.SAMPLE_RATE_HZ
        main.post {
            stopReplayLocked(clearPlayingId = true)
            playingEntryId = entryId
            playbackPaused = false
            val track = createReplayTrack() ?: run {
                playingEntryId = null
                onFinished()
                return@post
            }
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
                            stopReplayLocked(clearPlayingId = true)
                            onFinished()
                        }

                        override fun onPeriodicNotification(track: AudioTrack?) {}
                    },
                )
                val frames = pcm.size / 2
                if (frames > 0) {
                    track.notificationMarkerPosition = frames
                }
            } catch (_: Exception) {
                stopReplayLocked(clearPlayingId = true)
                onFinished()
            }
        }
        return durationMs
    }

    fun pauseReplay() {
        main.post {
            synchronized(lock) {
                replayTrack?.runCatching {
                    if (playState == AudioTrack.PLAYSTATE_PLAYING) {
                        pause()
                    }
                }
                playbackPaused = true
            }
        }
    }

    fun resumeReplay() {
        main.post {
            synchronized(lock) {
                replayTrack?.runCatching { play() }
                playbackPaused = false
            }
        }
    }

    fun stopReplay() {
        main.post {
            stopReplayLocked(clearPlayingId = true)
        }
    }

    fun release() {
        main.post {
            stopReplayLocked(clearPlayingId = true)
            synchronized(lock) {
                entries.clear()
            }
        }
    }

    private fun stopReplayLocked(clearPlayingId: Boolean) {
        if (clearPlayingId) {
            playingEntryId = null
        }
        playbackPaused = false
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
        const val MAX_ENTRIES = 30
    }
}
