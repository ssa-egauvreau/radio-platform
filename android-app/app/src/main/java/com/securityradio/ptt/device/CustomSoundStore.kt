package com.securityradio.ptt.device

import android.content.Context
import java.io.File

/**
 * On-device cache of an agency's custom radio tones. Files are named like the
 * bundled assets (e.g. `ptt_permit.wav`) so the player can fall back cleanly.
 */
class CustomSoundStore(context: Context) {

    private val dir = File(context.applicationContext.filesDir, DIR_NAME)

    /** Cached custom file for [fileName], or null when the bundled asset should be used. */
    fun localFile(fileName: String): File? {
        val file = File(dir, fileName)
        return if (file.isFile && file.length() > 0L) file else null
    }

    /**
     * Stores (or, when [bytes] is null/empty, removes) the cached tone for [fileName].
     * Written via a temp file + rename so a torn write never yields a broken clip.
     */
    fun put(fileName: String, bytes: ByteArray?) {
        val target = File(dir, fileName)
        if (bytes == null || bytes.isEmpty()) {
            target.delete()
            return
        }
        dir.mkdirs()
        val tmp = File(dir, "$fileName.tmp")
        try {
            tmp.writeBytes(bytes)
            target.delete()
            if (!tmp.renameTo(target)) {
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
        } catch (_: Exception) {
            tmp.delete()
        }
    }

    private companion object {
        const val DIR_NAME = "custom-sounds"
    }
}
