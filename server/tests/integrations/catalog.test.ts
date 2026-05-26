/**
 * Regression tests for `server/src/integrations/catalog.ts`.
 *
 * The integration catalog is the single source of truth for *which*
 * agency-scoped configuration keys the platform will accept. Two code
 * paths gate writes/reads against it:
 *
 *  - `handleSetIntegration` (PUT /v1/admin/integrations/:key) rejects
 *    any key for which `isIntegrationKey` returns false with a 404.
 *    A regression that broadened acceptance here would let an
 *    authenticated admin write arbitrary `agency_integrations` rows —
 *    every one of which is read back into runtime config (CAD API
 *    keys, AI dispatch keys, webhook bearer tokens). Worst case, an
 *    admin could shadow a future legitimate key the platform later
 *    adds and silently exfiltrate or swap secrets.
 *
 *  - `readAgencyIntegrationSecret` (server-side reader called by
 *    plate lookup, 10-8 CAD writes, AI dispatch TTS, etc.) early-
 *    returns `null` for unknown keys. A regression that loosened
 *    this would let a caller inside the server probe arbitrary
 *    integration_key rows by name.
 *
 * What these tests pin:
 *
 *   1. `isIntegrationKey` returns true for every catalog entry and
 *      false for every plausible attacker-controlled key (empty,
 *      whitespace, casing-mismatched, typo'd, unrelated string).
 *   2. `getIntegrationDefinition` returns the exact same object
 *      referenced from the exported catalog (lookups must not return
 *      a copy whose fields could drift from the source of truth).
 *   3. Every catalog entry has a unique `key` — a duplicate would
 *      mean two definitions resolve to the same row and silently
 *      collide on writes.
 *   4. Every catalog entry's `key` is a stable, ASCII, lowercase,
 *      underscore-only identifier (no spaces, no hyphens, no upper
 *      case) — these keys are used verbatim as URL path params and
 *      as Postgres values, so a regression that snuck a space or a
 *      slash into a key would either 404 the route or break the
 *      audit log target field.
 *   5. Every entry's `group` is one of the documented six groups —
 *      `handleListIntegrations` indexes into a `GROUP_LABELS` const
 *      keyed by these literals, so a typo would throw at runtime
 *      when the admin page first loads.
 *   6. Every entry's `kind` is one of the documented four kinds —
 *      `handleSetIntegration` length-caps and URL-validates based on
 *      `kind`, so an unrecognised kind silently disables validation.
 *   7. Every entry's `availability` is one of `"active"` or
 *      `"coming_soon"` — `handleSetIntegration` rejects writes to
 *      anything that is not "active", so a typo here would also
 *      disable write protection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_DEFINITIONS,
  getIntegrationDefinition,
  isIntegrationKey,
} from "../../src/integrations/catalog.js";

const VALID_GROUPS = new Set([
  "ai_dispatch",
  "webhooks",
  "lookups",
  "ten8_cad",
  "ten8_new_incident",
]);
const VALID_KINDS = new Set(["secret", "text", "url", "multiline"]);
const VALID_AVAILABILITIES = new Set(["active", "coming_soon"]);
/** Stable identifier shape: lowercase ASCII letters, digits, underscores. */
const VALID_KEY_RE = /^[a-z][a-z0-9_]*$/;

test("INTEGRATION_DEFINITIONS: catalog is non-empty (regression guard if a definition is accidentally deleted)", () => {
  assert.ok(
    INTEGRATION_DEFINITIONS.length > 0,
    "catalog must list at least one integration — an empty catalog 404s every admin write",
  );
});

test("INTEGRATION_DEFINITIONS: every key is unique", () => {
  // Duplicate keys would silently overwrite each other in the BY_KEY
  // map, so `getIntegrationDefinition` would return whichever the
  // duplicate iterator visited last — non-deterministic and untestable.
  const seen = new Set<string>();
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      seen.has(def.key),
      false,
      `duplicate integration key in catalog: ${JSON.stringify(def.key)}`,
    );
    seen.add(def.key);
  }
});

test("INTEGRATION_DEFINITIONS: every key matches the stable identifier shape", () => {
  // These keys appear as URL params (PUT /v1/admin/integrations/:key)
  // and in Postgres values. Spaces, slashes, casing variants, or
  // unicode would break routing and audit logging silently.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.match(
      def.key,
      VALID_KEY_RE,
      `integration key ${JSON.stringify(def.key)} must be lowercase ASCII letters/digits/underscores only`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: every group is one of the documented six", () => {
  // GROUP_LABELS in adminApi.ts is a Record keyed by these literals.
  // A typo here would throw at runtime when the admin page loads.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      VALID_GROUPS.has(def.group),
      true,
      `integration ${JSON.stringify(def.key)} has unknown group ${JSON.stringify(def.group)}`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: every kind is one of the documented four", () => {
  // `handleSetIntegration` length-caps and URL-validates per `kind`.
  // An unrecognised kind silently falls through every validation
  // branch and writes the raw value untouched.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      VALID_KINDS.has(def.kind),
      true,
      `integration ${JSON.stringify(def.key)} has unknown kind ${JSON.stringify(def.kind)}`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: every availability is one of the documented two", () => {
  // `handleSetIntegration` rejects writes to anything not "active".
  // A typo would either disable that protection (if it changed
  // "coming_soon" to a typo) or block legitimate writes (if it
  // changed "active" to a typo).
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      VALID_AVAILABILITIES.has(def.availability),
      true,
      `integration ${JSON.stringify(def.key)} has unknown availability ${JSON.stringify(def.availability)}`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: every entry has a non-empty label and description (admin UI rendering)", () => {
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.ok(def.label && def.label.length > 0, `${def.key} missing label`);
    assert.ok(
      def.description && def.description.length > 0,
      `${def.key} missing description`,
    );
  }
});

