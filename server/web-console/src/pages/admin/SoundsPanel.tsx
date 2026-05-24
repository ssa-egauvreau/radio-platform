import { useEffect, useState, type ChangeEvent } from "react";
import { api, describeError, getToken, uploadSound, type AgencySound } from "../../api";

interface ToneDef {
  kind: string;
  label: string;
  desc: string;
  /** Built-in fallback served as a static asset. */
  bundled: string;
}

const TONES: ToneDef[] = [
  {
    kind: "permit",
    label: "Talk permit",
    desc: "Played when an operator keys up to transmit.",
    bundled: "/sounds/ptt_permit.wav",
  },
  {
    kind: "channel_switch",
    label: "Channel change",
    desc: "Blip played when switching channels.",
    bundled: "/sounds/channel_switch.wav",
  },
  {
    kind: "emergency",
    label: "Emergency alert",
    desc: "Emergency button activation on handsets and alerts.",
    bundled: "/sounds/emergency.wav",
  },
  {
    kind: "marker_1033",
    label: "10-33 channel marker",
    desc: "Looped on the dispatch console while 10-33 marker is active (~12 s).",
    bundled: "/sounds/marker_1033.wav",
  },
  {
    kind: "busy",
    label: "Channel busy",
    desc: "Plays when the channel is already held by another unit.",
    bundled: "/sounds/busy.wav",
  },
  {
    kind: "volume_check",
    label: "Volume check (handset)",
    desc: "IRC590 key 232 — short clip so users can check speaker level.",
    bundled: "/sounds/volume.wav",
  },
];

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/** Admin upload for an agency's own radio tones (replaces the bundled defaults). */
export function SoundsPanel() {
  const [sounds, setSounds] = useState<AgencySound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await api.listSounds();
      setSounds(res.sounds);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const customByKind = new Map(sounds.map((s) => [s.kind, s]));

  async function onUpload(kind: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-uploading the same file
    if (!file) {
      return;
    }
    setBusyKind(kind);
    setError(null);
    try {
      await uploadSound(kind, file);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyKind(null);
    }
  }

  async function onReset(kind: string) {
    if (!window.confirm("Remove the custom tone and use the built-in default?")) {
      return;
    }
    setBusyKind(kind);
    setError(null);
    try {
      await api.deleteSound(kind);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyKind(null);
    }
  }

  async function preview(tone: ToneDef) {
    setPreviewError(null);
    let objectUrl: string | null = null;
    let src = tone.bundled;
    if (customByKind.has(tone.kind)) {
      const token = getToken();
      try {
        const res = await fetch(`/v1/sounds/${tone.kind}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          objectUrl = URL.createObjectURL(await res.blob());
          src = objectUrl;
        }
      } catch {
        /* fall back to bundled default */
      }
    }
    if (!objectUrl) {
      try {
        const head = await fetch(src, { method: "HEAD" });
        if (!head.ok) {
          setPreviewError(
            `Cannot play “${tone.label}”: missing bundled file ${tone.bundled}. Add it under server/web-console/public/sounds/ or upload a custom tone.`,
          );
          return;
        }
      } catch {
        setPreviewError(`Cannot play “${tone.label}”: could not reach ${tone.bundled}.`);
        return;
      }
    }
    const clip = new Audio(src);
    clip.volume = 1;
    const revoke = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    clip.addEventListener("ended", revoke, { once: true });
    clip.addEventListener("error", revoke, { once: true });
    try {
      await clip.play();
    } catch {
      revoke();
      setPreviewError(
        `Cannot play “${tone.label}”. Your browser may block sound until you click elsewhere on the page, or the file may be missing (${tone.bundled}).`,
      );
    }
  }

  return (
    <div>
      <div className="panel-head">
        <h2>Sounds</h2>
        <span className="count">{sounds.length} custom</span>
      </div>
      <p className="panel-desc">
        Upload your agency's own radio tones (WAV, MP3 or OGG — keep clips short, under 1&nbsp;MB). They
        play in the dispatch console and on every handset in this agency. A tone with no upload uses the
        built-in default.
      </p>

      {error && <div className="banner error">{error}</div>}
      {previewError && <div className="banner error">{previewError}</div>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tone</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {TONES.map((tone) => {
              const custom = customByKind.get(tone.kind);
              const busy = busyKind === tone.kind;
              return (
                <tr key={tone.kind}>
                  <td>
                    <strong>{tone.label}</strong>
                    <div className="tx-sub" style={{ opacity: 0.7 }}>
                      {tone.desc}
                    </div>
                  </td>
                  <td>
                    {custom ? (
                      <span className="pill on">
                        Custom · {formatBytes(custom.byte_size)}
                      </span>
                    ) : (
                      <span className="pill off">Default</span>
                    )}
                  </td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn sm" onClick={() => preview(tone)} disabled={busy}>
                        Play
                      </button>
                      <label className="btn sm" style={busy ? { opacity: 0.5 } : undefined}>
                        {busy ? "Working…" : custom ? "Replace" : "Upload"}
                        <input
                          type="file"
                          accept="audio/*"
                          hidden
                          disabled={busy}
                          onChange={(e) => onUpload(tone.kind, e)}
                        />
                      </label>
                      {custom && (
                        <button
                          className="btn sm danger"
                          onClick={() => onReset(tone.kind)}
                          disabled={busy}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
