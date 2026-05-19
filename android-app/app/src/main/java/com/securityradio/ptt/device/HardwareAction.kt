package com.securityradio.ptt.device

enum class HardwareAction(val label: String) {
    PTT("Push-to-Talk"),
    EMERGENCY("Emergency Alert"),
    CHANNEL_UP("Channel Up"),
    CHANNEL_DOWN("Channel Down"),
    SCAN_TOGGLE("Scan On/Off"),
    /** Replay last attribution / voice summary (hardware-programmable like other macros). */
    PLAY_LAST_TRANSMISSION("Play Last Transmission"),
    /** Short beep at current media volume so the user can check loudness (no TX). */
    VOLUME_CHECK("Volume Check"),
    /** Cycle LCD day / night / auto theme. */
    TOGGLE_DAY_NIGHT("Day / Night"),
}
