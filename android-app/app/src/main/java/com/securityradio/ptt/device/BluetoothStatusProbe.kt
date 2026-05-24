package com.securityradio.ptt.device

import android.bluetooth.BluetoothAdapter
import android.content.Context
import android.content.pm.PackageManager

/** Best-effort Bluetooth enabled state for the status bar icon. */
object BluetoothStatusProbe {

    fun isBluetoothOn(context: Context): Boolean {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH)) {
            return false
        }
        return try {
            BluetoothAdapter.getDefaultAdapter()?.isEnabled == true
        } catch (_: SecurityException) {
            false
        }
    }
}
