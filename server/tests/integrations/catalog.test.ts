/**
 * Tests for `server/src/integrations/catalog.ts`.
 *
 * The integrations catalog is the single source of truth for the per-agency
 * Admin → Integrations page: every secret slot (ElevenLabs key, PlateToVIN
 * key, 10-8 CAD credentials, AI dispatch system prompt, outbound webhook URL,
 * …) is declared here exactly once. The Admin UI reads it to render the form,
 * the `apiRoutes.ts` /v1/integrations/* writers use {@link isIntegrationKey}
 * to reject unknown slots, and `mask.ts` uses the `kind` field to decide how
 * to redact a stored value before sending it back to the browser.
 *
 * A regression in this file ripples into every admin surface that touches
 * integrations:
 *
 *  - Duplicate `key` entries silently shadow the earlier definition (and
 *    confuse the BY_KEY lookup map) — the symptom is a description / kind
 *    that doesn't match the saved value's mask format, so a `secret`-marked
 *    key could be re-displayed as `text` (cleartext leak in the UI).
 *  - A misspelled / unknown `kind` would slip past TypeScript at runtime
 *    if a future contributor used `as IntegrationFieldKind` to bypass the
 *    type checker, breaking `mask.ts`'s switch fall-through to the verbatim
 *    return (raw value sent to the browser).
 *  - A misspelled `group` would orphan the slot in the admin UI — the form
 *    groups by this key, so a typo means the field renders under no header
 *    and admins can't find it.
 *  - `getIntegrationDefinition` returning the wrong shape on the
 *    `ten8_webhook_allow_unauthenticated` slot regresses the
 *    open-incident-export bypass (the route reads this slot to decide
 *    whether the webhook accepts an unsigned POST).
 *  - `isIntegrationKey` returning `true` for an unknown key would let the
 *    writer endpoint save arbitrary keys into agency_integrations, blanking
 *    or shadowing real slots.
 *
 * The tests here are pure and deterministic — no env, no DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_DEFINITIONS,
  getIntegrationDefinition,
  isIntegrationKey,
  type IntegrationDefinition,
} from "../../src/integrations/catalog.js";

const VALID_KINDS = new Set(["secret", "text", "url", "multiline"]);
const VALID_GROUPS = new Set([
  "ai_dispatch",
  "webhooks",
  "lookups",
  "ten8_cad",
  "ten8_new_incident",
]);
const VALID_AVAILABILITY = new Set(["active", "coming_soon"]);

test("INTEGRATION_DEFINITIONS: catalog has unique `key` values (no duplicate slots)", () => {
  // Duplicate keys silently shadow earlier entries in the BY_KEY map —
  // a secret slot could be replaced by a text slot of the same key,
  // breaking the mask path and leaking cleartext to the browser.
  const seen = new Set<string>();
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.ok(
      !seen.has(def.key),
      `integration key "${def.key}" is declared more than once in the catalog`,
    );
    seen.add(def.key);
  }
});

test("INTEGRATION_DEFINITIONS: every definition exposes the documented shape", () => {
  // Defends every reader (Admin UI, /v1/integrations writers, mask.ts) from
  // a contributor introducing a partially-typed entry that compiles but
  // crashes at runtime when an optional field is accessed.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(typeof def.key, "string", `key on ${JSON.stringify(def)}`);
    assert.ok(def.key.length > 0, "key must not be empty");
    assert.equal(typeof def.label, "string", `label on ${def.key}`);
    assert.ok(def.label.length > 0, `label on ${def.key} must not be empty`);
    assert.equal(typeof def.description, "string", `description on ${def.key}`);
    assert.ok(
      def.description.length > 0,
      `description on ${def.key} must not be empty (admin UI shows it)`,
    );
    assert.ok(
      VALID_KINDS.has(def.kind),
      `kind "${def.kind}" on ${def.key} is not one of ${[...VALID_KINDS].join("/")}`,
    );
    assert.ok(
      VALID_GROUPS.has(def.group),
      `group "${def.group}" on ${def.key} is not one of ${[...VALID_GROUPS].join("/")}`,
    );
    assert.ok(
      VALID_AVAILABILITY.has(def.availability),
      `availability "${def.availability}" on ${def.key} is not one of ${[...VALID_AVAILABILITY].join("/")}`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: every key uses snake_case (no spaces, no uppercase)", () => {
  // The key is used as the DB column value in `agency_integrations.key` and
  // is referenced verbatim from server code (e.g. `getAgencyIntegrationValue(...,
  // "elevenlabs_api_key")`). Allowing mixed case or spaces here would create a
  // class of "lookup returns null because case mismatched" bugs that only
  // surface in production.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.match(
      def.key,
      /^[a-z0-9_]+$/,
      `key "${def.key}" must be snake_case lowercase`,
    );
  }
});

test("getIntegrationDefinition: returns the same object reference for a known key", () => {
  const def = getIntegrationDefinition("elevenlabs_api_key");
  assert.ok(def, "ElevenLabs API key slot must exist");
  assert.equal(def.kind, "secret");
  assert.equal(def.group, "ai_dispatch");
});

test("getIntegrationDefinition: returns undefined for an unknown key", () => {
  // The writer endpoint inverts isIntegrationKey to reject saves of unknown
  // keys; getIntegrationDefinition must agree (a key the catalog rejects
  // must also have no definition to read).
  assert.equal(getIntegrationDefinition("definitely-not-a-real-key"), undefined);
  assert.equal(getIntegrationDefinition(""), undefined);
  // Case sensitivity matters: the catalog keys are snake_case lowercase.
  assert.equal(getIntegrationDefinition("ELEVENLABS_API_KEY"), undefined);
});

test("isIntegrationKey: accepts every catalog key and rejects unknowns", () => {
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(
      isIntegrationKey(def.key),
      true,
      `catalog key "${def.key}" must be recognised by isIntegrationKey`,
    );
  }
  for (const bad of [
    "",
    "not-a-real-slot",
    "ai_dispatch_systemprompt", // missing underscore — typo class
    "ELEVENLABS_API_KEY", // wrong case
    "elevenlabs_api_key ", // trailing whitespace — no trim
  ]) {
    assert.equal(
      isIntegrationKey(bad),
      false,
      `unknown key "${bad}" must be rejected by isIntegrationKey`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: known security-sensitive slots are declared as `secret`", () => {
  // The mask.ts pipeline only redacts values whose definition.kind === "secret".
  // If any of these slots were ever flipped to "text" the admin UI would
  // re-display the cleartext API key. Pin the contract explicitly so a casual
  // edit to the catalog can't degrade the masking guarantee.
  const mustBeSecret = [
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
  for (const key of mustBeSecret) {
    const def = getIntegrationDefinition(key);
    assert.ok(def, `expected catalog to declare "${key}"`);
    assert.equal(
      def.kind,
      "secret",
      `${key} must be kind="secret" — flipping it to ${def.kind} would re-expose the cleartext key in the admin UI`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: ai_dispatch_system_prompt is `multiline` (mask reports length, never echoes prompt)", () => {
  // System prompts can run thousands of characters and contain agency-
  // specific policy. mask.ts treats `multiline` as "report char count,
  // never echo content"; a regression to `secret` would dump only the
  // last 4 chars, and to `text` would echo the entire prompt back into
  // the admin UI HTML.
  const def = getIntegrationDefinition("ai_dispatch_system_prompt");
  assert.ok(def);
  assert.equal(def.kind, "multiline");
  assert.equal(def.group, "ai_dispatch");
});

test("INTEGRATION_DEFINITIONS: outbound_webhook_url is kind='url' so long URLs are elided, not masked", () => {
  // Webhooks are not secrets by themselves (the secret is in the bearer
  // token or query token), so the slot must stay a URL — mask.ts will
  // elide the middle of a long URL but keep enough for the admin to
  // recognise it. Flipping this to "secret" would dot out everything and
  // make admins re-enter the URL on every reload.
  const def = getIntegrationDefinition("outbound_webhook_url");
  assert.ok(def);
  assert.equal(def.kind, "url");
  assert.equal(def.group, "webhooks");
});

test("INTEGRATION_DEFINITIONS: ten8_webhook_allow_unauthenticated is text (admin toggles by typing 1)", () => {
  // The route reads this slot's trimmed value and compares to "1" to bypass
  // bearer-token auth on the incident-export webhook. Marking it as a
  // secret would mask the existing value and trick an admin into thinking
  // it's unset (they'd re-enable the bypass by accident).
  const def = getIntegrationDefinition("ten8_webhook_allow_unauthenticated");
  assert.ok(def);
  assert.equal(def.kind, "text");
  assert.equal(def.group, "webhooks");
});

test("INTEGRATION_DEFINITIONS: ai_dispatch group covers the slots the dispatcher reads at runtime", () => {
  // The AI dispatcher engine reads (transitively) elevenlabs_api_key,
  // elevenlabs_voice_id, and ai_dispatch_system_prompt. If any are missing
  // from the ai_dispatch group, they'd render in the wrong section of the
  // admin UI and admins might not notice they need to set them — silently
  // disabling AI dispatch on that agency.
  const aiKeys = new Set(
    INTEGRATION_DEFINITIONS.filter((d) => d.group === "ai_dispatch").map((d) => d.key),
  );
  for (const key of [
    "elevenlabs_api_key",
    "elevenlabs_voice_id",
    "ai_dispatch_system_prompt",
  ]) {
    assert.ok(
      aiKeys.has(key),
      `${key} must be grouped under "ai_dispatch" — it's read by the AI dispatcher engine`,
    );
  }
});

test("INTEGRATION_DEFINITIONS: 10-8 CAD credential pair lives together in the ten8_cad group", () => {
  // The CAD client expects both ten8_api_key and ten8_api_secret to be set
  // together (basic-auth pair). Keeping them in the same admin group is the
  // only visual hint that they're a pair; splitting one out would make it
  // very easy to forget to set the partner.
  const ten8Cad = new Set(
    INTEGRATION_DEFINITIONS.filter((d) => d.group === "ten8_cad").map((d) => d.key),
  );
  assert.ok(ten8Cad.has("ten8_api_key"));
  assert.ok(ten8Cad.has("ten8_api_secret"));
  assert.ok(ten8Cad.has("ten8_api_base_url"));
});

test("INTEGRATION_DEFINITIONS: 10-8 new-incident credential pair lives together in ten8_new_incident", () => {
  // Same pairing argument as ten8_cad — but for the *separate* New Incident
  // API key/secret. The CAD comment credentials and the new-incident
  // credentials are distinct in 10-8's API and must not be conflated.
  const newInc = new Set(
    INTEGRATION_DEFINITIONS.filter((d) => d.group === "ten8_new_incident").map(
      (d) => d.key,
    ),
  );
  assert.ok(newInc.has("ten8_new_incident_api_key"));
  assert.ok(newInc.has("ten8_new_incident_api_secret"));
  assert.ok(newInc.has("ten8_new_incident_api_base_url"));
});

test("INTEGRATION_DEFINITIONS: list is non-empty (smoke test against an accidental clear-all edit)", () => {
  // An edit that emptied the array would silently disable the entire Admin →
  // Integrations form. Cheap insurance.
  assert.ok(
    INTEGRATION_DEFINITIONS.length >= 10,
    `catalog dropped to ${INTEGRATION_DEFINITIONS.length} entries — did an edit accidentally remove slots?`,
  );
});

test("INTEGRATION_DEFINITIONS: placeholders, when present, are strings (renderable as <input placeholder>)", () => {
  // The Admin UI binds def.placeholder directly to <input placeholder>; a
  // non-string here would render "[object Object]" or crash React's
  // type-strict prop checker.
  for (const def of INTEGRATION_DEFINITIONS) {
    if (def.placeholder !== undefined) {
      assert.equal(
        typeof def.placeholder,
        "string",
        `placeholder on ${def.key} must be a string, got ${typeof def.placeholder}`,
      );
    }
  }
});

test("getIntegrationDefinition / isIntegrationKey: agree on every catalog key", () => {
  // Belt-and-braces invariant: if isIntegrationKey says "yes", lookup must
  // succeed; if it says "no", lookup must return undefined. A regression in
  // either function relative to the other creates a write-allowed but
  // read-orphaned slot (or vice versa) in agency_integrations.
  for (const def of INTEGRATION_DEFINITIONS) {
    assert.equal(isIntegrationKey(def.key), true);
    const looked: IntegrationDefinition | undefined = getIntegrationDefinition(def.key);
    assert.equal(looked, def, `${def.key}: getIntegrationDefinition must return the same object`);
  }
});
