# Integrations and AI dispatcher

safeT separates **who configures what**:

| Layer | Where | Examples |
|-------|--------|----------|
| **Platform (Railway env)** | Server operator | AI dispatcher on/off, LLM API key, model, default system prompt |
| **Per agency (Admin → Integrations)** | Each tenant’s admin | ElevenLabs API key & voice, outbound webhook URL |
| **Per channel (coming next)** | Dispatch console | Turn AI dispatcher on/off per channel (like 10-33 marker) |

License plate lookup, VIN decode, and similar tools will use **Integrations → Lookups** when those portal features are added.

---

## Railway environment variables (AI dispatcher)

Set these on the **safeT PTT** service in Railway (not in the Integrations page).

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_DISPATCH_ENABLED` | No | `1` / `true` to allow AI dispatch when agency + channel are configured. Default off. |
| `AI_DISPATCH_LLM_API_KEY` | For AI | API key for the LLM provider (OpenAI-compatible). |
| `AI_DISPATCH_LLM_BASE_URL` | No | Default `https://api.openai.com/v1` |
| `AI_DISPATCH_LLM_MODEL` | No | Default `gpt-4o-mini` |
| `AI_DISPATCH_SYSTEM_PROMPT` | No | Default public-safety dispatcher prompt |
| `AI_DISPATCH_UNIT_ID` | No | Unit id on the radio when AI keys up (default `AI-DISPATCH`) |
| `AI_DISPATCH_YIELDS_DEFAULT` | No | Default `1` — AI yields to live units on a channel |

Example:

```env
AI_DISPATCH_ENABLED=1
AI_DISPATCH_LLM_API_KEY=sk-...
AI_DISPATCH_LLM_MODEL=gpt-4o-mini
```

Restart the service after changing env vars.

---

## Agency Integrations page

**Path:** Sign in as **admin** → **Admin** → **Integrations**.

- **ElevenLabs API key** — TTS for that agency’s AI replies.
- **ElevenLabs voice ID** — Voice from your ElevenLabs library.
- **Outbound webhook URL** — Optional HTTPS URL; safeT will POST JSON on AI dispatch events (when that pipeline is enabled).
- **License plate / VIN** — Shown as *Coming soon*; reserved for portal lookup features.

Secrets are stored per `agency_id` in Postgres (`agency_integrations`). The API never returns full secret values—only masked hints (e.g. `••••abcd`).

---

## Database tables

- `agency_integrations` — `(agency_id, integration_key)` → value
- `channel_ai_dispatch` — `(agency_id, channel_name)` → `enabled`, `yields_to_units` (for per-channel toggle in a follow-up)

---

## Next implementation steps

1. Per-channel **AI DISPATCH ON/OFF** in the channel panel (uses `channel_ai_dispatch`).
2. `aiDispatch` engine: transcript → LLM → ElevenLabs → inject on channel via voice relay loopback.
3. Portal UI for plate/VIN lookup using the reserved integration keys.
