/*
 * Stub for the libcodec2 version header that upstream's CMake build
 * generates from `cmake/version.h.in`. We side-step the generation step
 * by vendoring this static file alongside the pre-generated codebook
 * arrays — `codec2.h` includes <codec2/version.h>, so the codec2_generated
 * directory must be on the include path for any consumer (Android NDK
 * build, iOS Xcode target, web emcc build).
 *
 * Values mirror the libcodec2 submodule's pinned tag (currently 1.2.0).
 * Bump if the submodule ref changes.
 */
#ifndef CODEC2_VERSION_H
#define CODEC2_VERSION_H

#define CODEC2_VERSION_MAJOR 1
#define CODEC2_VERSION_MINOR 2
#define CODEC2_VERSION_PATCH 0
#define CODEC2_VERSION       "1.2.0"

#endif /* CODEC2_VERSION_H */
