package com.securityradio.ptt.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Tracks whether the device has an internet-capable network.
 *
 * Fail-safe by design: it reports offline only once the OS callback is
 * confirmed registered and actually says so. If monitoring cannot be set up
 * (missing permission, OEM quirk) it stays "online" — a missed outage is far
 * better than a stuck NO CONNECTION alert while the radio is plainly working.
 */
class ConnectivityMonitor(context: Context) {

    private val connectivityManager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE)
            as? ConnectivityManager

    /** Networks the OS currently reports as usable; online == this set is non-empty. */
    private val liveNetworks = mutableSetOf<Network>()

    /** Set once the OS callback is registered; until then offline is never reported. */
    private var monitoring = false

    private val _online = MutableStateFlow(true)

    /** `true` while the device has an internet-capable network. */
    val online: StateFlow<Boolean> = _online.asStateFlow()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = update { liveNetworks.add(network) }
        override fun onLost(network: Network) = update { liveNetworks.remove(network) }
    }

    /** Registers the OS callback. Safe to call once after construction. */
    fun start() {
        val cm = connectivityManager ?: return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val registered = runCatching { cm.registerNetworkCallback(request, callback) }.isSuccess
        if (!registered) return
        synchronized(liveNetworks) {
            monitoring = true
            // Seed from the current network so a start-offline is caught and a
            // start-online shows no banner before the first callback arrives.
            _online.value = currentlyOnline(cm)
        }
    }

    private fun update(mutate: () -> Unit) {
        synchronized(liveNetworks) {
            mutate()
            if (monitoring) _online.value = liveNetworks.isNotEmpty()
        }
    }

    private fun currentlyOnline(cm: ConnectivityManager): Boolean = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork
            val caps = network?.let { cm.getNetworkCapabilities(it) }
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        } else {
            @Suppress("DEPRECATION")
            cm.activeNetworkInfo?.isConnected == true
        }
    }.getOrDefault(true)
}
