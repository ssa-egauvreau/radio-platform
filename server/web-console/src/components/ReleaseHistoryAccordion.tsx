import { useId, useState } from "react";

export type ReleaseHistoryItem = {
  id: string;
  versionLabel: string;
  buildLabel?: string;
  dateLabel?: string;
  title?: string;
  notes?: string;
  changes?: string[];
  isCurrent?: boolean;
};

/** Expandable list of releases — newest first; only the current build starts open. */
export function ReleaseHistoryAccordion({
  items,
  emptyMessage = "No release history yet.",
}: {
  items: ReleaseHistoryItem[];
  emptyMessage?: string;
}) {
  const listId = useId();
  const currentId = items.find((i) => i.isCurrent)?.id ?? items[0]?.id ?? "";
  const [openId, setOpenId] = useState<string | null>(currentId || null);

  if (items.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <div className="release-history" role="list" aria-labelledby={listId}>
      <p id={listId} className="release-history-heading muted">
        Release history
      </p>
      <ul className="release-history-list">
        {items.map((item) => {
          const expanded = openId === item.id;
          const dateLabel = item.dateLabel;
          return (
            <li key={item.id} className={expanded ? "release-history-row is-open" : "release-history-row"}>
              <button
                type="button"
                className="release-history-toggle"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : item.id)}
              >
                <span className="release-history-chevron" aria-hidden>
                  {expanded ? "▼" : "▶"}
                </span>
                <span className="release-history-summary">
                  <span className="release-history-version">
                    {item.versionLabel}
                    {item.isCurrent ? <span className="release-history-badge">Current</span> : null}
                  </span>
                  {item.buildLabel ? (
                    <span className="release-history-build muted">{item.buildLabel}</span>
                  ) : null}
                  {dateLabel ? <span className="release-history-date muted">{dateLabel}</span> : null}
                  {item.title && !expanded ? (
                    <span className="release-history-title-preview muted">{item.title}</span>
                  ) : null}
                </span>
              </button>
              {expanded ? (
                <div className="release-history-body">
                  {item.title ? <p className="release-history-title">{item.title}</p> : null}
                  {item.notes ? <p className="release-history-notes">{item.notes}</p> : null}
                  {item.changes && item.changes.length > 0 ? (
                    <ul className="release-history-changes">
                      {item.changes.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!item.notes && (!item.changes || item.changes.length === 0) ? (
                    <p className="muted">No release notes for this build.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
