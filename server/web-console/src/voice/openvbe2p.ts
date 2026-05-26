export const OPENVBE2P_MAGIC_0 = 0xf7;
export const OPENVBE2P_MAGIC_1 = 0xad;

export const OPENVBE2P_FRAME_8K_SAMPLES = 160;
export const OPENVBE2P_FRAME_BYTES = 23;
export const OPENVBE2P_PACKET_BYTES = 2 + OPENVBE2P_FRAME_BYTES;

const LPC_ORDER = 10;
const COEFF_SCALE = 16384;
const MIN_ENERGY_DB = -80;
const MAX_ENERGY_DB = 0;

export function isOpenVbe2pPacket(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength === OPENVBE2P_PACKET_BYTES &&
    bytes[0] === OPENVBE2P_MAGIC_0 &&
    bytes[1] === OPENVBE2P_MAGIC_1
  );
}

export function wrapOpenVbe2pFrame(frame: Uint8Array): ArrayBuffer {
  const packet = new Uint8Array(OPENVBE2P_PACKET_BYTES);
  packet[0] = OPENVBE2P_MAGIC_0;
  packet[1] = OPENVBE2P_MAGIC_1;
  packet.set(frame, 2);
  return packet.buffer;
}

export function openVbe2pEncodeFrame(samples8k160: Int16Array): Uint8Array | null {
  if (samples8k160.length !== OPENVBE2P_FRAME_8K_SAMPLES) {
    return null;
  }
  const samples = new Float64Array(samples8k160.length);
  let sumSq = 0;
  for (let i = 0; i < samples8k160.length; i++) {
    const sample = samples8k160[i] / 32768;
    samples[i] = sample;
    sumSq += sample * sample;
  }

  const rms = Math.sqrt(sumSq / samples.length);
  const energyQ = quantizeEnergy(rms);
  const windowed = hamming(samples);
  const [pitchLag, pitchScore] = estimatePitch(windowed);
  const voiced = rms > 0.008 && pitchScore > 0.32;
  const lpc = lpcCoefficients(windowed, LPC_ORDER);

  const frame = new Uint8Array(OPENVBE2P_FRAME_BYTES);
  frame[0] = voiced ? 1 : 0;
  frame[1] = energyQ;
  frame[2] = voiced ? pitchLag : 0;
  for (let i = 0; i < LPC_ORDER; i++) {
    const q = clamp(Math.round(clamp(lpc[i], -1.999, 1.999) * COEFF_SCALE), -32768, 32767);
    frame[3 + i * 2] = (q >> 8) & 0xff;
    frame[4 + i * 2] = q & 0xff;
  }
  return frame;
}

export class OpenVbe2pDecoder {
  private readonly history = new Float64Array(LPC_ORDER);
  private pitchCountdown = 0;
  private noise = 0x1234abcd;

  decodeFrame(frame: Uint8Array): Int16Array | null {
    if (frame.byteLength !== OPENVBE2P_FRAME_BYTES) {
      return null;
    }

    const voiced = (frame[0] & 1) !== 0;
    const energy = dequantizeEnergy(frame[1]);
    const pitchLag = frame[2];
    const lpc = new Float64Array(LPC_ORDER);
    for (let i = 0; i < LPC_ORDER; i++) {
      const raw = readInt16Be(frame, 3 + i * 2);
      lpc[i] = raw / COEFF_SCALE;
    }

    const excitation = this.excitation(voiced, pitchLag, energy);
    const out = new Int16Array(OPENVBE2P_FRAME_8K_SAMPLES);
    for (let i = 0; i < excitation.length; i++) {
      let predicted = excitation[i];
      for (let j = 0; j < LPC_ORDER; j++) {
        predicted -= lpc[j] * this.history[j];
      }
      predicted = clamp(predicted, -1, 1);
      out[i] = clamp(Math.round(predicted * 32767), -32768, 32767);
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
    const values = new Float64Array(OPENVBE2P_FRAME_8K_SAMPLES);
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

function hamming(frame: Float64Array): Float64Array {
  const out = new Float64Array(frame.length);
  if (frame.length === 1) {
    out[0] = frame[0];
    return out;
  }
  for (let i = 0; i < frame.length; i++) {
    out[i] = frame[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame.length - 1)));
  }
  return out;
}

function estimatePitch(frame: Float64Array): [number, number] {
  const minLag = 20; // 400 Hz at 8 kHz
  const maxLag = 159; // about 50 Hz at 8 kHz, capped to one frame
  let bestLag = minLag;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let currentEnergy = 0;
    let delayedEnergy = 0;
    for (let i = lag; i < frame.length; i++) {
      const current = frame[i];
      const delayed = frame[i - lag];
      corr += current * delayed;
      currentEnergy += current * current;
      delayedEnergy += delayed * delayed;
    }
    const denom = Math.sqrt(currentEnergy * delayedEnergy);
    const score = denom > 1e-10 ? corr / denom : 0;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return [bestLag, bestScore];
}

function lpcCoefficients(frame: Float64Array, order: number): Float64Array {
  const autocorr = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let sum = 0;
    for (let i = lag; i < frame.length; i++) {
      sum += frame[i] * frame[i - lag];
    }
    autocorr[lag] = sum;
  }
  if (autocorr[0] <= 1e-9) {
    return new Float64Array(order);
  }
  return levinsonDurbin(autocorr, order);
}

function levinsonDurbin(autocorr: Float64Array, order: number): Float64Array {
  let coeffs = new Float64Array(order + 1);
  coeffs[0] = 1;
  let error = autocorr[0];

  for (let i = 1; i <= order; i++) {
    let acc = autocorr[i];
    for (let j = 1; j < i; j++) {
      acc += coeffs[j] * autocorr[i - j];
    }
    const reflection = clamp(-acc / Math.max(error, 1e-9), -0.98, 0.98);
    const updated = coeffs.slice();
    for (let j = 1; j < i; j++) {
      updated[j] = coeffs[j] + reflection * coeffs[i - j];
    }
    updated[i] = reflection;
    coeffs = updated;
    error = Math.max(error * (1 - reflection * reflection), 1e-9);
  }
  return coeffs.slice(1);
}

function quantizeEnergy(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-4));
  const normalized = (db - MIN_ENERGY_DB) / (MAX_ENERGY_DB - MIN_ENERGY_DB);
  return clamp(Math.round(255 * clamp(normalized, 0, 1)), 0, 255);
}

function dequantizeEnergy(energyQ: number): number {
  const db = MIN_ENERGY_DB + (energyQ / 255) * (MAX_ENERGY_DB - MIN_ENERGY_DB);
  return 10 ** (db / 20);
}

function readInt16Be(bytes: Uint8Array, offset: number): number {
  const value = (bytes[offset] << 8) | bytes[offset + 1];
  return value & 0x8000 ? value - 0x10000 : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
