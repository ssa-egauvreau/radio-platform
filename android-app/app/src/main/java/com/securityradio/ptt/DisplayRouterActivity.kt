package com.securityradio.ptt

import android.app.Activity
import android.os.Bundle

/**
 * Launcher entry: sends [MainActivity] to the physical built-in display on MP22-style
 * firmware, otherwise starts the app normally.
 */
class DisplayRouterActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        DisplayRouter.startMainActivity(this)
        finish()
    }
}
