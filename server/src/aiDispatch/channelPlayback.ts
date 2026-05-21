/** One playback at a time per agency + channel (TTS + 10-33 marker tones). */

const tails = new Map<string, Promise<void>>();

function lockKey(agencyId: number, channelName: string): string {
  return `${agencyId}:${channelName.trim().toLowerCase()}`;
}

export async function withChannelPlaybackLock<T>(
  agencyId: number,
  channelName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(agencyId, channelName);
  const prev = tails.get(key) ?? Promise.resolve();
  let done!: () => void;
  const gate = new Promise<void>((resolve) => {
    done = resolve;
  });
  const run = prev
    .then(() => gate)
    .then(fn)
    .finally(() => {
      done();
    });
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
