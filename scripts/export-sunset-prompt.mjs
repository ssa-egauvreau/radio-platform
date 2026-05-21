#!/usr/bin/env node
/**
 * Re-export Sunset Safety SYSTEM_PROMPT from 10-8-alert-dashboard into safeT.
 * Usage: node scripts/export-sunset-prompt.mjs /path/to/10-8-alert-dashboard/dispatcher-server.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcPath = process.argv[2];
if (!srcPath) {
  console.error("Usage: node scripts/export-sunset-prompt.mjs <dispatcher-server.js>");
  process.exit(1);
}

const lines = fs.readFileSync(srcPath, "utf8").split("\n");
const ranges = [
  [35, 338],
  [512, 533],
  [990, 1017],
  [1124, 2165],
];
const chunk = ranges.map(([a, b]) => lines.slice(a - 1, b).join("\n")).join("\n");
const m = { exports: {} };
// eslint-disable-next-line no-new-func
new Function("module", "exports", `${chunk}\nmodule.exports = { SYSTEM_PROMPT };`)(m, m.exports);

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../server/src/aiDispatch/prompts/sunsetSafetySystemPrompt.txt",
);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, m.exports.SYSTEM_PROMPT);
console.log(`Wrote ${out} (${m.exports.SYSTEM_PROMPT.length} chars)`);
