package com.securityradio.ptt.device

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import com.securityradio.ptt.data.remote.LocationReportDto
import com.securityradio.ptt.data.remote.RadioApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Reports the handset's GPS position to the server so it shows on the dispatch map.
 * Uses the platform LocationManager (no Google Play Services) so it works on the
 * rugged Sonim/Inrico handsets that lack Play Services.
 */
class LocationReporter(
    context: Context,
    private val radioApi: RadioApi,
) {
    private val appContext = context.applicationContext
    private val locationManager =
        appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var unitId: String = ""
    @Volatile private var channel: String? = null
    @Volatile private var running = false
    /** Freshest position known — from a live update or a provider's cached fix. */
    @Volatile private var lastLocation: Location? = null
    private var postJob: Job? = null

    // Explicit object (not a lambda): pre-API-30 LocationListener has extra abstract
    // methods, so SAM conversion would risk an AbstractMethodError on Android 7.
    private val listener = object : LocationListenerCompat {
        override fun onLocationChanged(location: Location) {
            lastLocation = location
        }
    }

    fun configure(unitId: String) {
        this.unitId = unitId.trim().uppercase(Locale.US)
    }

    fun setChannel(channel: String?) {
        this.channel = channel?.trim()?.takeIf { it.isNotEmpty() && it != "----" }
    }

    fun hasPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_COARSE_LOCATION)
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission") // hasPermission() is checked before any location call
    fun start() {
        if (running) return
        val lm = locationManager ?: return
        if (!hasPermission()) return
        running = true

        // Seed from the provider's cached fix so the radio appears on the map at
        // once. Waiting for a fresh GPS lock can take minutes — or never resolve
        // indoors — which is why handsets were absent from dispatch entirely.
        lastLocation = bestLastKnown(lm)

        val request = LocationRequestCompat.Builder(POST_INTERVAL_MS)
            .setMinUpdateIntervalMillis(POST_INTERVAL_MS)
            .setMinUpdateDistanceMeters(0f) // a parked radio must keep refreshing
            .build()
        val executor = ContextCompat.getMainExecutor(appContext)
        for (provider in PROVIDERS) {
            runCatching {
                if (lm.isProviderEnabled(provider)) {
                    LocationManagerCompat.requestLocationUpdates(lm, provider, request, executor, listener)
                }
            }
        }

        // Post on a fixed cadence rather than only when the OS delivers a fresh
        // fix: a stationary or indoor radio still has to stay visible on the map.
        postJob = scope.launch {
            while (isActive) {
                runCatching { postCurrentLocation(lm) }
                delay(POST_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        running = false
        postJob?.cancel()
        postJob = null
        val lm = locationManager ?: return
        runCatching { LocationManagerCompat.removeUpdates(lm, listener) }
    }

    /** Posts the freshest known position; tops up from the location cache first. */
    private suspend fun postCurrentLocation(lm: LocationManager) {
        if (hasPermission()) {
            val cached = bestLastKnown(lm)
            val current = lastLocation
            if (cached != null && (current == null || cached.time > current.time)) {
                lastLocation = cached
            }
        }
        val location = lastLocation ?: return
        val unit = unitId.takeIf { it.isNotBlank() } ?: return
        radioApi.reportLocation(
            LocationReportDto(
                unitId = unit,
                lat = location.latitude,
                lon = location.longitude,
                channel = channel,
                accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                heading = if (location.hasBearing()) location.bearing.toDouble() else null,
                speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
            ),
        )
    }

    /** Most recent cached fix across providers, or null if none is available. */
    @SuppressLint("MissingPermission") // callers check hasPermission()
    private fun bestLastKnown(lm: LocationManager): Location? {
        var best: Location? = null
        for (provider in PROVIDERS) {
            val loc = runCatching {
                if (lm.isProviderEnabled(provider)) lm.getLastKnownLocation(provider) else null
            }.getOrNull()
            if (loc != null && (best == null || loc.time > best.time)) {
                best = loc
            }
        }
        return best
    }

    private companion object {
        val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        /** Cadence for both location-update requests and server posts. */
        const val POST_INTERVAL_MS = 15_000L
    }
}
