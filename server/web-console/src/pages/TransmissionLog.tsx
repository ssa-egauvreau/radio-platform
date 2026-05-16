import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, fetchTransmissionAudio, type Transmission, type UserChannel } from "../api";
import { useUnitAliasResolver } from "../unitAliases";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds}s`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], { dateStyle: "short", timeStyle: "medium" });
}

function transcriptOf(tx: Transmission): { text: string; muted: boolean } {
  switch (tx.transcript_status) {
    case "done":
      return tx.transcript && tx.transcript.length > 0
        ? { text: tx.transcript, muted: false }
        : { text: "(no speech detected)", muted: true };
    case "pending":
      return { text: "Transcribing…", muted: true };
    case "failed":
      return { text: "Transcript unavailable", muted: true };
    case "disabled":
      return { text: "Transcription disabled", muted: true };
    default:
      return { text: tx.transcript ?? "—", muted: true };
  }
}

const SORTS: { value: string; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest first" },
  { value: "shortest", label: "Shortest first" },
  { value: "speaker", label: "Speaker A–Z" },
];

// "All" maps to the server's hard cap on a single response.
const VIEW_CAPS: { value: number; label: string }[] = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 500, label: "All" },
];

export function TransmissionLog() {
  const [items, setItems] = useState<Transmission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [user, setUser] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("newest");
  const [cap, setCap] = useState(25);
  const [channels, setChannels] = useState<UserChannel[]>([]);
  const aliasFor = useUnitAliasResolver();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlCache = useRef<Map<number, string>>(new Map());

  // Latest filters reachable from the polling timer without re-arming it.
  const filtersRef = useRef({ search, channelFilter, user, fromDate, toDate, sort, cap });
  filtersRef.current = { search, channelFilter, user, fromDate, toDate, sort, cap };

  const refresh = useCallback(async () => {
    try {
      const f = filtersRef.current;
      const res = await api.transmissions({
        search: f.search,
        channel: f.channelFilter,
        user: f.user,
        from: f.fromDate,
        to: f.toDate,
        sort: f.sort,
        limit: f.cap,
      });
      setItems(res.transmissions);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api
      .myChannels()
      .then((res) => setChannels(res.channels))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const cache = urlCache.current;
    return () => {
      window.clearInterval(timer);
      audioRef.current?.pause();
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, [refresh]);

  // Re-query (debounced) whenever any filter, sort, or the view cap changes.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(timer);
  }, [search, channelFilter, user, fromDate, toDate, sort, cap, refresh]);

  const objectUrlFor = useCallback(async (id: number): Promise<string> => {
    const cached = urlCache.current.get(id);
    if (cached) {
      return cached;
    }
    const blob = await fetchTransmissionAudio(id);
    const url = URL.createObjectURL(blob);
    urlCache.current.set(id, url);
    return url;
  }, []);

  async function play(id: number) {
    if (playingId === id && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }
    setBusyId(id);
    try {
      const url = await objectUrlFor(id);
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.onended = () => setPlayingId(null);
        audioRef.current = audio;
      }
      audio.src = url;
      await audio.play();
      setPlayingId(id);
    } catch {
      setError("Could not play that recording.");
    } finally {
      setBusyId(null);
    }
  }

  async function download(id: number) {
    setBusyId(id);
    try {
      const url = await objectUrlFor(id);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transmission-${id}.wav`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setError("Could not download that recording.");
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() {
    setSearch("");
    setChannelFilter("");
    setUser("");
    setFromDate("");
    setToDate("");
    setSort("newest");
  }

  const filtered =
    search.trim() !== "" ||
    channelFilter !== "" ||
    user.trim() !== "" ||
    fromDate !== "" ||
    toDate !== "" ||
    sort !== "newest";

  return (
    <div className="tx-log">
      <div className="tx-log-head">
        <h3>Transmission Log</h3>
        <span className="count">{items.length} shown</span>
      </div>

      <div className="tx-filters">
        <div className="tx-filter-row">
          <input
            className="tx-search"
            type="search"
            placeholder="Search transcripts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
            <option value="">All channels</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.name}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <div className="tx-filter-row">
          <input
            className="tx-search"
            type="text"
            placeholder="User or unit…"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="tx-filter-row tx-date-row">
          <label>
            From
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {filtered && (
            <button className="btn sm" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="tx-list">
        {loading && <div className="empty">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty">
            {filtered ? "No transmissions match those filters." : "No recorded transmissions yet."}
          </div>
        )}
        {items.map((tx) => {
          const transcript = transcriptOf(tx);
          const speaker = tx.display_name || aliasFor(tx.unit_id) || "Unknown";
          return (
            <div className="tx-card" key={tx.id}>
              <div className="tx-card-head">
                <span className="tx-speaker">{speaker}</span>
                <span className="tx-channel">{tx.channel_name}</span>
              </div>
              <div className="tx-card-sub">
                {formatTime(tx.started_at)} · {formatDuration(tx.duration_ms)}
                {tx.display_name && tx.unit_id ? ` · ${aliasFor(tx.unit_id)}` : ""}
              </div>
              <div className={transcript.muted ? "tx-transcript muted" : "tx-transcript"}>
                {transcript.text}
              </div>
              <div className="tx-card-actions">
                <button className="btn sm" disabled={busyId === tx.id} onClick={() => play(tx.id)}>
                  {playingId === tx.id ? "Pause" : busyId === tx.id ? "…" : "Play"}
                </button>
                <button className="btn sm" disabled={busyId === tx.id} onClick={() => download(tx.id)}>
                  Download
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="tx-viewcap">
        <span>View</span>
        {VIEW_CAPS.map((option) => (
          <button
            key={option.value}
            className={cap === option.value ? "viewcap-btn active" : "viewcap-btn"}
            onClick={() => setCap(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