test("isIntegrationKey: returns true for every catalog entry", () => {
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      isIntegrationKey(def.key),
      true,
      `catalog declares ${JSON.stringify(def.key)} but isIntegrationKey rejects it`,
    );
  }
});

test("isIntegrationKey: rejects unknown / attacker-controlled keys", () => {
  // None of these are in the catalog. Every one of them must return
  // false; otherwise an admin could write arbitrary rows to
  // agency_integrations.
  const unknownKeys = [
    "",
    " ",
    "elevenlabs_api_key ", // trailing space
    " elevenlabs_api_key", // leading space
    "ELEVENLABS_API_KEY", // wrong case
    "elevenlabsapikey", // missing underscore
    "elevenlabs-api-key", // hyphen instead of underscore
    "elevenlabs_api_key2", // typo'd suffix
    "javascript_injection",
    "../etc/passwd",
    "elevenlabs_api_key\n", // newline at end
    "elevenlabs_api_key\u0000", // null byte injected
  ];
  for (const key of unknownKeys) {
    assert.equal(
      isIntegrationKey(key),
      false,
      `isIntegrationKey must reject ${JSON.stringify(key)} — it is not in the catalog`,
    );
  }
});

test("getIntegrationDefinition: returns the catalog object verbatim (no defensive copy)", () => {
  // The exact reference matters: the admin handler reads .kind and
  // .availability off the returned definition and a defensive copy
  // could quietly drift if the schema is extended with non-enumerable
  // fields. Identity is the strongest guarantee that consumers see the
  // declared definition unchanged.
  for (const def of INTEGRATION_DEFINITIONS) {
    const looked = getIntegrationDefinition(def.key);
    assert.equal(looked, def, `getIntegrationDefinition(${def.key}) must return the canonical catalog object`);
  }
});

test("getIntegrationDefinition: returns undefined for unknown keys", () => {
  // The handler chains `getIntegrationDefinition(key)!` after the
  // `isIntegrationKey` check, so this function returning anything
  // truthy for an unknown key would shadow the security check.
  assert.equal(getIntegrationDefinition("not_a_real_key"), undefined);
  assert.equal(getIntegrationDefinition(""), undefined);
  assert.equal(getIntegrationDefinition("ELEVENLABS_API_KEY"), undefined);
});

test("isIntegrationKey + getIntegrationDefinition: agreement is total", () => {
  // The two helpers MUST agree on every key. If isIntegrationKey says
  // "yes" but getIntegrationDefinition returns undefined, the admin
  // handler's `getIntegrationDefinition(key)!` non-null assertion
  // crashes the request with an unhelpful 500.
  for (const def of INTEGRATION_DEFINITIONS) {
    const known = isIntegrationKey(def.key);
    const looked = getIntegrationDefinition(def.key);
    assert.equal(known && looked !== undefined, true, `mismatch on ${def.key}`);
  }
  // And for an arbitrarily-chosen non-catalog key, both must reject.
  const phantom = "phantom_integration_xyz";
  assert.equal(isIntegrationKey(phantom), false);
  assert.equal(getIntegrationDefinition(phantom), undefined);
});

test("INTEGRATION_DEFINITIONS: ten8 CAD write key + secret are both listed (paired credentials)", () => {
  // The 10-8 v1.0.8 reads + comments require BOTH ten8_api_key AND
  // ten8_api_secret. A regression that dropped either half would leave
  // CAD posts mysteriously 401-ing at runtime with no admin UI to fix
  // them.
  assert.ok(getIntegrationDefinition("ten8_api_key"), "ten8_api_key must be in the catalog");
  assert.ok(getIntegrationDefinition("ten8_api_secret"), "ten8_api_secret must be in the catalog");
  // Same paired-credential rule for the 'New Incident' API.
  assert.ok(getIntegrationDefinition("ten8_new_incident_api_key"));
  assert.ok(getIntegrationDefinition("ten8_new_incident_api_secret"));
});

test("INTEGRATION_DEFINITIONS: secrets remain marked kind=\"secret\" (regression guard for redaction)", () => {
  // `maskSecret` in mask.ts redacts based on `def.kind === "secret"`.
  // If a value that holds a real secret (an API key) were ever
  // reclassified to `text` or `url`, its plaintext would appear in the
  // admin Integrations GET response — a high-impact information
  // disclosure. Pin every known-secret key to kind=secret here.
  const knownSecretKeys = [
    "elevenlabs_api_key",
    "license_plate_lookup_api_key",
    "vin_lookup_api_key",
    "google_maps_geocoding_api_key",
    "ten8_webhook_secret",
    "ten8_api_key",
    "ten8_api_secret",
    "ten8_new_incident_api_key",
    "ten8_new_incident_api_secret",
  ];
  for (const key of knownSecretKeys) {
    const def = getIntegrationDefinition(key);
    assert.ok(def, `expected ${key} to exist in catalog`);
    assert.equal(
      def!.kind,
      "secret",
      `${key} must stay kind="secret" or its value will be returned in plain text by GET /v1/admin/integrations`,
    );
  }
});
