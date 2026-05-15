package com.securityradio.ptt.device

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Step A — local sidetone: while PTT is held, mic PCM is played back on this device so you can
 * verify capture. Audio is still not sent to the server (Step B will add transport).
 */
class AudioRecordPttCapture(
    private val enableSidetone: Boolean = true,
) : PttMicCapture {

    private val supervisor = SupervisorJob()
    private val scope = CoroutineScope(supervisor + Dispatchers.IO)

    @Volatile
    private var captureActive = false

    private var job: Job? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null

    override fun startCapture() {
        synchronized(this) {
            stopCaptureInternal()
            val sampleRate = SAMPLE_RATE_HZ
            val channelConfigIn = AudioFormat.CHANNEL_IN_MONO
            val channelConfigOut = AudioFormat.CHANNEL_OUT_MONO
            val audioFormat = AudioFormat.ENCODING_PCM_16BIT
            val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfigIn, audioFormat)
            if (minBuffer <= 0) {
                return
            }

            val record = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                sampleRate,
                channelConfigIn,
                audioFormat,
                minBuffer * 2,
            )
            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                return
            }

            var track: AudioTrack? = null
            if (enableSidetone) {
                val trackBuffer = AudioTrack.getMinBufferSize(sampleRate, channelConfigOut, audioFormat)
                if (trackBuffer > 0) {
                    track = AudioTrack.Builder()
                        .setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build(),
                        )
                        .setAudioFormat(
                            AudioFormat.Builder()
                                .setSampleRate(sampleRate)
                                .setEncoding(audioFormat)
                                .setChannelMask(channelConfigOut)
                                .build(),
                        )
                        .setBufferSizeInBytes(trackBuffer * 2)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build()
                    if (track.state == AudioTrack.STATE_INITIALIZED) {
                        track.setVolume(1f)
                        track.play()
                    } else {
                        track.release()
                        track = null
                    }
                }
            }

            audioRecord = record
            audioTrack = track
            record.startRecording()
            captureActive = true

            val buffer = ByteArray(minBuffer)
            job = scope.launch {
                while (isActive && captureActive && record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val read = record.read(buffer, 0, buffer.size)
                    if (read > 0 && track != null && track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        track.write(buffer, 0, read)
                    }
                }
            }
        }
    }

    override fun stopCapture() {
        synchronized(this) {
            stopCaptureInternal()
        }
    }

    private fun stopCaptureInternal() {
        captureActive = false
        job?.cancel()
        job = null
        audioRecord?.runCatching {
            if (recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                stop()
            }
            release()
        }
        audioRecord = null
        audioTrack?.runCatching {
            if (playState == AudioTrack.PLAYSTATE_PLAYING) {
                stop()
            }
            release()
        }
        audioTrack = null
    }

    override fun release() {
        stopCapture()
        supervisor.cancel()
    }

    companion object {
        const val SAMPLE_RATE_HZ = 16_000
    }
}
