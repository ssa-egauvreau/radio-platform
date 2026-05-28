# codec2_generated — vendored libcodec2 codebook arrays

`libcodec2` ships its quantiser codebooks as `.txt` files under
`codec2/src/codebook/` and a small C tool `generate_codebook.c` that
turns them into the `codebook*.c` arrays the vocoder links against.
For a native build CMake just runs that tool at build time. Cross-
compiling for Android NDK would need an `ExternalProject_Add` to first
build `generate_codebook` for the host before the NDK build can
proceed — extra complexity for a static, ship-once set of arrays.

We side-step that by **pre-generating the codebook `.c` files once on a
Linux host and vendoring the output here**. The CMakeLists at
`cpp/CMakeLists.txt` references these files instead of running the
tool at build time.

## When to regenerate

Whenever the `cpp/codec2` submodule is bumped to a new libcodec2
release (currently pinned to **1.2.0**). The codebook layout has been
stable for many releases, but the generator's output format could
change in principle.

## How to regenerate

From the repo root, with a working Linux host C toolchain:

```sh
cd android-app/app/src/main/cpp/codec2/src

# 1. Build the host helper (NOT the NDK arm64 build — vanilla gcc).
gcc -O2 -o /tmp/generate_codebook generate_codebook.c -lm

# 2. Run it against each codebook variant. Targets + input file lists
#    mirror codec2/src/CMakeLists.txt's add_custom_command stanzas.
OUT=../../codec2_generated
D=codebook

/tmp/generate_codebook lsp_cb \
    $D/lsp1.txt $D/lsp2.txt $D/lsp3.txt $D/lsp4.txt $D/lsp5.txt \
    $D/lsp6.txt $D/lsp7.txt $D/lsp8.txt $D/lsp9.txt $D/lsp10.txt \
    > $OUT/codebook.c

/tmp/generate_codebook lsp_cbd \
    $D/dlsp1.txt $D/dlsp2.txt $D/dlsp3.txt $D/dlsp4.txt $D/dlsp5.txt \
    $D/dlsp6.txt $D/dlsp7.txt $D/dlsp8.txt $D/dlsp9.txt $D/dlsp10.txt \
    > $OUT/codebookd.c

/tmp/generate_codebook lsp_cbjmv \
    $D/lspjmv1.txt $D/lspjmv2.txt $D/lspjmv3.txt \
    > $OUT/codebookjmv.c

/tmp/generate_codebook ge_cb $D/gecb.txt > $OUT/codebookge.c

/tmp/generate_codebook newamp1vq_cb \
    $D/train_120_1.txt $D/train_120_2.txt \
    > $OUT/codebooknewamp1.c

/tmp/generate_codebook newamp1_energy_cb \
    $D/newamp1_energy_q.txt \
    > $OUT/codebooknewamp1_energy.c

/tmp/generate_codebook newamp2vq_cb $D/codes_450.txt \
    > $OUT/codebooknewamp2.c

/tmp/generate_codebook newamp2_energy_cb $D/newamp2_energy_q.txt \
    > $OUT/codebooknewamp2_energy.c
```

After regenerating, run `./gradlew assembleDebug` (or the Android PR
check on CI) to verify the new arrays link cleanly against the rest of
libcodec2.
