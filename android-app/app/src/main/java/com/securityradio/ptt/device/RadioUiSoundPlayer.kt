package com.securityradio.ptt.device

/**
 * Plays short UI cues from packaged assets. Implementations must be safe if files are missing.
 *
 * Busy tone ([startBusyLoop]) loops while air is unavailable. Talk permit plays **once** after the
 * server grants the channel ([playTalkPermitThen]); microphone capture should begin **after**
 * `onFinished` runs (implementations invoke it on the main thread).
 */
interface RadioUiSoundPlayer {
    /**
     * @param onFinished Optional: invoked on the main thread when the beep ends. Pair with TTS so the
     * channel-name announcement starts AFTER the beep instead of stomping it.
     */
    fun playChannelSwitch(onFinished: (() -> Unit)? = null)
    /**
     * @param onStarted Invoked when the permit WAV actually begins playback (same moment as audio).
     * @param onFinished Invoked when playback ends; start microphone capture here.
     */
    fun playTalkPermitThen(onFinished: () -> Unit, onStarted: (() -> Unit)? = null)
    fun stopTalkPermitLoop()
    fun startBusyLoop()
    fun stopBusyLoop()
    /** One-shot busy/alert tone — used as the periodic lost-link alert. */
    fun playBusyTone()
    fun playEmergencyAlert()
    /** One-shot beep at the current volume level (legacy / screen). */
    fun playVolumeCheck()
    /** Loop volume-check WAV while the hardware key is held (IRC590 key 232). */
    fun startVolumeCheckLoop()
    fun stopVolumeCheckLoop()
    fun release()
}
