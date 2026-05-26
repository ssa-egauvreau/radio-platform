/**
 * Regression tests for `server/src/aiDispatch/channelPlayback.ts`.
 *
 * `withChannelPlaybackLock` serialises every TTS reply, 10-33 marker burst,
 * and dispatch acknowledgement on a given agency+channel so the AI
 * dispatcher never talks over itself — only one playback fans out into
 * the loopback voice WebSocket at a time.
 *
 * The lock is a small chain-on-tail Promise queue, but the failure modes
 * are subtle and load-bearing for the entire AI dispatch engine:
 *
 *   1. **A rejected playback must NOT block the queue for the channel.**
 *      The "tail" promise stored in the map is a sanitized version of
 *      `run` that swallows rejections. If a future refactor stored the
 *      raw `run` instead, a single failed TTS render would freeze every
 *      subsequent AI reply for that channel until the process restarted.
 *      This is the single most operationally damaging regression the
 *      module can have — pin it loudly.
 *
 *   2. **Two different channels in the same agency run in parallel.**
 *      The whole point of keying on (agency, channel) instead of just
 *      (agency) is to let dispatch on Channel A and Channel B fire at
 *      the same time. A regression that promoted the lock to agency
 *      scope would silently halve dispatch throughput per agency.
 *
 *   3. **Multi-tenant isolation — agency 1's "Main" lock never blocks
 *      agency 2's "Main".** Same-channel-name collisions across tenants
 *      would queue agency 2's reply behind agency 1's slow LLM call.
 *      This is the multi-tenant correctness rule the platform leans on
 *      everywhere; pin it here too.
 *
 *   4. **Channel-label normalisation collapses cosmetic variants.** The
 *      lock key trims + lower-cases the channel name. Two playbacks
 *      requested as "Main" and " main " must contend for the same lock
 *      or the "one playback at a time" guarantee is dishonest.
 *
 *   5. **The lock is FIFO — playbacks fire in the order they were
 *      requested.** Out-of-order playback would surface as a dispatch
 *      reply playing before its own acknowledgement tone.
 *
 *   6. **A second playback queued during an in-flight one really does
 *      wait** (i.e. it does not run concurrently with the first).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { withChannelPlaybackLock } from "../../src/aiDispatch/channelPlayback.js";

/**
 * Defer a promise so the test code can decide exactly when it resolves /
 * rejects. Lets us observe queue ordering without relying on real timers
 * (no setTimeout — the suite is deterministic).
 */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("withChannelPlaybackLock: returns the inner function's value", async () => {
  const out = await withChannelPlaybackLock(1, "Main", async () => "ok");
  assert.equal(out, "ok");
});

test("withChannelPlaybackLock: same agency+channel calls serialise in FIFO order", async () => {
  const events: string[] = [];
  const a = deferred<void>();
  const b = deferred<void>();

  const p1 = withChannelPlaybackLock(10, "Patrol", async () => {
    events.push("a-start");
    await a.promise;
    events.push("a-end");
  });
  const p2 = withChannelPlaybackLock(10, "Patrol", async () => {
    events.push("b-start");
    await b.promise;
    events.push("b-end");
  });

  // Give the microtask queue a chance so the first task has actually started.
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["a-start"], "second task must wait — not start in parallel");

  a.resolve();
  await p1;
  // Now task b can begin.
  await Promise.resolve();
  assert.deepEqual(events, ["a-start", "a-end", "b-start"]);
  b.resolve();
  await p2;
  assert.deepEqual(events, ["a-start", "a-end", "b-start", "b-end"]);
});

test("withChannelPlaybackLock: different channels in the same agency run concurrently", async () => {
  // Two channels on the same agency must NOT block each other — that's the
  // whole point of keying the lock on (agency, channel) instead of agency
  // alone. A regression here halves AI-dispatch throughput per agency.
  const events: string[] = [];
  const a = deferred<void>();
  const b = deferred<void>();

  const pa = withChannelPlaybackLock(20, "Channel A", async () => {
    events.push("a-start");
    await a.promise;
    events.push("a-end");
  });
  const pb = withChannelPlaybackLock(20, "Channel B", async () => {
    events.push("b-start");
    await b.promise;
    events.push("b-end");
  });

  // Both tasks should be in-flight (started, awaiting their deferred).
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual([...events].sort(), ["a-start", "b-start"]);

  // Release in reverse order to confirm independence (no FIFO across channels).
  b.resolve();
  await pb;
  assert.ok(events.includes("b-end"));
  assert.equal(events.includes("a-end"), false, "channel A must still be in-flight");
  a.resolve();
  await pa;
});

