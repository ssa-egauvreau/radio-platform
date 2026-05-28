/**
 * Voice codec registry.
 *
 * The relay supports multiple voice codecs simultaneously: a channel's
 * `radio_channels.codec` column picks which one connected clients should use
 * to *transmit*, and every client must be able to *receive* any of the codecs
 * because each frame self-identifies via its first two magic bytes. The relay
 * itself never decodes frames for forwarding — it inspects the magic to know
 * which codec the frame uses (for logging / metrics / per-codec server-side
 * decoders on the recording path) and otherwise passes the bytes through.
 *
 * Wire format for every codec is the same shape:
 *
 *     [magic_byte_0][magic_byte_1][...codec payload...]
 *
 * - IMBE keeps its existing 0xF5 0xAB so older clients that predate this
 *   registry stay on-wire compatible without any change.
 * - Codec2 (3200 bps mode) uses 0xC2 0x01 — first byte chosen so a wire dump
 *   makes the codec obvious at a glance.
 * - Opus uses 0x4F 0x70 — ASCII "Op", same reason.
 *
 * The 0xF6 0xAC "clear PCM sideband" magic from voiceRelay.ts is intentionally
 * NOT a codec — it carries unvocoded PCM solely for the recorder / AI dispatch
 * transcription path, and is shipped alongside vocoded frames regardless of
 * which codec the channel is on.
 */

export const VOICE_CODECS = ["imbe", "codec2_3200", "opus"] as const;
export type VoiceCodec = (typeof VOICE_CODECS)[number];

/** Default for any row that predates the codec column or has a bad value. */
export const DEFAULT_VOICE_CODEC: VoiceCodec = "imbe";

/** First two bytes of every frame, by codec. */
export const CODEC_MAGIC: Record<VoiceCodec, readonly [number, number]> = {
  imbe: [0xf5, 0xab],
  codec2_3200: [0xc2, 0x01],
  opus: [0x4f, 0x70],
};

/** Returns the codec a wire frame uses based on its first two bytes, or null
 *  for anything we don't recognize (control frames, clear-PCM sideband, junk). */
export function detectFrameCodec(payload: Buffer): VoiceCodec | null {
  if (payload.length < 2) return null;
  const b0 = payload[0];
  const b1 = payload[1];
  if (b0 === 0xf5 && b1 === 0xab) return "imbe";
  if (b0 === 0xc2 && b1 === 0x01) return "codec2_3200";
  if (b0 === 0x4f && b1 === 0x70) return "opus";
  return null;
}

/** Validates an admin-supplied codec ID before persisting it. */
export function isVoiceCodec(value: unknown): value is VoiceCodec {
  return typeof value === "string" && (VOICE_CODECS as readonly string[]).includes(value);
}

/** Coerces a raw DB value (possibly null / case-mismatched / unknown) to a
 *  valid codec, falling back to the default so an old row never breaks the
 *  voice path. */
export function coerceVoiceCodec(raw: unknown): VoiceCodec {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if ((VOICE_CODECS as readonly string[]).includes(lower)) {
      return lower as VoiceCodec;
    }
  }
  return DEFAULT_VOICE_CODEC;
}
