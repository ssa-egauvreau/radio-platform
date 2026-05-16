import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { ThemeToggle } from "../../ThemeToggle";
import { AccountsPanel } from "./AccountsPanel";
import { ChannelsPanel } from "./ChannelsPanel";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { UnitAliasesPanel } from "./UnitAliasesPanel";
import { AuditPanel } from "./AuditPanel";

type TabId = "accounts" | "channels" | "assignments" | "aliases" | "audit";

const TABS: { id: TabId; label: string }[] = [
  { id: "accounts", label: "Accounts" },
  { id: "channels", label: "Channels" },
  { id: "assignments", label: "Assignments" },
  { id: "aliases", label: "Unit Aliases" },
  { id: "audit", label: "Audit Log" },
];

export function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<TabId>("accounts");

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          SECURITY RADIO <span>· Admin Portal</span>
        </div>
        <nav className="topnav">
          <Link to="/">Console</Link>
        </nav>
        <div className="who">
          <span className="role-chip">{user?.role}</span>
          <span>{user?.displayName}</span>
          <ThemeToggle />
          <button className="btn sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="admin-body">
        <aside className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </aside>
        <main className="panel">
          {tab === "accounts" && <AccountsPanel />}
          {tab === "channels" && <ChannelsPanel />}
          {tab === "assignments" && <AssignmentsPanel />}
          {tab === "aliases" && <UnitAliasesPanel />}
          {tab === "audit" && <AuditPanel />}
        </main>
      </div>
    </div>
  );
}
