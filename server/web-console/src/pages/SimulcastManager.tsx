import { useEffect, useState, type FormEvent } from "react";
import { api, describeError, type Simulcast, type UserChannel } from "../api";

/**
 * Create and edit simulcast channels — virtual channels that fan one
 * transmission out to several real channels at once (an agency-wide all-call).
 */
export function SimulcastManager({
  channels,
  onClose,
  onChanged,
}: {
  channels: UserChannel[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [simulcasts, setSimulcasts] = useState<Simulcast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);

  // Real channels only — a simulcast cannot contain another simulcast.
  const channelOptions = channels.filter((c) => !c.simulcast);

  async function reload() {
    try {
      const res = await api.listSimulcasts();
      setSimulcasts(res.simulcasts);
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

  function togglePick(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createSimulcast(name.trim(), [...picked]);
      setName("");
      setPicked(new Set());
      await reload();
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function apply(simulcast: Simulcast, patch: { name?: string; channelIds?: number[] }) {
    setError(null);
    try {
      await api.updateSimulcast(simulcast.id, patch);
      await reload();
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  }

  function toggleMember(simulcast: Simulcast, channelId: number) {
    const ids = new Set(simulcast.member_channel_ids);
    if (ids.has(channelId)) {
      ids.delete(channelId);
    } else {
      ids.add(channelId);
    }
    void apply(simulcast, { channelIds: [...ids] });
  }

  function rename(simulcast: Simulcast) {
    const next = window.prompt("Simulcast channel name", simulcast.name);
    if (next != null && next.trim() && next.trim() !== simulcast.name) {
      void apply(simulcast, { name: next.trim() });
    }
  }

  async function remove(simulcast: Simulcast) {
    if (!window.confirm(`Delete simulcast channel "${simulcast.name}"?`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteSimulcast(simulcast.id);
      await reload();
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>Simulcast channels</h2>
          <button className="cp-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <p className="panel-desc">
          A simulcast channel transmits on several real channels at once — an agency-wide all-call.
          Keying one pre-empts routine traffic on each member channel.
        </p>

        {error && <div className="banner error">{error}</div>}

        <form className="card" onSubmit={onCreate}>
          <h3>New simulcast channel</h3>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Member channels</label>
            <div className="sim-channels">
              {channelOptions.length === 0 ? (
                <span className="muted">No channels available.</span>
              ) : (
                channelOptions.map((c) => (
                  <label key={c.id}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} />
                    {c.name}
                  </label>
                ))
              )}
            </div>
          </div>
          <button
            className="btn primary"
            type="submit"
            disabled={creating || !name.trim() || picked.size === 0}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : simulcasts.length === 0 ? (
          <div className="empty">No simulcast channels yet.</div>
        ) : (
          simulcasts.map((simulcast) => (
            <div className="card" key={simulcast.id}>
              <div className="panel-head">
                <h3>{simulcast.name}</h3>
                <div className="cell-actions">
                  <button className="btn sm" onClick={() => rename(simulcast)}>
                    Rename
                  </button>
                  <button className="btn sm danger" onClick={() => remove(simulcast)}>
                    Delete
                  </button>
                </div>
              </div>
              <div className="sim-channels">
                {channelOptions.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={simulcast.member_channel_ids.includes(c.id)}
                      onChange={() => toggleMember(simulcast, c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
