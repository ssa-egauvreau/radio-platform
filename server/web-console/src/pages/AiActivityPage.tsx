import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../api";
import { Topbar } from "../Topbar";

export function AiActivityPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAiDispatchActivity>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getAiDispatchActivity(80);
      setData(res);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [reload]);

  return (
    <div className="app-shell">
      <Topbar section="console" />
      <main className="ai-activity-page" style={{ padding: "1rem 1.25rem", maxWidth: "56rem" }}>
        <h1 style={{ margin: "0 0 0.35rem" }}>AI dispatch activity</h1>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Live log of radio transcripts the AI dispatcher processed. Refreshes every 5 seconds.
        </p>
        {error && <p className="error">{error}</p>}
        {loading && !data && <p className="muted">Loading…</p>}

        {data && data.ten8_active_incidents.length > 0 && (
          <section style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ fontSize: "1rem" }}>10-8 active incidents</h2>
            <ul className="muted">
              {data.ten8_active_incidents.map((inc) => (
                <li key={inc.call_id}>
                  <strong>{inc.call_id}</strong> — {inc.incident_type ?? "Unknown"} @ {inc.location ?? "—"}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data?.entries.map((entry) => (
          <article
            key={entry.id}
            style={{
              border: "1px solid var(--border, #333)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              marginBottom: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>
                {entry.unit_id ?? "—"} · {entry.channel_name ?? "—"}
              </strong>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
            <p style={{ margin: "0.5rem 0", fontStyle: "italic" }}>&ldquo;{entry.transcript}&rdquo;</p>
            {entry.intent && (
              <p style={{ margin: "0.25rem 0" }}>
                <span className="muted">Intent:</span> {entry.intent}
                {entry.trigger_emergency_tone && (
                  <span style={{ color: "var(--warn, #ffb84d)", marginLeft: 8 }}>10-33</span>
                )}
              </p>
            )}
            {entry.summary && (
              <p style={{ margin: "0.25rem 0" }}>
                <span className="muted">Summary:</span> {entry.summary}
              </p>
            )}
            {entry.dispatcher_response && (
              <p style={{ margin: "0.25rem 0" }}>
                <span className="muted">On air:</span> {entry.dispatcher_response}
              </p>
            )}
            {entry.plate_lookup && (
              <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
                <span className="muted">Plate lookup:</span>{" "}
                {entry.plate_lookup.ok
                  ? `${entry.plate_lookup.year ?? ""} ${entry.plate_lookup.make ?? ""} ${entry.plate_lookup.model ?? ""}`.trim()
                  : entry.plate_lookup.reason ?? "failed"}
              </p>
            )}
            {entry.error && <p className="error" style={{ margin: "0.25rem 0" }}>{entry.error}</p>}
          </article>
        ))}

        {data && data.entries.length === 0 && !loading && (
          <p className="muted">No AI dispatch events yet. Enable AI dispatch on a channel and transmit.</p>
        )}
      </main>
    </div>
  );
}
