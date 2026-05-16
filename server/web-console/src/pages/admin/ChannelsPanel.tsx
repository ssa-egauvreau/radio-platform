import { useEffect, useState, type FormEvent } from "react";
import { api, describeError, type Channel } from "../../api";

export function ChannelsPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      const res = await api.listChannels();
      setChannels(res.channels);
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

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await api.createChannel(name.trim());
      setName("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function patch(channel: Channel, change: Parameters<typeof api.updateChannel>[1]) {
    setError(null);
    try {
      await api.updateChannel(channel.id, change);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  function rename(channel: Channel) {
    const next = window.prompt("Channel name", channel.name);
    if (next != null && next.trim() && next.trim() !== channel.name) {
      void patch(channel, { name: next.trim() });
    }
  }

  async function remove(channel: Channel) {
    if (!window.confirm(`Delete channel "${channel.name}"? Assignments to it are removed too.`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteChannel(channel.id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      <div className="panel-head">
        <h2>Channels</h2>
        <span className="count">{channels.length} total</span>
      </div>
      <p className="panel-desc">
        Channels radios and the console can tune. A color and zone are shown on the console; handsets
        read the channel list from <code className="mono">/v1/channels</code>.
      </p>

      {error && <div className="banner error">{error}</div>}

      <form className="card" onSubmit={onCreate}>
        <h3>Add channel</h3>
        <div className="form-row">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Green 4" required />
          </div>
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? "Adding…" : "Add channel"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : channels.length === 0 ? (
        <div className="empty">No channels yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Color</th>
              <th>Zone</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id}>
                <td>
                  <code className="mono">{channel.id}</code>
                </td>
                <td>{channel.name}</td>
                <td>
                  <div className="cell-actions" style={{ justifyContent: "flex-start" }}>
                    <input
                      type="color"
                      className="color-input"
                      value={channel.color ?? "#888888"}
                      onChange={(e) => patch(channel, { color: e.target.value })}
                    />
                    {channel.color && (
                      <button className="btn sm" onClick={() => patch(channel, { color: null })}>
                        Clear
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <input
                    key={`zone-${channel.id}-${channel.zone ?? ""}`}
                    defaultValue={channel.zone ?? ""}
                    placeholder="—"
                    onBlur={(e) => {
                      const zone = e.target.value.trim();
                      if (zone !== (channel.zone ?? "")) {
                        void patch(channel, { zone: zone || null });
                      }
                    }}
                  />
                </td>
                <td>
                  <div className="cell-actions">
                    <button className="btn sm" onClick={() => rename(channel)}>
                      Rename
                    </button>
                    <button className="btn sm danger" onClick={() => remove(channel)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
