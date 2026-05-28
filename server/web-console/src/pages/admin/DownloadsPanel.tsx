import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  describeError,
  type AndroidReleaseRecord,
} from "../../api";
import {
  ReleaseHistoryAccordion,
  type ReleaseHistoryItem,
} from "../../components/ReleaseHistoryAccordion";
import desktopReleasesJson from "../../data/desktopReleases.json";

// Where the Windows installer for the desktop console (safeT Command) is
// published as a GitHub Actions artifact. See .github/workflows/desktop-build.yml
const DESKTOP_DOWNLOADS_URL =
  "https://github.com/ssa-egauvreau/safeT-PTT/actions/workflows/desktop-build.yml";

type DesktopRelease = {
  version: string;
  date: string;
  title: string;
  notes?: string;
  changes: string[];
};

const DESKTOP_RELEASES = desktopReleasesJson as DesktopRelease[];

function formatIsoDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function androidHistoryItems(releases: AndroidReleaseRecord[]): ReleaseHistoryItem[] {
  return releases.map((r, index) => ({
    id: `android-${r.versionCode}`,
    versionLabel: r.versionName,
    buildLabel: `build ${r.versionCode}`,
    dateLabel: formatIsoDate(r.publishedAt.slice(0, 10)),
    notes: r.notes || undefined,
    isCurrent: index === 0,
  }));
}

function desktopHistoryItems(releases: DesktopRelease[]): ReleaseHistoryItem[] {
  return releases.map((r, index) => ({
    id: `desktop-${r.version}-${r.date}`,
    versionLabel: `Version ${r.version}`,
    dateLabel: formatIsoDate(r.date),
    title: r.title,
    notes: r.notes,
    changes: r.changes,
    isCurrent: index === 0,
  }));
}

/** Admin: download links for the Android handset app and the desktop console. */
export function DownloadsPanel() {
  return (
    <div className="android-app-panel">
      <h2>Downloads</h2>
      <p className="muted android-app-lead">
        Installers for the safeT apps. The Android build is published by the server
        and updates handsets automatically; the desktop console is built by CI and
        downloaded from GitHub.
      </p>

      <AndroidDownloadSection />
      <DesktopDownloadSection />
    </div>
  );
}

