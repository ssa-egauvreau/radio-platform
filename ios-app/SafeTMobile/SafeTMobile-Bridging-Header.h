// Exposes the bundled vocoders to Swift.
#pragma once

#include <stdbool.h>
#include <stdint.h>

// P25 IMBE (88-bit codeword, 20 ms frame @ 8 kHz, 160 samples).
bool p25_imbe_init(void);
bool p25_imbe_encode(const int16_t *samples8k160, uint8_t *codeword11_out);
bool p25_imbe_decode(const uint8_t *codeword11, int16_t *samples8k160_out);

// libcodec2 mode 3200 (64-bit codeword, 20 ms frame @ 8 kHz, 160 samples).
// Forward-declare the C functions Codec2VoiceCodec.swift calls — keeps
// the bridging header light without dragging in codec2.h's full transitive
// includes. The OpaquePointer ABI on the Swift side matches `struct CODEC2 *`
// on the C side; size/alignment match because both sides treat it as a
// platform-width pointer.
struct CODEC2;
struct CODEC2 *codec2_create(int mode);
void codec2_destroy(struct CODEC2 *state);
void codec2_encode(struct CODEC2 *state,
                   unsigned char bytes[],
                   short speech_in[]);
void codec2_decode(struct CODEC2 *state,
                   short speech_out[],
                   const unsigned char bytes[]);
int codec2_samples_per_frame(struct CODEC2 *state);
int codec2_bytes_per_frame(struct CODEC2 *state);

#define CODEC2_MODE_3200 0
