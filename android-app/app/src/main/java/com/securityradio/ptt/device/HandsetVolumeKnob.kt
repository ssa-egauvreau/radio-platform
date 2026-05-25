package com.securityradio.ptt.device

import android.view.KeyEvent

/**
 * TM7+ rotary knob: several [KeyEvent.ACTION_DOWN] / [ACTION_UP] pairs per physical detent.
 * Shared debounce so only one DOWN+UP pair per detent reaches the framework volume handler.
 *
 * Do not call [android.media.AudioManager.adjustStreamVolume] here — on Inrico firmware that
 * can interact badly with OEM services; let [android.app.Activity.onKeyDown] forward once.
 */
object HandsetVolumeKnob {

    const val DEBOUNCE_MS = 120L

    // 0L sentinel, not Long.MIN_VALUE: event.eventTime is uptimeMillis() (non-negative), and
    // subtracting Long.MIN_VALUE overflows to a large negative, making the debounce check
    // permanently reject every press.
    private var lastDownEventTimeMs = 0L
    private var lastUpEventTimeMs = 0L

    /** True when this DOWN should adjust volume (first in a detent window). */
    fun acceptDown(event: KeyEvent): Boolean {
        if (event.repeatCount != 0) return false
        val t = event.eventTime
        if (lastDownEventTimeMs != 0L && t - lastDownEventTimeMs < DEBOUNCE_MS) return false
        lastDownEventTimeMs = t
        return true
    }

    /** True when this UP should be forwarded (paired release for a real detent). */
    fun acceptUp(event: KeyEvent): Boolean {
        val t = event.eventTime
        if (lastUpEventTimeMs != 0L && t - lastUpEventTimeMs < DEBOUNCE_MS) return false
        lastUpEventTimeMs = t
        return true
    }
}
