package com.securityradio.ptt.presentation

enum class ThemeMode(val label: String) {
    AUTO("Mirror System"),
    DAY("Day Mode"),
    NIGHT("Night Mode"),
}

/** Whether the tactical LCD chrome should render the night palette. */
fun ThemeMode.isLcdNight(systemDark: Boolean): Boolean = when (this) {
    ThemeMode.AUTO -> systemDark
    ThemeMode.DAY -> false
    ThemeMode.NIGHT -> true
}
