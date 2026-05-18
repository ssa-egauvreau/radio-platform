# safeT PTT

Talk · Transmit · Together

## Goal
Build **safeT PTT** — a private enterprise push-to-talk platform for public safety. Android comes first; iOS and Windows come later. The Android UI should mimic the feel of a Motorola APX radio without copying branded assets.

## Surfaces
- **safeT Mobile** — the Android radio handset app (`android-app/`).
- **safeT Command** — the web dispatch console (`server/web-console/`) and its desktop shell (`desktop-console/`).
- **safeT Control** — the per-agency admin panel (within the web console).
- **safeT Platform** — the owner portal for provisioning agencies/tenants (within the web console).
- Brand assets live in `brand/`.

## Multi-agency (tenancy)
The backend is multi-tenant: every account, channel, recording, alert and radio
handset belongs to an **agency**. A platform `owner` account provisions agencies
from the Platform portal; each agency's `admin` then manages it from Control.
Pre-existing single-tenant data is migrated into a "Default Agency" on first
boot. Handsets bind to an agency with a per-agency radio key (the legacy global
`RADIO_API_KEY` still maps to the Default Agency).

## Tech stack
- Android: Kotlin + Jetpack Compose
- State: ViewModel + StateFlow
- Backend: Node.js or TypeScript
- Database: PostgreSQL on Railway
- Repo: GitHub monorepo
- Distribution: private APKs

Step-by-step Railway + Android configuration: `docs/railway-android-setup.md`.

**Production API / web console:** `https://safet.up.railway.app/`

## Architecture rules
- Keep UI, ViewModel, domain logic, data access, and device integration separate.
- Use a state-driven Compose architecture.
- Hoist state out of composables and keep composables as stateless as possible.
- Use immutable UI state and explicit UI events.
- Put hardware key mapping in a device layer.
- Put transmit/audio lifecycle in a foreground service or dedicated platform layer.
- Keep the backend platform-neutral for future iOS and Windows clients.

## Android UI rules
- Build an APX-style radio shell.
- Include top status strip, center display, soft-key row, PTT button, emergency button, and channel controls.
- Use dark radio hardware styling with high contrast text.
- Make the layout adaptive.
- Prefer reusable Compose components.

## Naming rules
- `RadioUiState`
- `RadioUiEvent`
- `RadioViewModel`
- `RadioScreen`
- `RadioShell`

## Working style
- When generating code, give complete copy-paste-ready files.
- When generating instructions, give click-by-click steps.
- If a feature is not yet implemented, create a minimal mock version first.
- Do not copy Motorola branding or assets exactly.
