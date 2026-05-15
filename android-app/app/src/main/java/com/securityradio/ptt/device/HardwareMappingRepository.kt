package com.securityradio.ptt.device

import android.content.Context
import android.content.SharedPreferences

class HardwareMappingRepository(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("hardware_mappings", Context.MODE_PRIVATE)

    fun getMapping(action: HardwareAction): Set<Int> {
        val key = action.name
        val stored = prefs.getStringSet(key, null)
        if (stored != null) {
            return stored.mapNotNull { it.toIntOrNull() }.toSet()
        }
        return getDefaultKeyCodes(action).mapNotNull { it.toIntOrNull() }.toSet()
    }

    fun setMapping(action: HardwareAction, keyCodes: Set<Int>) {
        prefs.edit().putStringSet(action.name, keyCodes.map { it.toString() }.toSet()).apply()
    }

    fun resetToDefault(action: HardwareAction) {
        prefs.edit().remove(action.name).apply()
    }

    private fun getDefaultKeyCodes(action: HardwareAction): Set<String> {
        return when (action) {
            HardwareAction.PTT -> setOf("232")
            HardwareAction.EMERGENCY -> setOf("141")
            HardwareAction.CHANNEL_UP -> setOf("231")
            HardwareAction.CHANNEL_DOWN -> setOf("230")
            HardwareAction.SCAN_TOGGLE -> emptySet()
        }
    }

    fun getAllMappings(): Map<HardwareAction, Set<Int>> {
        return HardwareAction.entries.associateWith { getMapping(it) }
    }
}