function AndroidDownloadSection() {
  const [releases, setReleases] = useState<AndroidReleaseRecord[]>([]);
  const [unpublished, setUnpublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const current = releases[0] ?? null;

  async function reload() {
    setLoading(true);
    setError(null);
    setUnpublished(false);
    try {
      const res = await api.getAndroidReleaseHistory();
      setReleases(res.releases);
      if (res.releases.length === 0) {
        setUnpublished(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setReleases([]);
        setUnpublished(true);
      } else {
        setError(describeError(err));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const apkUrl = useMemo(() => {
    if (!current?.url) return "";
    const path = current.url.startsWith("/") ? current.url : `/${current.url}`;
    return `${window.location.origin}${path}`;
  }, [current?.url]);

  async function copyLink() {
    if (!apkUrl) return;
    try {
      await navigator.clipboard.writeText(apkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select the link and copy manually.");
    }
  }

  const historyItems = androidHistoryItems(releases);

  return (
    <section className="downloads-section">
      <h3 className="downloads-section-title">Android handset app</h3>
      <p className="muted android-app-lead">
        Download the latest <strong>safeT</strong> APK for IRC590, TM-7 Plus, and other fleet
        handsets. Radios that already have a release-signed build will also pick this up
        automatically when they open the app.
      </p>

      {loading && <p className="muted">Checking for a published build…</p>}
      {error && <div className="banner error">{error}</div>}

      {!loading && unpublished && (
        <div className="card-like android-app-card">
          <p className="muted">No APK is published on this server yet.</p>
          <p className="muted" style={{ fontSize: "0.9rem" }}>
            After an Android build is published to Railway, refresh this page.
          </p>
          <button type="button" className="btn sm" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      )}

      {!loading && current && (
        <div className="card-like android-app-card">
          <div className="android-app-version">
            <span className="android-app-version-label">Published version</span>
            <strong className="android-app-version-name">{current.versionName}</strong>
            <span className="muted">(build {current.versionCode})</span>
          </div>

          <div className="android-app-download">
            <a className="btn primary android-app-dl-btn" href={apkUrl} download>
              Download APK
            </a>
            <button type="button" className="btn sm" onClick={() => void copyLink()}>
              {copied ? "Copied" : "Copy download link"}
            </button>
          </div>

          <p className="android-app-url muted">
            <span>Link for the radio browser: </span>
            <a href={apkUrl} className="android-app-url-link">
              {apkUrl}
            </a>
          </p>

          <ReleaseHistoryAccordion
            items={historyItems}
            emptyMessage="Release notes will appear here after the next Android publish."
          />

          <details className="android-app-install">
            <summary>Install steps on the handset</summary>
            <ol>
              <li>Open Chrome (or any browser) on the radio.</li>
              <li>Paste the download link above, or tap <strong>Download APK</strong> on a PC and transfer the file.</li>
              <li>When the download finishes, open the file and allow install if Android asks.</li>
              <li>Reboot the radio once after installing.</li>
            </ol>
            <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.75rem" }}>
              First time switching to a release-signed APK: uninstall the old app, then install
              this one. After that, updates install over the air.
            </p>
          </details>

          <button type="button" className="btn sm" style={{ marginTop: "12px" }} onClick={() => void reload()}>
            Refresh version
          </button>
        </div>
      )}
    </section>
  );
}

function DesktopDownloadSection() {
  const current = DESKTOP_RELEASES[0];
  const historyItems = desktopHistoryItems(DESKTOP_RELEASES);

  return (
    <section className="downloads-section">
      <h3 className="downloads-section-title">Desktop console (safeT Command)</h3>
      <p className="muted android-app-lead">
        The desktop console is the same web dispatcher wrapped in a native
        window — useful on dispatch workstations that need it pinned, audio
        permissions persisted, and no browser tab to lose. A Windows installer
        is built automatically by CI and published to GitHub.
      </p>

      <div className="card-like android-app-card">
        {current ? (
          <div className="android-app-version">
            <span className="android-app-version-label">Current release</span>
            <strong className="android-app-version-name">Version {current.version}</strong>
            <span className="muted">{formatIsoDate(current.date)}</span>
          </div>
        ) : null}

        <p className="android-app-notes muted" style={{ fontSize: "0.92rem" }}>
          Click below to open the build page on GitHub, then download the
          installer attached to the most recent successful run. Sign in to
          GitHub first if you&apos;re prompted.
        </p>

        <div className="android-app-download">
          <a
            className="btn primary android-app-dl-btn"
            href={DESKTOP_DOWNLOADS_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open desktop downloads page
          </a>
        </div>

        <ReleaseHistoryAccordion
          items={historyItems}
          emptyMessage="Desktop release notes are listed in productUpdates.json."
        />

        <details className="android-app-install">
          <summary>Where the installer is on the GitHub page</summary>
          <ol>
            <li>Click the topmost workflow run with a green check mark.</li>
            <li>Scroll to the bottom of that run page until you see <strong>Artifacts</strong>.</li>
            <li>Click <strong>safeT-Command-Windows-Installer</strong> to download a zip.</li>
            <li>Unzip it and double-click the <strong>.exe</strong> inside to install.</li>
          </ol>
          <p className="muted" style={{ fontSize: "0.88rem", marginTop: "0.75rem" }}>
            macOS and Linux builds are not yet published by CI — run
            <code> npm run dist:mac </code>or<code> npm run dist:linux </code>
            inside <code>desktop-console/</code> to build them locally.
          </p>
        </details>
      </div>
    </section>
  );
}
