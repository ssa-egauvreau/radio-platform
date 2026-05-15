package com.securityradio.ptt.presentation

/**
 * Explicit user or device intents for the radio shell. UI layers forward these to the ViewModel.
 */
sealed interface RadioUiEvent {
    data object ToggleDayNight : RadioUiEvent
    data object PttPressed : RadioUiEvent
    data object PttReleased : RadioUiEvent
    data object EmergencyToggle : RadioUiEvent
    data object ChannelUp : RadioUiEvent
    data object ChannelDown : RadioUiEvent
    data object RetryChannelSync : RadioUiEvent
    /** Open overlay to pick channels that participate in scan. */
    data object OpenScanPicker : RadioUiEvent
    data object CloseScanPicker : RadioUiEvent
    /** Toggle one channel in/out of scan list (excluding home channel — ignored server-side merge). */
    data class ToggleScanIncludeChannel(val catalogIndex: Int) : RadioUiEvent
    data class SoftKeyPressed(val index: Int) : RadioUiEvent
}
