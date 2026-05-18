package com.securityradio.ptt.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.securityradio.ptt.MainActivity

/**
 * Restarts the foreground anchor after reboot; best-effort resumes the radio UI (OEMs may block this).
 */
class RadioBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_USER_PRESENT,
            -> launchRadio(context)
            else -> return
        }
    }

    private fun launchRadio(context: Context) {
        RadioPresenceService.start(context)
        try {
            val launch = Intent(context, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
            }
            context.startActivity(launch)
        } catch (_: Throwable) {
            /* Some OEMs block background startup; the presence notification can still open MainActivity. */
        }
    }
}
