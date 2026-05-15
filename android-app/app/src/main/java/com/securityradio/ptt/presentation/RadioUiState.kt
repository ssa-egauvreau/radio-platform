package com.securityradio.ptt.presentation

/**
 * Immutable snapshot of the radio shell. The [RadioViewModel] is the single source of truth.
 */
data class RadioUiState(
    val systemTime: String,
    val networkLabel: String,
    val batteryPercent: Int,
    val signalBars: Int,
    val maxSignalBars: Int,
    val zoneLabel: String,
    val channelLabel: String,
    val channelPosition: String,
    val totalChannels: Int,
    /** Channel names from catalog (for scan picker labels). */
    val channelCatalog: List<String>,
    /** Indices into [channelCatalog] included in scan when [scanActive] is true (never includes home channel). */
    val scanIncludedChannelIndices: Set<Int>,
    /** Multi-select picker for scan list. */
    val scanPickerVisible: Boolean,
    val displayLine1: String,
    val displayLine2: String,
    val displayLine3: String,
    val softKeyLabels: List<String>,
    val isPttPressed: Boolean,
    val isEmergencyActive: Boolean,
    val pttBusyTone: Boolean,
    val statusMessage: String,
    val channelsLoading: Boolean,
    val channelSyncError: String?,
    val channelSourceLabel: String,
    val micPermissionGranted: Boolean,
    val micHint: String,
    /** Stable short unit id for TX line (persisted). */
    val localShortUnitId: String,
    /** Server hint: formatted RX attribution when someone else is keyed (main channel wins over scan). */
    val rxAttributedLine: String,
    /** Reflective day LCD vs backlit night LCD (UI only). */
    val displayNightMode: Boolean,
    /** UI toggles for scan / GPS rows (soft keys). */
    val scanActive: Boolean,
    val gpsActive: Boolean,
    /** Soft-key RSSI detail expansion (UI only). */
    val rssiExpanded: Boolean,
    
    /** Theme settings. */
    val themeMode: ThemeMode,
    
    /** Hardware button mapping settings. */
    val mappingSettingsVisible: Boolean,
    val hardwareMappings: Map<com.securityradio.ptt.device.HardwareAction, Set<Int>>,
    val currentlyMappingAction: com.securityradio.ptt.device.HardwareAction?,

    /** Setup / Permission state. */
    val needsAudioPermission: Boolean,
    val needsAccessibilityService: Boolean,

    /** Debug / Mapping info. */
    val lastDetectedKey: Int?,
) {
    init {
        require(softKeyLabels.size == SOFT_KEY_COUNT) {
            "Expected $SOFT_KEY_COUNT soft key labels, got ${softKeyLabels.size}"
        }
    }

    companion object {
        const val SOFT_KEY_COUNT = 5

        fun initial(): RadioUiState = RadioUiState(
            systemTime = "--:--",
            networkLabel = "SYNCING",
            batteryPercent = 100,
            signalBars = 0,
            maxSignalBars = 5,
            zoneLabel = "ZONE 01",
            channelLabel = "----",
            channelPosition = "-- / --",
            totalChannels = 0,
            channelCatalog = emptyList(),
            scanIncludedChannelIndices = emptySet(),
            scanPickerVisible = false,
            displayLine1 = "SUNSET SAFETY AGENCY",
            displayLine2 = "OPERATIONS",
            displayLine3 = "CHANNELS: LOADING",
            softKeyLabels = listOf("PTT", "RSSI", "SCAN", "GPS", "CHAN"),
            isPttPressed = false,
            isEmergencyActive = false,
            pttBusyTone = false,
            statusMessage = "STARTING",
            channelsLoading = true,
            channelSyncError = null,
            channelSourceLabel = "---",
            micPermissionGranted = false,
            micHint = "MIC: ALLOW ACCESS",
            localShortUnitId = "",
            rxAttributedLine = "",
            displayNightMode = true,
            scanActive = false,
            gpsActive = false,
            rssiExpanded = false,
            themeMode = ThemeMode.NIGHT, // Default to Night for tactical look
            mappingSettingsVisible = false,
            hardwareMappings = emptyMap(),
            currentlyMappingAction = null,
            needsAudioPermission = false,
            needsAccessibilityService = false,
            lastDetectedKey = null,
        )
    }
}
