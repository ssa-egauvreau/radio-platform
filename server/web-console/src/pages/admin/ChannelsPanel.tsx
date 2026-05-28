import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  describeError,
  VOICE_CODECS,
  VOICE_CODEC_LABEL,
  type Channel,
  type VoiceCodec,
} from "../../api";

export function ChannelsPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [defaultCodec, setDefaultCodec] = useState<VoiceCodec | null>(null);

  async function reload() {
    try {
      const [chRes, agRes] = await Promise.all([
        api.listChannels(),
        api.getAdminAgency().catch(() => null),
      ]);
      setChannels(chRes.channels);
      if (agRes) {
        setDefaultCodec(agRes.agency.defaultCodec);
      }
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

  async function changeDefaultCodec(next: VoiceCodec) {
    if (next === defaultCodec) return;
    setError(null);
    const prior = defaultCodec;
    setDefaultCodec(next); // optimistic — falls back to prior on error
    try {
      await api.setAgencyDefaultCodec(next);
    } catch (err) {
      setDefaultCodec(prior);
      setError(describeError(err));
    }
  }

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
          <div className="field">
            <label>Default codec for new channels</label>
            <select
              value={defaultCodec ?? "imbe"}
              disabled={defaultCodec === null}
              onChange={(e) => void changeDefaultCodec(e.target.value as VoiceCodec)}
              title="Applied to channels created from this page. Existing channels keep their per-channel codec — change those individually in the table below."
            >
              {VOICE_CODECS.map((c) => (
                <option key={c} value={c}>
                  {VOICE_CODEC_LABEL[c]}
                </option>
              ))}
            </select>
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
              <th>Codec</th>
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
                  <select
                    value={channel.codec}
                    onChange={(e) => {
                      const next = e.target.value as VoiceCodec;
                      if (next !== channel.codec) {
                        void patch(channel, { codec: next });
                      }
                    }}
                    title="Voice codec used to transmit on this channel. Connected clients receive a codec_change push immediately."
                  >
                    {VOICE_CODECS.map((c) => (
                      <option key={c} value={c}>
                        {VOICE_CODEC_LABEL[c]}
                      </option>
                    ))}
                  </select>
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
