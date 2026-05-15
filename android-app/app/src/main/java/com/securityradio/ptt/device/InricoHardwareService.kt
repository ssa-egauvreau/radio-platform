package com.securityradio.ptt.device

import android.accessibilityservice.AccessibilityService
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import com.securityradio.ptt.RadioApplication

class InricoHardwareService : AccessibilityService() {

    private val repository by lazy {
        (application as RadioApplication).graph.hardwareMappingRepository
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        
        // Always relay the keycode for the mapping UI if it's "listening"
        HardwareButtonRelay.sendRawKeyCode(keyCode)

        val isPtt = repository.getMapping(HardwareAction.PTT).contains(keyCode)
        val isEmergency = repository.getMapping(HardwareAction.EMERGENCY).contains(keyCode)
        val isChanUp = repository.getMapping(HardwareAction.CHANNEL_UP).contains(keyCode)
        val isChanDown = repository.getMapping(HardwareAction.CHANNEL_DOWN).contains(keyCode)
        val isScanToggle = repository.getMapping(HardwareAction.SCAN_TOGGLE).contains(keyCode)

        if (isPtt || isEmergency || isChanUp || isChanDown || isScanToggle) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> {
                    if (event.repeatCount == 0) {
                        when {
                            isPtt -> HardwareButtonRelay.sendEvent(HardwareButtonEvent.PttPressed)
                            isEmergency -> HardwareButtonRelay.sendEvent(HardwareButtonEvent.EmergencyPressed)
                            isChanUp -> HardwareButtonRelay.sendEvent(HardwareButtonEvent.ChannelUpPressed)
                            isChanDown -> HardwareButtonRelay.sendEvent(HardwareButtonEvent.ChannelDownPressed)
                            isScanToggle -> HardwareButtonRelay.sendEvent(HardwareButtonEvent.ScanTogglePressed)
                        }
                    }
                }
                KeyEvent.ACTION_UP -> {
                    if (isPtt) {
                        HardwareButtonRelay.sendEvent(HardwareButtonEvent.PttReleased)
                    }
                }
            }
            return true
        }

        return super.onKeyEvent(event)
    }
}
