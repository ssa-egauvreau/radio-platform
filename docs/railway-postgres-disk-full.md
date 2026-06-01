# Railway: PostgreSQL disk full (service keeps crashing)

If Railway logs show lines like:

- `No space left on device`
- `could not extend file "base/16384/..."`
- Postgres error code `53100`

then your **Postgres database volume is full**. The API cannot save new rows (GPS positions, voice telemetry, recordings, 10-8 webhook logs). This is **not caused by Android app updates** (for example PR #232).

The server should stay running after recent fixes, but **radio features that need the database will fail** until you free space or enlarge the disk.

---

## What to do (step by step on Railway)

### 1. Open Railway

1. In your web browser, go to [https://railway.app](https://railway.app) and sign in.
2. Open your **project** (the one that hosts safeT / PTT).
3. You should see **two** services in the diagram: your **API / Node app** and **PostgreSQL**.

### 2. Check Postgres storage

1. Click the **PostgreSQL** box (not the API box).
2. Open the **Metrics** or **Usage** tab (wording varies by Railway version).
3. Look for **disk** or **volume** usage near **100%**.

**What you should see:** Disk usage at or near the plan limit.

### 3. Free space quickly (upgrade or delete old data)

**Option A — Upgrade disk (fastest, keeps all data)**

1. Still on the PostgreSQL service, open **Settings**.
2. Find **Volume** / **Storage** / **Resize**.
3. Increase the disk size, save, and wait for Railway to apply the change.
4. Redeploy or restart the **API** service if it was crash-looping.

**Option B — Delete old recordings (largest tables)**

Recorded voice (`transmissions` table with `audio` bytes) is usually what fills the disk.

1. On the PostgreSQL service, open **Data** → **Query** (or connect with any SQL client using the connection string from **Variables** → `DATABASE_URL`).
2. Paste and run **one** of these (oldest first):

```sql
-- See how big the table is (row count only)
SELECT COUNT(*) FROM transmissions;

-- Delete transmissions older than 90 days (adjust the interval if you need more history)
DELETE FROM transmissions WHERE started_at < now() - interval '90 days';
```

3. Run this to reclaim space inside Postgres:

```sql
VACUUM ANALYZE transmissions;
```

**Warning:** `DELETE` permanently removes those recordings and transcripts from the database. Only run this if you accept losing that history.

Other tables you can trim if needed:

```sql
DELETE FROM ten8_webhook_log WHERE received_at < now() - interval '30 days';
DELETE FROM voice_link_telemetry WHERE server_ts < now() - interval '7 days';
DELETE FROM ai_dispatch_log WHERE created_at < now() - interval '90 days';
VACUUM ANALYZE;
```

### 4. Prevent it from filling again

On the **API** service (Node), add a Railway **Variable**:

| Name | Value | Meaning |
|------|--------|---------|
| `TRANSMISSION_RETENTION_DAYS` | `90` | Automatically delete transmissions older than 90 days (server sweeps every ~10 minutes) |

The server already sweeps:

- Voice link telemetry — 7 days  
- 10-8 webhook debug log — 30 days  
- AI dispatch activity log — 90 days  

Redeploy the API after changing variables.

### 5. Confirm recovery

1. Open `https://safet-ptt.com/health` (or your Railway URL + `/health`).
2. You should see `"database": true` and `"status": "ok"` or `"degraded"` (not a blank page).
3. In Railway → API service → **Deployments** → **View logs**, you should **not** see repeating `No space left on device` lines.

---

## Still stuck?

- Make sure `DATABASE_URL` on the API service is **linked** to the Postgres service (not an old copied URL).
- If logs show `FATAL: JWT_SECRET env is not set`, set `JWT_SECRET` on the API service — that is a different problem (see `docs/troubleshooting-transcription-and-ai.md`).
