package com.securityradio.ptt.device

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * safeT's original experimental narrowband voice codec.
 *
 * This is not AMBE, AMBE+2, IMBE, or bitstream-compatible with any proprietary codec. It is a
 * simple LPC vocoder fallback so safeT radios can still use compact digital voice when the bundled
 * P25 native vocoder is unavailable on a device.
 */
object OpenVbe2pCodec {
    const val Frame8kSamples = 160
    const val FrameBytes = 23

    private const val LpcOrder = 10
    private const val CoeffScale = 16_384.0
    private const val MinEnergyDb = -80.0
    private const val MaxEnergyDb = 0.0

    fun encodeFrame(samples8k160: ShortArray): ByteArray? {
        if (samples8k160.size != Frame8kSamples) return null

        val samples = DoubleArray(samples8k160.size)
        var sumSq = 0.0
        for (i in samples8k160.indices) {
            val sample = samples8k160[i] / 32768.0
            samples[i] = sample
            sumSq += sample * sample
        }

        val rms = sqrt(sumSq / samples.size)
        val energyQ = quantizeEnergy(rms)
        val windowed = hamming(samples)
        val (pitchLag, pitchScore) = estimatePitch(windowed)
        val voiced = rms > 0.008 && pitchScore > 0.32
        val lpc = lpcCoefficients(windowed, LpcOrder)

        val frame = ByteArray(FrameBytes)
        frame[0] = if (voiced) 1.toByte() else 0.toByte()
        frame[1] = energyQ.toByte()
        frame[2] = if (voiced) pitchLag.toByte() else 0.toByte()
        for (i in 0 until LpcOrder) {
            val quantized = (lpc[i].coerceIn(-1.999, 1.999) * CoeffScale)
                .roundToInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            frame[3 + i * 2] = ((quantized ushr 8) and 0xff).toByte()
            frame[4 + i * 2] = (quantized and 0xff).toByte()
        }
        return frame
    }

    class Decoder {
        private val history = DoubleArray(LpcOrder)
        private var pitchCountdown = 0
        private var noise = 0x1234ABCD.toInt()

        fun decodeFrame(frame: ByteArray): ShortArray? {
            if (frame.size != FrameBytes) return null

            val voiced = (frame[0].toInt() and 1) != 0
            val energy = dequantizeEnergy(frame[1].toInt() and 0xff)
            val pitchLag = frame[2].toInt() and 0xff
            val lpc = DoubleArray(LpcOrder)
            for (i in 0 until LpcOrder) {
                lpc[i] = readInt16Be(frame, 3 + i * 2) / CoeffScale
            }

            val excitation = excitation(voiced, pitchLag, energy)
            val out = ShortArray(Frame8kSamples)
            for (i in excitation.indices) {
                var predicted = excitation[i]
                for (j in 0 until LpcOrder) {
                    predicted -= lpc[j] * history[j]
                }
                predicted = predicted.coerceIn(-1.0, 1.0)
                out[i] = (predicted * 32767.0)
                    .roundToInt()
                    .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
                    .toShort()
                for (j in LpcOrder - 1 downTo 1) {
                    history[j] = history[j - 1]
                }
                history[0] = predicted
            }
            return out
        }

        fun reset() {
            history.fill(0.0)
            pitchCountdown = 0
            noise = 0x1234ABCD.toInt()
        }

        private fun excitation(voiced: Boolean, pitchLag: Int, energy: Double): DoubleArray {
            val values = DoubleArray(Frame8kSamples)
            if (voiced && pitchLag > 0) {
                val lag = max(1, pitchLag)
                val pulse = energy * sqrt(lag.toDouble())
                for (i in values.indices) {
                    if (pitchCountdown <= 0) {
                        values[i] = pulse
                        pitchCountdown += lag
                    }
                    pitchCountdown -= 1
                }
                return values
            }

            val scale = energy * sqrt(3.0)
            for (i in values.indices) {
                values[i] = noiseSample() * scale
            }
            return values
        }

        private fun noiseSample(): Double {
            noise = noise * 1_664_525 + 1_013_904_223
            val unsigned = noise ushr 8
            return (unsigned / 16_777_215.0) * 2.0 - 1.0
        }
    }

    private fun hamming(frame: DoubleArray): DoubleArray {
        if (frame.size == 1) return frame.copyOf()
        return DoubleArray(frame.size) { i ->
            frame[i] * (0.54 - 0.46 * cos(2.0 * PI * i / (frame.size - 1)))
        }
    }

    private fun estimatePitch(frame: DoubleArray): Pair<Int, Double> {
        val minLag = 20 // 400 Hz at 8 kHz
        val maxLag = min(frame.size - 1, 160) // about 50 Hz at 8 kHz
        var bestLag = minLag
        var bestScore = 0.0

        for (lag in minLag..maxLag) {
            var corr = 0.0
            var currentEnergy = 0.0
            var delayedEnergy = 0.0
            for (i in lag until frame.size) {
                val current = frame[i]
                val delayed = frame[i - lag]
                corr += current * delayed
                currentEnergy += current * current
                delayedEnergy += delayed * delayed
            }
            val denom = sqrt(currentEnergy * delayedEnergy)
            val score = if (denom > 1e-10) corr / denom else 0.0
            if (score > bestScore) {
                bestScore = score
                bestLag = lag
            }
        }
        return bestLag to bestScore
    }

    private fun lpcCoefficients(frame: DoubleArray, order: Int): DoubleArray {
        val autocorr = DoubleArray(order + 1)
        for (lag in 0..order) {
            var sum = 0.0
            for (i in lag until frame.size) {
                sum += frame[i] * frame[i - lag]
            }
            autocorr[lag] = sum
        }
        if (autocorr[0] <= 1e-9) {
            return DoubleArray(order)
        }
        return levinsonDurbin(autocorr, order)
    }

    private fun levinsonDurbin(autocorr: DoubleArray, order: Int): DoubleArray {
        var coeffs = DoubleArray(order + 1)
        coeffs[0] = 1.0
        var error = autocorr[0]

        for (i in 1..order) {
            var acc = autocorr[i]
            for (j in 1 until i) {
                acc += coeffs[j] * autocorr[i - j]
            }
            val reflection = (-acc / max(error, 1e-9)).coerceIn(-0.98, 0.98)
            val updated = coeffs.copyOf()
            for (j in 1 until i) {
                updated[j] = coeffs[j] + reflection * coeffs[i - j]
            }
            updated[i] = reflection
            coeffs = updated
            error = max(error * (1.0 - reflection * reflection), 1e-9)
        }
        return coeffs.copyOfRange(1, coeffs.size)
    }

    private fun quantizeEnergy(rms: Double): Int {
        val db = 20.0 * log10(max(rms, 1e-4))
        val normalized = ((db - MinEnergyDb) / (MaxEnergyDb - MinEnergyDb)).coerceIn(0.0, 1.0)
        return (255.0 * normalized).roundToInt().coerceIn(0, 255)
    }

    private fun dequantizeEnergy(energyQ: Int): Double {
        val db = MinEnergyDb + (energyQ / 255.0) * (MaxEnergyDb - MinEnergyDb)
        return 10.0.pow(db / 20.0)
    }

    private fun readInt16Be(bytes: ByteArray, offset: Int): Int {
        val value = ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)
        return if ((value and 0x8000) != 0) value - 0x10000 else value
    }
}
