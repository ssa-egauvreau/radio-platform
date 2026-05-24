package com.securityradio.ptt.device

import android.content.Context
import android.content.SharedPreferences

class HardwareMappingRepository(
    context: Context,
    private val radioPreferences: RadioPreferences,
) {
    private val prefs: SharedPreferences = context.getSharedPreferences("hardware_mappings", Context.MODE_PRIVATE)

    fun getMapping(action: HardwareAction): Set<Int> {
        val key = action.name
        val stored = prefs.getStringSet(key, null)
        if (stored != null) {
            return stored.mapNotNull { it.toIntOrNull() }.toSet()
        }
        return defaultKeyCodesForCurrentDevice(action)
    }

    fun setMapping(action: HardwareAction, keyCodes: Set<Int>) {
        prefs.edit().putStringSet(action.name, keyCodes.map { it.toString() }.toSet()).apply()
    }

    fun resetToDefault(action: HardwareAction) {
        prefs.edit().remove(action.name).apply()
    }

    fun defaultKeyCodesForCurrentDevice(action: HardwareAction): Set<Int> {
        val preference = radioPreferences.getDeviceProfilePreference()
        val profile = DeviceProfileResolver.resolve(preference)
        return DeviceProfileResolver.defaultKeyCodes(profile, action)
    }

    fun getAllMappings(): Map<HardwareAction, Set<Int>> {
        return HardwareAction.entries.associateWith { getMapping(it) }
    }
}
