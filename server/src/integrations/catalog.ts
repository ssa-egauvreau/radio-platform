/**
 * Registry of per-agency integration slots shown on the admin Integrations page.
 * Platform-wide AI dispatcher behavior is configured via Railway env (see aiDispatch/platformConfig.ts).
 */

export type IntegrationFieldKind = "secret" | "text" | "url" | "multiline";

export type IntegrationAvailability = "active" | "coming_soon";

export interface IntegrationDefinition {
  key: string;
  label: string;
  description: string;
  kind: IntegrationFieldKind;
  group: "ai_dispatch" | "webhooks" | "lookups" | "ten8_cad";
  availability: IntegrationAvailability;
  /** Optional placeholder for empty inputs in the admin UI. */
  placeholder?: string;
}

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [
  {
    key: "elevenlabs_api_key",
    label: "ElevenLabs API key",
    description: "Text-to-speech for the built-in AI dispatcher on channels where AI dispatch is enabled.",
    kind: "secret",
    group: "ai_dispatch",
    availability: "active",
    placeholder: "sk_…",
  },
  {
    key: "elevenlabs_voice_id",
    label: "ElevenLabs voice ID",
    description: "Voice used for AI dispatcher replies (from your ElevenLabs voice library).",
    kind: "text",
    group: "ai_dispatch",
    availability: "active",
    placeholder: "e.g. 21m00Tcm4TlvDq8ikWAM",
  },
  {
    key: "ai_dispatch_system_prompt",
    label: "AI dispatcher system prompt",
    description:
      "Instructions for your agency only: 10-codes, call signs, tone, and local radio policy. " +
      "If empty, the server default from Railway is used.",
    kind: "multiline",
    group: "ai_dispatch",
    availability: "active",
    placeholder:
      "Example: You are dispatch for Metro Fire. Use 10-4 for acknowledge. Units are called by number…",
  },
  {
    key: "outbound_webhook_url",
    label: "Outbound webhook URL",
    description:
      "Optional HTTPS endpoint that receives JSON when the AI dispatcher acts (transcript in, reply out). For your own logging or CAD hooks.",
    kind: "url",
    group: "webhooks",
    availability: "active",
    placeholder: "https://…",
  },
  {
    key: "license_plate_lookup_api_key",
    label: "License plate lookup API key",
    description: "PlateToVIN.com API key for 912 plate lookups (Authorization header, no Bearer prefix).",
    kind: "secret",
    group: "lookups",
    availability: "active",
    placeholder: "PlateToVIN key",
  },
  {
    key: "vin_lookup_api_key",
    label: "VIN lookup API key",
    description: "Auto.dev API key for 17-character VIN decode. Falls back to plate key if empty.",
    kind: "secret",
    group: "lookups",
    availability: "active",
  },
  {
    key: "plate_lookup_default_state",
    label: "Default plate state",
    description: "Two-letter state when the officer does not say one (default CA).",
    kind: "text",
    group: "lookups",
    availability: "active",
    placeholder: "CA",
  },
  {
    key: "ten8_webhook_secret",
    label: "10-8 webhook bearer token",
    description:
      "Bearer token 10-8 Systems sends when posting incident exports to your safeT webhook URL.",
    kind: "secret",
    group: "webhooks",
    availability: "active",
  },
  {
    key: "ten8_api_key",
    label: "10-8 CAD API key",
    description: "X-API-Key from 10-8 support — used when AI posts CAD comments (optional).",
    kind: "secret",
    group: "ten8_cad",
    availability: "active",
  },
  {
    key: "ten8_api_secret",
    label: "10-8 CAD API secret",
    description: "X-API-Secret paired with the 10-8 API key.",
    kind: "secret",
    group: "ten8_cad",
    availability: "active",
  },
  {
    key: "ten8_api_base_url",
    label: "10-8 CAD API base URL",
    description: "Optional override; default is the standard 10-8 AWS gateway URL.",
    kind: "url",
    group: "ten8_cad",
    availability: "active",
    placeholder: "https://ps569km5w9.execute-api.us-gov-west-1.amazonaws.com/prod",
  },
  {
    key: "ten8_live_execution",
    label: "10-8 live CAD writes",
    description: "Set to 1 or true to actually post comments to 10-8 (otherwise shadow/log only).",
    kind: "text",
    group: "ten8_cad",
    availability: "active",
    placeholder: "0",
  },
];

const BY_KEY = new Map(INTEGRATION_DEFINITIONS.map((d) => [d.key, d]));

export function getIntegrationDefinition(key: string): IntegrationDefinition | undefined {
  return BY_KEY.get(key);
}

export function isIntegrationKey(key: string): boolean {
  return BY_KEY.has(key);
}
