package com.securityradio.ptt.device

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Short vibration when PTT is granted (connected, channel clear, mic allowed).
 * Used on every handset or phone that has a vibrator (IRC590, TM-7 Plus, S200, etc.).
 */
class PttHapticFeedback(context: Context) {

    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    fun hasVibrator(): Boolean {
        val v = vibrator ?: return false
        return v.hasVibrator()
    }

    /** 100 ms after permit audio starts, pulse for 100 ms. */
    fun pulseTransmitGranted() {
        if (!hasVibrator()) return
        mainHandler.postDelayed({ pulseTransmitGrantedNow() }, TRANSMIT_PULSE_DELAY_MS)
    }

    private fun pulseTransmitGrantedNow() {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(
                    VibrationEffect.createOneShot(
                        TRANSMIT_PULSE_MS,
                        VibrationEffect.DEFAULT_AMPLITUDE,
                    ),
                )
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(TRANSMIT_PULSE_MS)
            }
        }
    }

    private companion object {
        const val TRANSMIT_PULSE_DELAY_MS = 100L
        const val TRANSMIT_PULSE_MS = 100L
    }
}
