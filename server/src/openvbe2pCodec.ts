export const OPENVBE2P_MAGIC_0 = 0xf7;
export const OPENVBE2P_MAGIC_1 = 0xad;
export const OPENVBE2P_FRAME_BYTES = 23;
export const OPENVBE2P_PACKET_BYTES = 2 + OPENVBE2P_FRAME_BYTES;

const FRAME_8K_SAMPLES = 160;
const LPC_ORDER = 10;
const COEFF_SCALE = 16384;
const MIN_ENERGY_DB = -80;
const MAX_ENERGY_DB = 0;

export function isOpenVbe2pFrame(payload: Buffer): boolean {
  return (
    payload.length === OPENVBE2P_PACKET_BYTES &&
    payload[0] === OPENVBE2P_MAGIC_0 &&
    payload[1] === OPENVBE2P_MAGIC_1
  );
}

/** Stateful decoder for one OpenVBE2P talk-spurt. Returns 16 kHz mono PCM-16. */
export class OpenVbe2pStreamDecoder {
  private readonly history = new Float64Array(LPC_ORDER);
  private pitchCountdown = 0;
  private noise = 0x1234abcd;

  decode(packet: Buffer): Buffer | null {
    if (!isOpenVbe2pFrame(packet)) {
      return null;
    }

    const frame = packet.subarray(2);
    const voiced = (frame[0] & 1) !== 0;
    const energy = dequantizeEnergy(frame[1]);
    const pitchLag = frame[2];
    const lpc = new Float64Array(LPC_ORDER);
    for (let i = 0; i < LPC_ORDER; i++) {
      lpc[i] = frame.readInt16BE(3 + i * 2) / COEFF_SCALE;
    }

    const excitation = this.excitation(voiced, pitchLag, energy);
    const out = Buffer.allocUnsafe(FRAME_8K_SAMPLES * 4);
    for (let i = 0; i < excitation.length; i++) {
      let predicted = excitation[i];
      for (let j = 0; j < LPC_ORDER; j++) {
        predicted -= lpc[j] * this.history[j];
      }
      predicted = clamp(predicted, -1, 1);
      const sample = clamp(Math.round(predicted * 32767), -32768, 32767);
      out.writeInt16LE(sample, i * 4);
      out.writeInt16LE(sample, i * 4 + 2);
      for (let j = LPC_ORDER - 1; j > 0; j--) {
        this.history[j] = this.history[j - 1];
      }
      this.history[0] = predicted;
    }
    return out;
  }

  reset(): void {
    this.history.fill(0);
    this.pitchCountdown = 0;
    this.noise = 0x1234abcd;
  }

  private excitation(voiced: boolean, pitchLag: number, energy: number): Float64Array {
    const values = new Float64Array(FRAME_8K_SAMPLES);
    if (voiced && pitchLag > 0) {
      const lag = Math.max(1, pitchLag);
      const pulse = energy * Math.sqrt(lag);
      for (let i = 0; i < values.length; i++) {
        if (this.pitchCountdown <= 0) {
          values[i] = pulse;
          this.pitchCountdown += lag;
        }
        this.pitchCountdown -= 1;
      }
      return values;
    }

    const scale = energy * Math.sqrt(3);
    for (let i = 0; i < values.length; i++) {
      values[i] = this.noiseSample() * scale;
    }
    return values;
  }

  private noiseSample(): number {
    this.noise = (Math.imul(1664525, this.noise) + 1013904223) >>> 0;
    return (((this.noise >>> 8) / 0xffffff) * 2) - 1;
  }
}

function dequantizeEnergy(energyQ: number): number {
  const db = MIN_ENERGY_DB + (energyQ / 255) * (MAX_ENERGY_DB - MIN_ENERGY_DB);
  return 10 ** (db / 20);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
