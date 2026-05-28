// JNI bridge for libcodec2 (David Rowe, LGPL-2.1). See cpp/codec2 submodule.
//
// Exposes the bare minimum the Kotlin Codec2Native class needs:
//   - nativeInit() → bool   : allocate encoder + decoder for MODE_3200
//   - nativeEncode(short[160] pcm8k) → byte[8]
//   - nativeDecode(byte[8] codeword) → short[160] pcm8k
//
// Mode 3200 = 3200 bps = 20 ms frames at 8 kHz = 160 samples per frame =
// 8 bytes per encoded codeword. Matches the relay's existing 20 ms wire
// cadence so no per-codec buffering is needed in VoiceRelayTransport.
//
// One singleton encoder + decoder instance lives for the app lifetime.
// codec2_create allocates internal state (sin tables, codebooks, LPC
// memory) that's cheap to keep around and expensive to rebuild — same
// pattern as P25ImbeNative.

#include <mutex>
#include <new>

#include <jni.h>

extern "C" {
#include "codec2.h"
}

namespace {

std::mutex gCodecMutex;

struct CODEC2* gEncoder = nullptr;
struct CODEC2* gDecoder = nullptr;

constexpr int CODEC2_3200_SAMPLES = 160;  // 20 ms @ 8 kHz
constexpr int CODEC2_3200_BYTES   = 8;    // 64 bits per frame

/** Allocate encoder + decoder. Caller must hold gCodecMutex.
 *  Returns true on success — if any allocation fails, BOTH are cleared
 *  so the half-allocated state never gets used. */
bool ensureAllocatedLocked() {
    if (gEncoder != nullptr && gDecoder != nullptr) {
        return true;
    }

    if (gEncoder != nullptr) { codec2_destroy(gEncoder); gEncoder = nullptr; }
    if (gDecoder != nullptr) { codec2_destroy(gDecoder); gDecoder = nullptr; }

    gEncoder = codec2_create(CODEC2_MODE_3200);
    if (gEncoder == nullptr) {
        return false;
    }
    gDecoder = codec2_create(CODEC2_MODE_3200);
    if (gDecoder == nullptr) {
        codec2_destroy(gEncoder);
        gEncoder = nullptr;
        return false;
    }

    // Sanity-check: the frame sizes built into our wire framing depend on
    // these exact values. If a future codec2 release changes mode 3200 we
    // want to fail at init rather than corrupting wire data.
    const bool sizesOk =
        codec2_samples_per_frame(gEncoder) == CODEC2_3200_SAMPLES &&
        codec2_bytes_per_frame(gEncoder)   == CODEC2_3200_BYTES   &&
        codec2_samples_per_frame(gDecoder) == CODEC2_3200_SAMPLES &&
        codec2_bytes_per_frame(gDecoder)   == CODEC2_3200_BYTES;
    if (!sizesOk) {
        codec2_destroy(gEncoder); gEncoder = nullptr;
        codec2_destroy(gDecoder); gDecoder = nullptr;
        return false;
    }

    return true;
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_securityradio_ptt_device_Codec2Native_nativeInit(JNIEnv* /*env*/, jclass /*cls*/) {
    std::lock_guard<std::mutex> lock(gCodecMutex);
    if (gEncoder != nullptr) { codec2_destroy(gEncoder); gEncoder = nullptr; }
    if (gDecoder != nullptr) { codec2_destroy(gDecoder); gDecoder = nullptr; }
    return ensureAllocatedLocked() ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_securityradio_ptt_device_Codec2Native_nativeEncode(JNIEnv* env, jclass /*cls*/,
                                                            jshortArray jSamples) {
    if (jSamples == nullptr) return nullptr;
    if (env->GetArrayLength(jSamples) != CODEC2_3200_SAMPLES) return nullptr;

    int16_t samples[CODEC2_3200_SAMPLES];
    env->GetShortArrayRegion(jSamples, 0, CODEC2_3200_SAMPLES,
                             reinterpret_cast<jshort*>(samples));

    uint8_t codeword[CODEC2_3200_BYTES]{};

    std::lock_guard<std::mutex> lock(gCodecMutex);
    if (gEncoder == nullptr && !ensureAllocatedLocked()) {
        return nullptr;
    }
    codec2_encode(gEncoder, codeword, samples);

    jbyteArray out = env->NewByteArray(CODEC2_3200_BYTES);
    if (out == nullptr) return nullptr;
    env->SetByteArrayRegion(out, 0, CODEC2_3200_BYTES,
                            reinterpret_cast<const jbyte*>(codeword));
    return out;
}

extern "C" JNIEXPORT jshortArray JNICALL
Java_com_securityradio_ptt_device_Codec2Native_nativeDecode(JNIEnv* env, jclass /*cls*/,
                                                            jbyteArray jCodeword) {
    if (jCodeword == nullptr) return nullptr;
    if (env->GetArrayLength(jCodeword) != CODEC2_3200_BYTES) return nullptr;

    uint8_t codeword[CODEC2_3200_BYTES]{};
    env->GetByteArrayRegion(jCodeword, 0, CODEC2_3200_BYTES,
                            reinterpret_cast<jbyte*>(codeword));

    int16_t samples[CODEC2_3200_SAMPLES]{};

    std::lock_guard<std::mutex> lock(gCodecMutex);
    if (gDecoder == nullptr && !ensureAllocatedLocked()) {
        return nullptr;
    }
    codec2_decode(gDecoder, samples, codeword);

    jshortArray out = env->NewShortArray(CODEC2_3200_SAMPLES);
    if (out == nullptr) return nullptr;
    env->SetShortArrayRegion(out, 0, CODEC2_3200_SAMPLES,
                             reinterpret_cast<const jshort*>(samples));
    return out;
}
