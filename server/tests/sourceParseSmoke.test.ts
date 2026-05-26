/**
 * Smoke regression: every TypeScript module under `server/src/` must parse.
 *
 * Why this exists
 * ----------------
 * Between PRs #146/#147/#150/#151 the same merge-conflict pattern slipped
 * into FOUR separate files:
 *
 *   - server/src/apiRoutes.ts          (duplicate import + broken res.json)
 *   - server/src/voiceRelay.ts         (half-finished fn signature + stray `*`)
 *   - server/tests/presence.test.ts    (duplicated docblock + unterminated test)
 *   - server/tests/sessionCache.test.ts (duplicated docblock + unclosed fn)
 *
 * Each artifact made the entire file a parse error. `index.ts` imports
 * `apiRoutes.ts` which imports `voiceRelay.ts` which imports … — so the
 * very FIRST production module that failed to parse silently took every
 * downstream module with it. The unit tests for each of those downstream
 * modules then failed with the SAME esbuild TransformError, which made it
 * very hard to tell whether a regression had been introduced in the
 * module under test or in one of its dependencies.
 *
 * This test catches the entire class at the lowest possible level: every
 * source file in `server/src/` must be valid TypeScript that the bundler
 * (esbuild, which is what `tsx` uses to load tests and `tsc` uses to
 * build) can parse without errors.
 *
 * Why not just rely on `tsc --noEmit`?
 *   1. `tsc --noEmit` is not part of `npm test`. CI for tests runs
 *      `npm test`, which uses the node:test runner via tsx. A parse-error
 *      in a file that no live test happens to import would otherwise sail
 *      through the test target.
 *   2. This test catches the failure mode that maps 1:1 to "server crashes
 *      on startup" — production esbuild/tsx transform errors — rather than
 *      the broader set of TS type errors.
 *
 * The check uses esbuild's `transform()` directly (no bundling, no module
 * resolution, no I/O on imports) so it is fast (~tens of ms for the whole
 * tree on a laptop) and has no environmental flakiness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = resolve(__dirname, "..", "src");
const TESTS_ROOT = resolve(__dirname, "..", "tests");

/** Recursively collect every *.ts file under `dir` (skips d.ts and dotfiles). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!st.isFile()) continue;
    if (extname(entry) !== ".ts") continue;
    // Type-only declaration files don't need a parse check — they're
    // consumed by tsc, not loaded at runtime.
    if (entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

async function assertParses(file: string, label: string): Promise<void> {
  const source = readFileSync(file, "utf8");
  try {
    await transform(source, {
      loader: "ts",
      // Pure parse check — no bundler resolution, no minification.
      format: "esm",
      target: "es2022",
      // Treat the file in isolation; we are not type-checking, just
      // verifying the syntax tree is buildable.
      sourcefile: label,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.fail(
      `esbuild could not parse ${label}: ${message}\n` +
        "  -> A merge artifact, stray docblock, duplicate import, or unterminated\n" +
        "     block is most likely. Open the file at the reported line/column.",
    );
  }
}

const SRC_FILES = collectTsFiles(SRC_ROOT);
const TEST_FILES = collectTsFiles(TESTS_ROOT);

// Sanity guard: if someone accidentally points a root at an empty dir the
// test would vacuously pass.
test("smoke: server/src is non-empty", () => {
  assert.ok(
    SRC_FILES.length >= 10,
    `expected to find lots of .ts files under ${SRC_ROOT}, found ${SRC_FILES.length}`,
  );
});

test("smoke: server/tests is non-empty", () => {
  assert.ok(
    TEST_FILES.length >= 10,
    `expected to find lots of .ts files under ${TESTS_ROOT}, found ${TEST_FILES.length}`,
  );
});

// One subtest per source file so a failure pinpoints exactly which file is
// broken without forcing the whole batch to run sequentially.
for (const file of SRC_FILES) {
  const rel = relative(SRC_ROOT, file);
  test(`server/src/${rel} parses as TypeScript`, async () => {
    await assertParses(file, `server/src/${rel}`);
  });
}

for (const file of TEST_FILES) {
  const rel = relative(TESTS_ROOT, file);
  // Skip this file itself — we already prove it parses by running it.
  if (rel === "sourceParseSmoke.test.ts") continue;
  test(`server/tests/${rel} parses as TypeScript`, async () => {
    await assertParses(file, `server/tests/${rel}`);
  });
}
