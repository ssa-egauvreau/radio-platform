// C bridge around WhackerLink dvmvocoder (GPL-2.0). Shared with Android JNI glue.
// Vocoder sources live under android-app/app/src/main/cpp/dvmvocoder/vocoder.

#include <cstring>
#include <mutex>
#include <new>

#include "MBEDecoder.h"
#include "MBEEncoder.h"

using namespace vocoder;

namespace {

std::mutex gCodecMutex;
MBEEncoder* gEncoder = nullptr;
MBEDecoder* gDecoder = nullptr;

void ensureAllocatedLocked() {
    if (gEncoder != nullptr && gDecoder != nullptr) {
        return;
    }

    delete gEncoder;
    delete gDecoder;
    gEncoder = nullptr;
    gDecoder = nullptr;

    gEncoder = new (std::nothrow) MBEEncoder(ENCODE_88BIT_IMBE);
    if (gEncoder == nullptr) {
        return;
    }
    gEncoder->setGainAdjust(1.0f);

    gDecoder = new (std::nothrow) MBEDecoder(DECODE_88BIT_IMBE);
    if (gDecoder == nullptr) {
        delete gEncoder;
        gEncoder = nullptr;
        return;
    }
    gDecoder->setAutoGain(true);
}

} // namespace

extern "C" {

bool p25_imbe_init(void) {
    std::lock_guard<std::mutex> lock(gCodecMutex);
    delete gEncoder;
    delete gDecoder;
    gEncoder = nullptr;
    gDecoder = nullptr;
    ensureAllocatedLocked();
    return gEncoder != nullptr && gDecoder != nullptr;
}

bool p25_imbe_encode(const int16_t* samples8k160, uint8_t* codeword11_out) {
    if (samples8k160 == nullptr || codeword11_out == nullptr) {
        return false;
    }
    uint8_t codeword[11]{};
    std::lock_guard<std::mutex> lock(gCodecMutex);
    if (gEncoder == nullptr) {
        ensureAllocatedLocked();
    }
    if (gEncoder == nullptr) {
        return false;
    }
    gEncoder->encode(const_cast<int16_t*>(samples8k160), codeword);
    std::memcpy(codeword11_out, codeword, 11);
    return true;
}

bool p25_imbe_decode(const uint8_t* codeword11, int16_t* samples8k160_out) {
    if (codeword11 == nullptr || samples8k160_out == nullptr) {
        return false;
    }
    uint8_t codeword[11]{};
    std::memcpy(codeword, codeword11, 11);
    int16_t samples[160]{};
    std::lock_guard<std::mutex> lock(gCodecMutex);
    if (gDecoder == nullptr) {
        ensureAllocatedLocked();
    }
    if (gDecoder == nullptr) {
        return false;
    }
    gDecoder->decode(codeword, samples);
    std::memcpy(samples8k160_out, samples, sizeof(samples));
    return true;
}

} // extern "C"
