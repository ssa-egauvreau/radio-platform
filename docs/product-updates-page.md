# Product updates page (website)

The public **Updates** page is at `/updates` on the web console (same host as the landing site).

## Edit the list

Add a new entry at the **top** of:

`server/web-console/src/data/productUpdates.json`

For **desktop installer** release notes on Admin → Downloads, also add an entry at the top of:

`server/web-console/src/data/desktopReleases.json`

**Android handset** history on that page is filled automatically when CI publishes an APK (`release-history.json` on the server).

## Public page behaviour

On `/updates`, only the newest version is expanded by default. Visitors click the **arrow** (▶ / ▼) on each card to read that version’s changes.

Each entry:

| Field | Meaning |
|-------|---------|
| `version` | Short version label (e.g. `1.13`) — bump when you ship |
| `date` | ISO date `YYYY-MM-DD` |
| `title` | One-line summary |
| `changes` | Array of simple bullet strings (no jargon) |

After editing, commit and push to `main`; Railway redeploy publishes the page.

## Who sees it

- Anyone can open `/updates` without signing in.
- Footer links on the home page and legal pages point to Updates.
