import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, describeError, getToken, uploadAgencyLogo } from "../../api";
import { useAuth } from "../../auth";

/** Admin panel for agency branding — the agency name and an uploadable logo. */
export function BrandingPanel() {
  const { user } = useAuth();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  function applyLogo(url: string | null) {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    objectUrlRef.current = url;
    setLogoUrl(url);
  }

  async function reload() {
    setLoading(true);
    setError(null);
    const token = getToken();
    try {
      const res = await fetch("/v1/agency/logo", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        applyLogo(URL.createObjectURL(await res.blob()));
        setHasLogo(true);
      } else {
        applyLogo(null);
        setHasLogo(false);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadAgencyLogo(file);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    if (!window.confirm("Remove the agency logo and go back to the default mark?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgencyLogo();
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="panel-head">
        <h2>Branding</h2>
      </div>
      <p className="panel-desc">
        Your agency's name and logo. The logo appears in the console top bar for everyone in this agency.
      </p>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <h3>Agency name</h3>
        <p className="panel-desc" style={{ marginTop: 0 }}>
          <strong>{user?.agencyName ?? "—"}</strong> — set by the platform owner.
        </p>

        <h3>Logo</h3>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="form-row" style={{ alignItems: "center" }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Agency logo"
                style={{ height: 64, width: 64, objectFit: "contain", borderRadius: 8, background: "var(--bg-input)" }}
              />
            ) : (
              <div className="empty" style={{ padding: "16px 20px" }}>
                No logo — using the default safeT mark
              </div>
            )}
            <label className="btn sm" style={busy ? { opacity: 0.5 } : undefined}>
              {busy ? "Working…" : hasLogo ? "Replace logo" : "Upload logo"}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={onUpload} />
            </label>
            {hasLogo && (
              <button className="btn sm danger" onClick={onReset} disabled={busy}>
                Remove
              </button>
            )}
          </div>
        )}
        <p className="panel-desc" style={{ marginTop: 8 }}>
          PNG, JPG or SVG — square works best, up to 512&nbsp;KB.
        </p>
      </div>
    </div>
  );
}