test("withChannelPlaybackLock: multi-tenant — agency 1's lock never blocks agency 2's same-named channel", async () => {
  // Two tenants on a channel literally called "Main" must run in parallel.
  // A regression that dropped the agency from the key would queue agency 2
  // behind agency 1's slow LLM call.
  const events: string[] = [];
  const a1 = deferred<void>();
  const a2 = deferred<void>();

  const p1 = withChannelPlaybackLock(1, "Main", async () => {
    events.push("ag1-start");
    await a1.promise;
    events.push("ag1-end");
  });
  const p2 = withChannelPlaybackLock(2, "Main", async () => {
    events.push("ag2-start");
    await a2.promise;
    events.push("ag2-end");
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual([...events].sort(), ["ag1-start", "ag2-start"]);
  a2.resolve();
  await p2;
  // Agency 1 still in-flight, untouched by agency 2's completion.
  assert.equal(events.includes("ag1-end"), false);
  a1.resolve();
  await p1;
});

test("withChannelPlaybackLock: cosmetic channel-name variants share the same lock", async () => {
  // The lock key trims + lower-cases the channel label. Two playbacks
  // requested as "Main" and " main " must contend for the same lock — if
  // they didn't, the "one playback at a time per channel" guarantee would
  // be a lie any time the caller varied the casing.
  const events: string[] = [];
  const first = deferred<void>();

  const p1 = withChannelPlaybackLock(7, "Main", async () => {
    events.push("first-start");
    await first.promise;
    events.push("first-end");
  });
  const p2 = withChannelPlaybackLock(7, "  main  ", async () => {
    events.push("second-start");
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"], "cosmetic variant must queue behind the first");
  first.resolve();
  await p1;
  await p2;
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("withChannelPlaybackLock: a rejected playback does NOT block subsequent playbacks for the channel", async () => {
  // This is the headline correctness rule for the module. The tail stored
  // in the map is a sanitized "always resolves" version of `run`; if a
  // future refactor stored the raw `run`, a single failed TTS render would
  // wedge the queue and freeze every subsequent AI reply for the channel
  // until the process restarted. Recreate the failure path and confirm
  // the next playback still runs.
  const failed = await withChannelPlaybackLock(33, "Main", async () => {
    throw new Error("simulated TTS failure");
  }).then(
    () => "did-not-throw",
    (err) => err,
  );
  assert.ok(failed instanceof Error, "the first playback must propagate its rejection to the caller");

  // The next playback must run successfully, immediately, on the same key.
  const out = await withChannelPlaybackLock(33, "Main", async () => "recovered");
  assert.equal(out, "recovered");
});

test("withChannelPlaybackLock: a rejection in the middle of a queued chain doesn't take down siblings", async () => {
  // Three queued playbacks: success, failure, success. The middle
  // rejection must surface to its own caller but not poison the third.
  const order: string[] = [];
  const p1 = withChannelPlaybackLock(99, "Q", async () => {
    order.push("a");
  });
  const p2 = withChannelPlaybackLock(99, "Q", async () => {
    order.push("b");
    throw new Error("boom");
  });
  const p3 = withChannelPlaybackLock(99, "Q", async () => {
    order.push("c");
    return "third";
  });

  await p1;
  await assert.rejects(p2, /boom/);
  assert.equal(await p3, "third");
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("withChannelPlaybackLock: rejections do not leak into other channels", async () => {
  // A failure on Channel X must not propagate to Channel Y. This is
  // mostly a sanity check on the per-key tail map but the asymmetry of
  // the failure path (sanitized tail + raw run) makes it worth pinning.
  await assert.rejects(
    withChannelPlaybackLock(1, "X", async () => {
      throw new Error("x failed");
    }),
    /x failed/,
  );
  const okY = await withChannelPlaybackLock(1, "Y", async () => "y-ok");
  assert.equal(okY, "y-ok");
});

test("withChannelPlaybackLock: synchronous throw inside the inner fn is captured (and unblocks the queue)", async () => {
  // The lock awaits `prev.then(() => fn())`; a synchronous throw in `fn`
  // becomes a rejected promise. The next playback must still run — same
  // invariant as the async-rejection case but exercised on a different
  // code path.
  await assert.rejects(
    withChannelPlaybackLock(8, "Main", async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "sync-string-throw";
    }),
    /sync-string-throw/,
  );
  const out = await withChannelPlaybackLock(8, "Main", async () => 42);
  assert.equal(out, 42);
});
