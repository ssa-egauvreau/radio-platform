import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  api,
  describeError,
  getToken,
  uploadKbDocument,
  type KbDocument,
} from "../../api";

const CATEGORY_LABELS: Record<string, string> = {
  post_order: "Post order",
  route_sheet: "Route sheet",
  policy: "Policy",
  other: "Other",
};

const CATEGORY_OPTIONS = ["post_order", "route_sheet", "policy", "other"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusPill({ doc }: { doc: KbDocument }) {
  if (doc.status === "ready") {
    return <span className="pill on">Ready · {doc.chunk_count} chunks</span>;
  }
  if (doc.status === "failed") {
    return <span className="pill off" title={doc.error ?? undefined}>Failed</span>;
  }
  return <span className="pill">Processing…</span>;
}

/** Admin panel to upload reference documents the AI dispatcher retrieves from (RAG). */
export function KnowledgeBasePanel() {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("post_order");
  const [propertyCode, setPropertyCode] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      const res = await api.listKbDocuments();
      setDocs(res.documents);
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

  // Poll while any document is still being processed so the status pill settles.
  useEffect(() => {
    if (!docs.some((d) => d.status === "processing")) {
      return;
    }
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [docs]);

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadKbDocument(file, {
        title: title.trim() || file.name,
        category,
        propertyCode: propertyCode.trim() || undefined,
      });
      setTitle("");
      setPropertyCode("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(doc: KbDocument) {
    if (!window.confirm(`Delete “${doc.title}” from the knowledge base?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteKbDocument(doc.id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReindex(doc: KbDocument) {
    setBusy(true);
    setError(null);
    try {
      await api.reindexKbDocument(doc.id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(doc: KbDocument) {
    const token = getToken();
    try {
      const res = await fetch(`/v1/admin/kb/documents/${doc.id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        setError(`Could not download “${doc.title}”.`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(`Could not download “${doc.title}”.`);
    }
  }

  return (
    <div>
      <div className="panel-head">
        <h2>Knowledge Base</h2>
        <span className="count">{docs.length} documents</span>
      </div>
      <p className="panel-desc">
        Upload reference PDFs — post orders, route sheets, policies — for the AI dispatcher. Each
        document is indexed into searchable passages, and only the passages relevant to a given
        radio transmission are sent to the AI at dispatch time (rather than stuffing every document
        into the prompt). Tag a document with a property code to favour it when that property is
        mentioned on the air.
      </p>

      {error && <div className="banner error">{error}</div>}

      <div className="kb-upload" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="tx-sub">Title</span>
          <input
            type="text"
            value={title}
            placeholder="e.g. Oakridge Mall post orders"
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="tx-sub">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="tx-sub">Property code (optional)</span>
          <input
            type="text"
            value={propertyCode}
            placeholder="e.g. 1019"
            onChange={(e) => setPropertyCode(e.target.value)}
            disabled={busy}
            style={{ width: 140 }}
          />
        </label>
        <label className="btn" style={busy ? { opacity: 0.5 } : undefined}>
          {busy ? "Working…" : "Upload PDF"}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            disabled={busy}
            onChange={onUpload}
          />
        </label>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="empty">No documents yet. Upload a PDF to get started.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Category</th>
              <th>Property</th>
              <th>Size</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <strong>{doc.title}</strong>
                  {doc.filename && (
                    <div className="tx-sub" style={{ opacity: 0.7 }}>
                      {doc.filename}
                    </div>
                  )}
                </td>
                <td>{CATEGORY_LABELS[doc.category] ?? doc.category}</td>
                <td>{doc.property_code ?? "—"}</td>
                <td>{formatBytes(doc.byte_size)}</td>
                <td>
                  <StatusPill doc={doc} />
                </td>
                <td>
                  <div className="cell-actions">
                    <button className="btn sm" onClick={() => onDownload(doc)} disabled={busy}>
                      Download
                    </button>
                    <button className="btn sm" onClick={() => onReindex(doc)} disabled={busy}>
                      Re-index
                    </button>
                    <button className="btn sm danger" onClick={() => onDelete(doc)} disabled={busy}>
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
