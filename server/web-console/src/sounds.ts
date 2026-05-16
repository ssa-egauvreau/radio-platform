// Plays the radio's own tone set (copied from the Android assets) for console actions.

const FILES = {
  permit: "/sounds/ptt_permit.wav",
  channelSwitch: "/sounds/channel_switch.wav",
  emergency: "/sounds/emergency.wav",
  busy: "/sounds/busy.wav",
} as const;

const cache = new Map<string, HTMLAudioElement>();
const active = new Set<HTMLAudioElement>();

function template(url: string): HTMLAudioElement {
  let element = cache.get(url);
  if (!element) {
    element = new Audio(url);
    element.preload = "auto";
    cache.set(url, element);
  }
  return element;
}

function play(url: string, volume: number): void {
  // Clone so rapid repeats overlap instead of cutting each other off.
  const clip = template(url).cloneNode(true) as HTMLAudioElement;
  clip.volume = volume;
  active.add(clip);
  clip.addEventListener("ended", () => active.delete(clip));
  // Autoplay can be blocked until the page has been interacted with — ignore that.
  void clip.play().catch(() => undefined);
}

export const sounds = {
  /** Talk-permit tone — played when the operator keys up. */
  permit: () => play(FILES.permit, 1),
  /** Channel-change blip. */
  channelSwitch: () => play(FILES.channelSwitch, 0.7),
  /** Emergency alert tone. */
  emergency: () => play(FILES.emergency, 1),
  /** Repeater-busy tone. */
  busy: () => play(FILES.busy, 0.8),
  /** Stop All Sounds — silences every alert/page tone currently playing. */
  stopAll: () => {
    for (const clip of active) {
      clip.pause();
      clip.currentTime = 0;
    }
    active.clear();
  },
  /** Warms the browser cache so the first tone is not delayed. */
  preload: () => {
    for (const url of Object.values(FILES)) {
      template(url);
    }
  },
};
