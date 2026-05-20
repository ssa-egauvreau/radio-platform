package com.securityradio.ptt.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Tracks whether the device's media-volume slider sits at zero. STREAM_MUSIC
 * is the stream the inbound voice player writes to ([InboundVoicePlayer] uses
 * [AudioAttributes.USAGE_MEDIA] + the legacy STREAM_MUSIC fallback), so when
 * that stream is at zero the operator hears nothing regardless of the in-app
 * mute toggle.
 *
 * Subscribes to two signals: a [ContentObserver] on [Settings.System] (the only
 * public-API path; works on every OEM) and the unpublished but de-facto stable
 * VOLUME_CHANGED_ACTION broadcast (fires sooner on most OEMs). Either is
 * sufficient on its own; both together are robust to one path being lossy.
 *
 * Fail-safe: stays false if either registration fails, mirroring
 * [ConnectivityMonitor]'s "missed signal beats a stuck indicator" stance.
 */
class VolumeMonitor(context: Context) {

    private val appContext = context.applicationContext
    private val audioManager =
        appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private val handler = Handler(Looper.getMainLooper())

    private val _zero = MutableStateFlow(false)
    val zero: StateFlow<Boolean> = _zero.asStateFlow()

    private val observer = object : ContentObserver(handler) {
        override fun onChange(selfChange: Boolean) = refresh()
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = refresh()
    }

    fun start() {
        val am = audioManager ?: return
        runCatching {
            appContext.contentResolver.registerContentObserver(
                Settings.System.CONTENT_URI,
                true,
                observer,
            )
        }
        runCatching {
            val filter = IntentFilter(VOLUME_CHANGED_ACTION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                appContext.registerReceiver(receiver, filter)
            }
        }
        _zero.value = currentlyZero(am)
    }

    private fun refresh() {
        val am = audioManager ?: return
        _zero.value = currentlyZero(am)
    }

    private fun currentlyZero(am: AudioManager): Boolean = runCatching {
        am.getStreamVolume(AudioManager.STREAM_MUSIC) == 0
    }.getOrDefault(false)

    private companion object {
        const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    }
}
