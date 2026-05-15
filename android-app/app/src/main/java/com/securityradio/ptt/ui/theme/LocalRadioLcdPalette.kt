package com.securityradio.ptt.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

val LocalRadioLcdPalette = staticCompositionLocalOf<RadioLcdPalette> {
    error("RadioLcdPalette not provided. Wrap content with CompositionLocalProvider(LocalRadioLcdPalette provides …).")
}

object RadioLcdTheme {
    val palette: RadioLcdPalette
        @Composable
        @ReadOnlyComposable
        get() = LocalRadioLcdPalette.current
}
