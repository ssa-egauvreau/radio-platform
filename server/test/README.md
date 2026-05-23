# Server tests

Pure-logic regression tests for high-risk server modules.

- Runner: Node's built-in `node:test` driven by `tsx` (no extra dependencies).
- Run with `npm test` from `server/`.
- Tests must be deterministic and isolated; do **not** touch the database, the
  network, or `process.env` unless the test owns those values.
- Files live in `server/test/**/*.test.ts` and import production code from
  `../src/...js` (NodeNext ESM paths, the same form the rest of the codebase
  uses).

Why these targets:

The recent merged commits have been almost entirely UI/CSS for the dispatch
console. The high blast-radius logic that has *also* shifted recently is the
10-8 CAD integration (address normalization for Google's geocoder, call-type
table, priority clamping, AI-dispatch parse contract). Those modules are pure
TypeScript, easy to pin with deterministic tests, and a regression in any of
them silently sends bad data to the live dispatch system.
