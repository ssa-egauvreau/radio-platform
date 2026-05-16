package com.securityradio.ptt.device

/**
 * Consumers of PCM from [AudioRecordPttCapture]; used to stream mic audio to peers.
 */
fun interface StreamingPcmSink {
    fun consumePcm(buffer: ByteArray, length: Int)
}
