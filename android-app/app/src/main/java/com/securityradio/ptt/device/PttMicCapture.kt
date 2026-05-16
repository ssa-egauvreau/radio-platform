package com.securityradio.ptt.device

/**
 * Captures microphone PCM while the operator holds PTT.
 *
 * [AudioRecordPttCapture] can mirror audio locally (sidetone) and forward PCM to [StreamingPcmSink].
 */
interface PttMicCapture {
    fun startCapture()
    fun stopCapture()
    fun release()
}
