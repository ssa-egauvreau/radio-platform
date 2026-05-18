// Plays the radio's UI tones for console actions. Each agency may upload its
// own tone set; absent a custom upload, the bundled default is used.

import { getToken } from "./api";

interface SoundDef {
  /** Server-side sound kind for `/v1/sounds/:kind`. */
  server: string;
  /** Bundled fallback, served as a static asset. */
  bundled: string;
  volume: number;
}

const SOUNDS = {
  permit: { server: "permit", bundled: "/sounds/ptt_permit.wav", volume: 1 },
  channelSwitch: { server: "channel_switch", bundled: "/sounds/channel_switch.wav", volume: 0.7 },
  emergency: { server: "emergency", bundled: "/sounds/emergency.wav", volume: 1 },
  busy: { server: "busy", bundled: "/sounds/busy.wav", volume: 0.8 },
} satisfies Record<string, SoundDef>;

type SoundKey = keyof typeof SOUNDS;

/** Playable URL per key — the agency's custom tone when present, else the bundled file. */
const resolved: Record<SoundKey, string> = {
  permit: SOUNDS.permit.bundled,
  channelSwitch: SOUNDS.channelSwitch.bundled,
  emergency: SOUNDS.emergency.bundled,
  busy: SOUNDS.busy.bundled,
};

const cache = new Map<string, HTMLAudioElement>();
const active = new Set<HTMLAudioElement>();

/** The single looping channel-busy clip, while an operator keys a busy channel. */
let busyLoopClip: HTMLAudioElement | null = null;

function template(url: string): HTMLAudioElement {
  let element = cache.get(url);
  if (!element) {
    element = new Audio(url);
    element.preload = "auto";
    cache.set(url, element);
  }
  return element;
}

function play(key: SoundKey): void {
  // Clone so rapid repeats overlap instead of cutting each other off.
  const clip = template(resolved[key]).cloneNode(true) as HTMLAudioElement;
  clip.volume = SOUNDS[key].volume;
  active.add(clip);
  clip.addEventListener("ended", () => active.delete(clip));
  // Autoplay can be blocked until the page has been interacted with — ignore that.
  void clip.play().catch(() => undefined);
}

/** Fetches the agency's custom tone, swapping it in for the bundled default. */
async function loadCustom(key: SoundKey): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`/v1/sounds/${SOUNDS[key].server}`, { headers });
    if (!res.ok) {
      return; // no custom tone — keep the bundled default
    }
    const url = URL.createObjectURL(await res.blob());
    resolved[key] = url;
    template(url); // warm the cache
  } catch {
    /* keep the bundled default */
  }
}

export const sounds = {
  /** Talk-permit tone — played when the operator keys up. */
  permit: () => play("permit"),
  /** Channel-change blip. */
  channelSwitch: () => play("channelSwitch"),
  /** Emergency alert tone. */
  emergency: () => play("emergency"),
  /** Starts the channel-busy tone looping — held while an operator keys a busy channel. */
  busyLoopStart: () => {
    if (busyLoopClip) {
      return;
    }
    const clip = template(resolved.busy).cloneNode(true) as HTMLAudioElement;
    clip.loop = true;
    clip.volume = SOUNDS.busy.volume;
    busyLoopClip = clip;
    active.add(clip);
    void clip.play().catch(() => undefined);
  },
  /** Stops the looping channel-busy tone (operator released the key). */
  busyLoopStop: () => {
    if (!busyLoopClip) {
      return;
    }
    busyLoopClip.pause();
    busyLoopClip.currentTime = 0;
    active.delete(busyLoopClip);
    busyLoopClip = null;
  },
  /** Stop All Sounds — silences every alert/page tone currently playing. */
  stopAll: () => {
    busyLoopClip = null;
    for (const clip of active) {
      clip.pause();
      clip.currentTime = 0;
    }
    active.clear();
  },
  /** Warms the browser cache and pulls in any agency-custom tones. */
  preload: () => {
    for (const key of Object.keys(SOUNDS) as SoundKey[]) {
      template(resolved[key]);
      void loadCustom(key);
    }
  },
};
