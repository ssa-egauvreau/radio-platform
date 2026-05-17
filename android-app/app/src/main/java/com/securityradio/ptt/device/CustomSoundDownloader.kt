package com.securityradio.ptt.device

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Pulls an agency's custom radio tones from the server into [CustomSoundStore].
 *
 * The handset is bound to one agency by its radio key, so each tone is fetched
 * from `/v1/sounds/:kind` with that key. A 404 means the agency has no custom
 * tone for that kind, so the cached copy is cleared and the bundled asset wins.
 */
class CustomSoundDownloader(
    httpApiBaseUrl: String,
    private val apiKeyProvider: () -> String,
    private val store: CustomSoundStore,
) {

    private val baseUrl = httpApiBaseUrl.trim().trimEnd('/')

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Server sound kind -> local filename (matching the bundled asset names). */
    private val kinds = mapOf(
        "permit" to "ptt_permit.wav",
        "channel_switch" to "channel_switch.wav",
        "emergency" to "emergency.wav",
        "busy" to "busy.wav",
    )

    /** Blocking refresh of every custom tone — call off the main thread. */
    fun refresh() {
        val key = apiKeyProvider().trim()
        for ((kind, fileName) in kinds) {
            try {
                val builder = Request.Builder().url("$baseUrl/v1/sounds/$kind")
                if (key.isNotEmpty()) {
                    builder.header("X-Radio-Key", key)
                }
                client.newCall(builder.build()).execute().use { response ->
                    when {
                        response.isSuccessful -> store.put(fileName, response.body?.bytes())
                        // No custom tone for this agency — drop any stale cache.
                        response.code == 404 -> store.put(fileName, null)
                        // Other errors (offline, 5xx): keep whatever is already cached.
                        else -> Unit
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "custom tone refresh failed for $kind", e)
            }
        }
    }

    /** Refreshes the custom tones on a background thread. */
    fun refreshAsync() {
        Thread({ refresh() }, "custom-sound-refresh").start()
    }

    private companion object {
        const val TAG = "CustomSound"
    }
}
