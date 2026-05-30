# 10-8 Systems API specs

OpenAPI specs for the 10-8 Systems integrations used by AI dispatch. Saved here
because the build/runtime environment can't reach SwaggerHub.

| File | What it is | How safeT uses it |
|------|------------|-------------------|
| `incident-export-webhook-1.0.0.json` | Incident Export **webhook** (10-8 → safeT) | `server/src/ten8/webhook.ts` ingests `POST /v1/webhooks/10-8`. Payload is `{action, incident}`; `incident.units[].unit` and `incident.comments[].comment` drive comment matching and call-detail read-back. |
| `cad-api-1.1.0.json` | **CAD API** reads + comments + vehicles (safeT → 10-8) | `ten8ListIncidents`, `ten8AddComment` (`POST /v1/incidents/{lookup}/comments`, body `{officer, comment, type}`), `ten8AddVehicle`. Host: AWS gov gateway (kept; see host note). Rejects special characters — comments are sanitized to `[A-Za-z0-9 ]`. v1.1.0 additionally exposes person/vehicle **search** (`GET /v1/persons`, `GET /v1/vehicles` → full record + `calls[]`) and **UUID** incident lookup — documented here but not yet wired into dispatch. |
| `new-incident-api-1.0.0.json` | **New Incident API** create calls (safeT → 10-8) | `ten8CreateIncident` (`POST interface.10-8systems.com/incidents`, Basic auth). Required: `type` + `summary`. Used for self-dispatch (`intent=dispatch`). |

> **v1.1.0 host note:** 10-8's v1.1.0 spec lists only `https://connect.10-8systems.com` as the
> server (the AWS GovCloud gateway was dropped from the published server list). safeT intentionally
> **keeps its existing base URLs** — CAD reads/comments still default to the GovCloud gateway and
> incident creation still uses `interface.10-8systems.com` (New Incident API, Basic auth). Either can
> be repointed per agency via the base-URL fields (`ten8_api_base_url`, `ten8_new_incident_api_base_url`).
> `cad-api-1.0.8.json` is retained for that GovCloud host reference. v1.1.0 also adds a unified
> `POST /v1/incidents` create endpoint (X-API-Key), but safeT continues to create calls through the
> separate New Incident API.

Source: SwaggerHub `10-8systems-bryan`. Update these files if 10-8 publishes a new version.
