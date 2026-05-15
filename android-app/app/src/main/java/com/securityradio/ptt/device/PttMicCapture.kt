package com.securityradio.ptt.device

/**
 * Captures microphone PCM while the operator holds PTT.
 *
 * Roadmap:
 * - Step A (current): local sidetone in [AudioRecordPttCapture] — hear yourself on this device.
 * - Step B (next): send PCM to the server for other devices on the same channel.
 */
interface PttMicCapture {
    fun startCapture()
    fun stopCapture()
    fun release()
}
