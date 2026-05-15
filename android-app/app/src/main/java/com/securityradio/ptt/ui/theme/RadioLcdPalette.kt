package com.securityradio.ptt.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Day / night LCD palettes inspired by public-safety radio displays.
 * Values are generic recreations for Sunset Safety Agency branding only.
 */
data class RadioLcdPalette(
    val lcdMain: Color,
    val lcdAlt: Color,
    val lcdSection: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val statusGreen: Color,
    val statusAmber: Color,
    val statusEmergency: Color,
    val statusBlue: Color,
    val divider: Color,
    val softKeyActiveFill: Color,
    val softKeyInactiveFill: Color,
    val pttIdleFill: Color,
    val pttTransmitFill: Color,
    val pttBusyFill: Color,
    val emergencyFill: Color,
    val materialSurface: Color,
    val materialOnSurface: Color,
    val materialPrimary: Color,
) {
    companion object {
        fun day(): RadioLcdPalette = RadioLcdPalette(
            lcdMain = Color(0xFFEEF0DD),
            lcdAlt = Color(0xFFF5F6E8),
            lcdSection = Color(0xFFE4E6D2),
            textPrimary = Color(0xFF111111),
            textSecondary = Color(0xFF353535),
            textMuted = Color(0xFF5A5A5A),
            statusGreen = Color(0xFF22B14C),
            statusAmber = Color(0xFFF4B400),
            statusEmergency = Color(0xFFFF5A1F),
            statusBlue = Color(0xFF2B6DFF),
            divider = Color(0xFF1A1A1A),
            softKeyActiveFill = Color(0xFFD8DCC4),
            softKeyInactiveFill = Color(0xFFE8EAD6),
            pttIdleFill = Color(0xFFE0E2CE),
            pttTransmitFill = Color(0xFF22B14C),
            pttBusyFill = Color(0xFFF4B400),
            emergencyFill = Color(0xFFFF5A1F),
            materialSurface = Color(0xFFE4E6D2),
            materialOnSurface = Color(0xFF111111),
            materialPrimary = Color(0xFF2B6DFF),
        )

        fun night(): RadioLcdPalette = RadioLcdPalette(
            lcdMain = Color(0xFF0D1114),
            lcdAlt = Color(0xFF151A1E),
            lcdSection = Color(0xFF1B2126),
            textPrimary = Color(0xFFD8F3D0),
            textSecondary = Color(0xFFA8C7A2),
            textMuted = Color(0xFF6E8A73),
            statusGreen = Color(0xFF3CFF6A),
            statusAmber = Color(0xFFFFC940),
            statusEmergency = Color(0xFFFF6430),
            statusBlue = Color(0xFF58A6FF),
            divider = Color(0xFF2E383F),
            softKeyActiveFill = Color(0xFF232C33),
            softKeyInactiveFill = Color(0xFF1B2126),
            pttIdleFill = Color(0xFF151A1E),
            pttTransmitFill = Color(0xFF3CFF6A),
            pttBusyFill = Color(0xFFFFC940),
            emergencyFill = Color(0xFFFF6430),
            materialSurface = Color(0xFF1B2126),
            materialOnSurface = Color(0xFFD8F3D0),
            materialPrimary = Color(0xFF58A6FF),
        )
    }
}
