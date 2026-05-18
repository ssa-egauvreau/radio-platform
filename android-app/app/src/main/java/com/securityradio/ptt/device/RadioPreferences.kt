package com.securityradio.ptt.device

import android.content.Context
import com.securityradio.ptt.presentation.ThemeMode

/**
 * Persists user-facing shell preferences (themes, etc.).
 */
class RadioPreferences(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getThemeMode(): ThemeMode =
        prefs.getString(KEY_THEME, null)?.let { ThemeMode.entries.find { mode -> mode.name == it } } ?: ThemeMode.AUTO

    fun setThemeMode(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME, mode.name).apply()
    }

    fun isAnnounceChannelOnTuneEnabled(): Boolean =
        prefs.getBoolean(KEY_VOICE_ANNOUNCE_TUNING, DEFAULT_VOICE_ANNOUNCE)

    fun setAnnounceChannelOnTuneEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_VOICE_ANNOUNCE_TUNING, enabled).apply()
    }

    /**
     * On-device agency radio key. Binds this handset to one agency (tenant) on
     * the server. Blank means fall back to the key baked in at build time.
     */
    fun getAgencyRadioKey(): String =
        prefs.getString(KEY_AGENCY_RADIO_KEY, "").orEmpty()

    fun setAgencyRadioKey(key: String) {
        prefs.edit().putString(KEY_AGENCY_RADIO_KEY, key.trim()).apply()
    }

    fun getDeviceProfilePreference(): DeviceProfilePreference =
        prefs.getString(KEY_DEVICE_PROFILE, null)?.let { stored ->
            DeviceProfilePreference.entries.find { it.name == stored }
        } ?: DeviceProfilePreference.AUTO

    fun setDeviceProfilePreference(preference: DeviceProfilePreference) {
        prefs.edit().putString(KEY_DEVICE_PROFILE, preference.name).apply()
    }

    fun getAuthToken(): String = prefs.getString(KEY_AUTH_TOKEN, "").orEmpty()

    fun setAuthToken(token: String) {
        prefs.edit().putString(KEY_AUTH_TOKEN, token.trim()).apply()
    }

    fun clearAuthSession() {
        prefs.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_SESSION_USERNAME)
            .remove(KEY_SESSION_AGENCY_SLUG)
            .apply()
    }

    fun getSessionAgencySlug(): String = prefs.getString(KEY_SESSION_AGENCY_SLUG, "").orEmpty()

    fun setSessionAgencySlug(slug: String) {
        prefs.edit().putString(KEY_SESSION_AGENCY_SLUG, slug.trim().lowercase()).apply()
    }

    fun getSessionUsername(): String = prefs.getString(KEY_SESSION_USERNAME, "").orEmpty()

    fun setSessionUsername(username: String) {
        prefs.edit().putString(KEY_SESSION_USERNAME, username.trim()).apply()
    }

    fun isLoggedIn(): Boolean = getAuthToken().isNotBlank()

    private companion object {
        const val PREFS_NAME = "security_radio_prefs"
        const val KEY_THEME = "theme_mode"
        const val KEY_VOICE_ANNOUNCE_TUNING = "voice_announce_tune"
        const val KEY_AGENCY_RADIO_KEY = "agency_radio_key"
        const val KEY_DEVICE_PROFILE = "device_profile_preference"
        const val KEY_AUTH_TOKEN = "auth_token"
        const val KEY_SESSION_AGENCY_SLUG = "session_agency_slug"
        const val KEY_SESSION_USERNAME = "session_username"
        const val DEFAULT_VOICE_ANNOUNCE = true
    }
}
