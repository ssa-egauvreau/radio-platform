package com.securityradio.ptt.device

import android.content.Context
import java.util.Locale
import java.util.UUID

/**
 * Stable short unit label shown on-screen when you transmit (until real accounts exist).
 */
class LocalUnitIdentifier(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun shortUnitId(): String {
        val existing = prefs.getString(KEY_UNIT, null)?.trim().orEmpty()
        if (existing.isNotEmpty()) return existing.uppercase(Locale.US)
        val created = UUID.randomUUID().toString().take(6).uppercase(Locale.US)
        prefs.edit().putString(KEY_UNIT, created).apply()
        return created
    }

    /** Aligns on-screen / REST attribution with the account unit used on the voice relay. */
    fun setShortUnitId(unitIdUpper: String) {
        val trimmed = unitIdUpper.trim().uppercase(Locale.US)
        if (trimmed.isNotEmpty()) {
            prefs.edit().putString(KEY_UNIT, trimmed).apply()
        }
    }

    private companion object {
        const val PREFS = "security_radio_identity"
        const val KEY_UNIT = "local_unit_id"
    }
}
