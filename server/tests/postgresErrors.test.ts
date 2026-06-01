import { test } from "node:test";
import assert from "node:assert/strict";
import { isPostgresDiskFullError } from "../src/postgresErrors.js";

test("isPostgresDiskFullError: code 53100", () => {
  assert.equal(isPostgresDiskFullError({ code: "53100", message: "disk full" }), true);
});

test("isPostgresDiskFullError: message heuristics", () => {
  assert.equal(
    isPostgresDiskFullError({
      message: 'could not extend file "base/16384/17096": No space left on device',
    }),
    true,
  );
});

test("isPostgresDiskFullError: unrelated errors", () => {
  assert.equal(isPostgresDiskFullError({ code: "23505" }), false);
  assert.equal(isPostgresDiskFullError(null), false);
});
