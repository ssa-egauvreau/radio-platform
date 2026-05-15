package com.securityradio.ptt.device

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * A singleton relay for hardware button events (PTT, Emergency) intercepted by background services.
 */
object HardwareButtonRelay {
    private val _events = MutableSharedFlow<HardwareButtonEvent>(extraBufferCapacity = 8)
    val events = _events.asSharedFlow()

    private val _rawKeyCodes = MutableSharedFlow<Int>(extraBufferCapacity = 64)
    val rawKeyCodes = _rawKeyCodes.asSharedFlow()

    fun sendEvent(event: HardwareButtonEvent) {
        _events.tryEmit(event)
    }

    fun sendRawKeyCode(keyCode: Int) {
        _rawKeyCodes.tryEmit(keyCode)
    }
}

sealed interface HardwareButtonEvent {
    data object PttPressed : HardwareButtonEvent
    data object PttReleased : HardwareButtonEvent
    data object EmergencyPressed : HardwareButtonEvent
    data object ChannelUpPressed : HardwareButtonEvent
    data object ChannelDownPressed : HardwareButtonEvent
    data object ScanTogglePressed : HardwareButtonEvent
}
