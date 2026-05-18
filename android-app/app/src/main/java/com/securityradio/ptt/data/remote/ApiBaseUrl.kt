package com.securityradio.ptt.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * API root only — strips accidental `/login` paths and ensures a trailing slash.
 * Retrofit paths use a leading `/` (e.g. `/v1/auth/login`) so they resolve from the host root.
 */
fun normalizeApiBaseUrl(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return trimmed
    val parsed = trimmed.toHttpUrlOrNull()
        ?: return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    val root = parsed.newBuilder()
        .encodedPath("/")
        .query(null)
        .fragment(null)
        .build()
        .toString()
    return if (root.endsWith("/")) root else "$root/"
}
