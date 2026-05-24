package com.securityradio.ptt.device

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings

/**
 * Opens the per-service accessibility toggle on rugged Inrico builds (especially Android 10
 * TM-7 Plus), where the downloaded-services list is empty for sideloaded apps.
 */
object AccessibilitySettingsLauncher {

    private const val SETTINGS_SHOW_FRAGMENT = ":settings:show_fragment"
    private const val SETTINGS_SHOW_FRAGMENT_ARGS = ":settings:show_fragment_args"
    private const val SETTINGS_FRAGMENT_ARGS_KEY = ":settings:fragment_args_key"

    private const val AOSP_DETAILS_FRAGMENT =
        "com.android.settings.accessibility.AccessibilityDetailsSettingsFragment"
    private const val AOSP_TOGGLE_FRAGMENT =
        "com.android.settings.accessibility.ToggleAccessibilityServicePreferenceFragment"

    /** True on TM-7 Plus class radios still on Android 10 — Settings often hides our service. */
    fun prefersAdbEnableHint(context: Context): Boolean {
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.Q) return false
        val model = Build.MODEL.uppercase()
        return model.contains("TM-7") || model.contains("TM7")
    }

    /**
     * Ordered intents to try. The first match that [Context.startActivity] accepts wins.
     */
    fun buildLaunchIntents(service: ComponentName): List<Intent> {
        val componentKey = service.flattenToString()
        val toggleArgs = toggleFragmentArgs(service)

        return listOf(
            // Android 10 AOSP: details fragment reads Intent.EXTRA_COMPONENT_NAME.
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(SETTINGS_SHOW_FRAGMENT, AOSP_DETAILS_FRAGMENT)
                putExtra(Intent.EXTRA_COMPONENT_NAME, componentKey)
            },
            // Some OEM Settings honor show_fragment + full toggle args directly.
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(SETTINGS_SHOW_FRAGMENT, AOSP_TOGGLE_FRAGMENT)
                putExtra(SETTINGS_SHOW_FRAGMENT_ARGS, toggleArgs)
            },
            // Legacy deep-link key used on several Settings builds.
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(SETTINGS_FRAGMENT_ARGS_KEY, componentKey)
                putExtra(SETTINGS_SHOW_FRAGMENT_ARGS, Bundle().apply {
                    putString(SETTINGS_FRAGMENT_ARGS_KEY, componentKey)
                })
            },
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }

    fun tryOpen(context: Context, service: ComponentName): Boolean {
        for (intent in buildLaunchIntents(service)) {
            if (tryStart(context, intent)) return true
        }
        return false
    }

    /**
     * Two-line ADB recipe for PC/scrcpy setup. Preserves other enabled services when possible.
     */
    fun adbEnableLines(context: Context, service: ComponentName): List<String> {
        val key = service.flattenToString()
        val existing = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        val merged = when {
            existing.isBlank() -> key
            existing.contains(key) -> existing
            else -> "$existing:$key"
        }
        return listOf(
            "adb shell settings put secure accessibility_enabled 1",
            "adb shell settings put secure enabled_accessibility_services $merged",
        )
    }

    fun adbEnableBlock(context: Context, service: ComponentName): String =
        adbEnableLines(context, service).joinToString("\n")

    private fun toggleFragmentArgs(service: ComponentName): Bundle {
        val componentKey = service.flattenToString()
        return Bundle().apply {
            putString("preference_key", componentKey)
            putParcelable("component_name", service)
            putBoolean("checked", false)
        }
    }

    private fun tryStart(context: Context, intent: Intent): Boolean {
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
