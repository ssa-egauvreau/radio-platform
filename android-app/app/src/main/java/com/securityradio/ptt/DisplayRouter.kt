package com.securityradio.ptt

import android.app.ActivityOptions
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display

/**
 * Routes app startup to the built-in physical display on MP22 / some Inrico firmware
 * where Display 0 is a virtual surface and Display 1 is the real panel.
 *
 * Normal phones and tablets are unaffected.
 */
object DisplayRouter {

    private const val MP22_RETRY_DELAY_MS = 1_000L

    /** Flags for launching [MainActivity] on the physical display (kiosk launcher may hold Display 0). */
    private const val PHYSICAL_LAUNCH_FLAGS =
        Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TASK or
            Intent.FLAG_ACTIVITY_MULTIPLE_TASK

    fun startMainActivity(context: Context) {
        val appContext = context.applicationContext
        try {
            val displays = loadDisplays(appContext)
            val targetId = resolveMp22PhysicalDisplayId(displays)
            if (targetId != null) {
                val intent = mainActivityIntentForPhysicalDisplay(appContext)
                launchOnDisplay(appContext, intent, targetId)
                scheduleMp22Retry(appContext, targetId)
            } else {
                appContext.startActivity(mainActivityIntent(appContext))
            }
        } catch (_: Throwable) {
            try {
                appContext.startActivity(mainActivityIntent(appContext))
            } catch (_: Throwable) {
                /* best effort */
            }
        }
    }

    private fun mainActivityIntent(context: Context): Intent =
        Intent(context, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
        }

    private fun mainActivityIntentForPhysicalDisplay(context: Context): Intent =
        Intent(context, MainActivity::class.java).apply {
            addFlags(PHYSICAL_LAUNCH_FLAGS)
        }

    private fun loadDisplays(context: Context): Array<Display> {
        val manager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
            ?: return emptyArray()
        return try {
            manager.displays ?: emptyArray()
        } catch (_: Throwable) {
            emptyArray()
        }
    }

    /**
     * MP22-style layout: Display 0 is virtual, Display 1 is the built-in panel.
     * Returns the display id to launch on, or null when this does not apply.
     */
    fun resolveMp22PhysicalDisplayId(displays: Array<Display>): Int? {
        if (displays.size < 2) return null
        val display0 = displays[0] ?: return null
        val display1 = displays[1] ?: return null
        if (!displayLooksVirtual(display0) || !displayLooksPhysical(display1)) {
            return null
        }
        return display1.displayId
    }

    private fun displayLooksVirtual(display: Display): Boolean {
        val name = display.name?.lowercase().orEmpty()
        return name.contains("virtual")
    }

    private fun displayLooksPhysical(display: Display): Boolean {
        val name = display.name?.lowercase().orEmpty()
        return name.contains("built") ||
            name.contains("screen") ||
            name.contains("lcd") ||
            name.contains("panel")
    }

    private fun launchOnDisplay(context: Context, intent: Intent, displayId: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val options = ActivityOptions.makeBasic()
            options.launchDisplayId = displayId
            context.startActivity(intent, options.toBundle())
        } else {
            context.startActivity(intent)
        }
    }

    private fun scheduleMp22Retry(context: Context, displayId: Int) {
        Handler(Looper.getMainLooper()).postDelayed({
            try {
                val retry = mainActivityIntentForPhysicalDisplay(context)
                launchOnDisplay(context, retry, displayId)
            } catch (_: Throwable) {
                /* ignore */
            }
        }, MP22_RETRY_DELAY_MS)
    }
}
