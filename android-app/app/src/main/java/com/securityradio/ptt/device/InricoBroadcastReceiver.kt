package com.securityradio.ptt.device

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class InricoBroadcastReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        val action = intent?.action ?: return
        
        when (action) {
            "com.zello.ptt.down", 
            "android.intent.action.PTT.down",
            "com.android.ptt.down" -> {
                HardwareButtonRelay.sendEvent(HardwareButtonEvent.PttPressed)
            }
            
            "com.zello.ptt.up",
            "android.intent.action.PTT.up",
            "com.android.ptt.up" -> {
                HardwareButtonRelay.sendEvent(HardwareButtonEvent.PttReleased)
            }

            "com.zello.intent.channelUp",
            "com.android.intent.action.CHANNEL_UP" -> {
                HardwareButtonRelay.sendEvent(HardwareButtonEvent.ChannelUpPressed)
            }

            "com.zello.intent.channelDown",
            "com.android.intent.action.CHANNEL_DOWN" -> {
                HardwareButtonRelay.sendEvent(HardwareButtonEvent.ChannelDownPressed)
            }
        }
    }
}
