// Exposes the bundled P25 IMBE vocoder to Swift.
#pragma once

#include <stdbool.h>
#include <stdint.h>

bool p25_imbe_init(void);
bool p25_imbe_encode(const int16_t *samples8k160, uint8_t *codeword11_out);
bool p25_imbe_decode(const uint8_t *codeword11, int16_t *samples8k160_out);
