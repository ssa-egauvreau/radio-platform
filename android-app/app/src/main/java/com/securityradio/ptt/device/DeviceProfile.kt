package com.securityradio.ptt.device

import android.os.Build
import java.util.Locale

/** User-selectable profile; [AUTO] picks a known handset from [Build.MODEL]. */
enum class DeviceProfilePreference(val label: String) {
    AUTO("Auto-detect"),
    RESPONSIVE("Responsive (default)"),
    S200("Inrico S200"),
    TM7_PLUS("Inrico TM-7 Plus"),
    IRC590("Inrico IRC590"),
}

/** Effective handset layout after resolving [DeviceProfilePreference]. */
enum class ResolvedDeviceProfile(val label: String) {
    RESPONSIVE("Responsive"),
    S200("Inrico S200"),
    TM7_PLUS("Inrico TM-7 Plus"),
    IRC590("Inrico IRC590"),
}

/**
 * Explicit layout rules for rugged handsets. When [ResolvedDeviceProfile.RESPONSIVE] is active,
 * [com.securityradio.ptt.ui.RadioScreen] still derives a policy from width breakpoints.
 */
data class RadioLayoutPolicy(
    val showSoftKeyRow: Boolean,
    val showStateBanner: Boolean,
    val showFullStatusBar: Boolean,
    val showChannelTunerButtons: Boolean,
    val showMainDetailLines: Boolean,
    val showRadiosOnlineLine: Boolean,
    val showScanConfigureLink: Boolean,
    val softKeysTwoRows: Boolean,
    val compactSpacing: Boolean,
    val compactPtt: Boolean,
    val minimalStatusBar: Boolean,
)

object DeviceProfileResolver {

    fun resolve(preference: DeviceProfilePreference, model: String = Build.MODEL): ResolvedDeviceProfile {
        return when (preference) {
            DeviceProfilePreference.RESPONSIVE -> ResolvedDeviceProfile.RESPONSIVE
            DeviceProfilePreference.S200 -> ResolvedDeviceProfile.S200
            DeviceProfilePreference.TM7_PLUS -> ResolvedDeviceProfile.TM7_PLUS
            DeviceProfilePreference.IRC590 -> ResolvedDeviceProfile.IRC590
            DeviceProfilePreference.AUTO -> detectFromModel(model)
        }
    }

    fun layoutPolicy(profile: ResolvedDeviceProfile): RadioLayoutPolicy = when (profile) {
        ResolvedDeviceProfile.S200 -> RadioLayoutPolicy(
            showSoftKeyRow = true,
            showStateBanner = false,
            showFullStatusBar = true,
            showChannelTunerButtons = true,
            showMainDetailLines = false,
            showRadiosOnlineLine = false,
            showScanConfigureLink = false,
            softKeysTwoRows = false,
            compactSpacing = true,
            compactPtt = true,
            minimalStatusBar = false,
        )
        ResolvedDeviceProfile.TM7_PLUS -> RadioLayoutPolicy(
            showSoftKeyRow = true,
            showStateBanner = false,
            showFullStatusBar = true,
            showChannelTunerButtons = true,
            showMainDetailLines = false,
            showRadiosOnlineLine = false,
            showScanConfigureLink = false,
            softKeysTwoRows = true,
            compactSpacing = true,
            compactPtt = true,
            minimalStatusBar = false,
        )
        ResolvedDeviceProfile.IRC590 -> RadioLayoutPolicy(
            showSoftKeyRow = false,
            showStateBanner = false,
            showFullStatusBar = false,
            showChannelTunerButtons = false,
            showMainDetailLines = false,
            showRadiosOnlineLine = false,
            showScanConfigureLink = false,
            softKeysTwoRows = false,
            compactSpacing = true,
            compactPtt = true,
            minimalStatusBar = true,
        )
        ResolvedDeviceProfile.RESPONSIVE -> responsivePolicy(isCompact = false, isUltraCompact = false)
    }

    fun responsivePolicy(isCompact: Boolean, isUltraCompact: Boolean): RadioLayoutPolicy {
        if (isUltraCompact) {
            return RadioLayoutPolicy(
                showSoftKeyRow = false,
                showStateBanner = false,
                showFullStatusBar = false,
                showChannelTunerButtons = false,
                showMainDetailLines = false,
                showRadiosOnlineLine = false,
                showScanConfigureLink = false,
                softKeysTwoRows = false,
                compactSpacing = true,
                compactPtt = true,
                minimalStatusBar = true,
            )
        }
        return RadioLayoutPolicy(
            showSoftKeyRow = true,
            showStateBanner = true,
            showFullStatusBar = true,
            showChannelTunerButtons = true,
            showMainDetailLines = true,
            showRadiosOnlineLine = true,
            showScanConfigureLink = true,
            softKeysTwoRows = false,
            compactSpacing = isCompact,
            compactPtt = isCompact,
            minimalStatusBar = false,
        )
    }

    fun defaultKeyCodes(profile: ResolvedDeviceProfile, action: HardwareAction): Set<Int> = when (profile) {
        ResolvedDeviceProfile.IRC590 -> irc590Defaults(action)
        ResolvedDeviceProfile.S200,
        ResolvedDeviceProfile.TM7_PLUS,
        ResolvedDeviceProfile.RESPONSIVE,
        -> s200StyleDefaults(action)
    }

    private fun detectFromModel(model: String): ResolvedDeviceProfile {
        val m = model.uppercase(Locale.US)
        return when {
            m.contains("IRC590") || m.contains("IRC-590") -> ResolvedDeviceProfile.IRC590
            m.contains("TM-7") || m.contains("TM7") -> ResolvedDeviceProfile.TM7_PLUS
            m.contains("S200") || m.contains("S-200") -> ResolvedDeviceProfile.S200
            else -> ResolvedDeviceProfile.RESPONSIVE
        }
    }

    /** Inrico S-200 / TM-7 Plus factory-style defaults. */
    private fun s200StyleDefaults(action: HardwareAction): Set<Int> = when (action) {
        HardwareAction.PTT -> setOf(229)
        HardwareAction.EMERGENCY -> setOf(141)
        HardwareAction.CHANNEL_UP -> setOf(230)
        HardwareAction.CHANNEL_DOWN -> setOf(232)
        HardwareAction.SCAN_TOGGLE -> setOf(137)
        HardwareAction.PLAY_LAST_TRANSMISSION -> emptySet()
    }

    /** IRC590 physical side keys (programmable 1/2 → scan / replay). */
    private fun irc590Defaults(action: HardwareAction): Set<Int> = when (action) {
        HardwareAction.EMERGENCY -> setOf(233)
        HardwareAction.CHANNEL_UP -> setOf(235)
        HardwareAction.CHANNEL_DOWN -> setOf(234)
        HardwareAction.SCAN_TOGGLE -> setOf(230)
        HardwareAction.PLAY_LAST_TRANSMISSION -> setOf(232)
        HardwareAction.PTT -> emptySet()
    }
}
