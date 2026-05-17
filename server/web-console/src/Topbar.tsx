import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth";
import { getToken } from "./api";
import { ThemeToggle } from "./ThemeToggle";
import { IconRadio, IconShield, IconLogOut, SafetMark } from "./icons";

/** Shared top menu bar with Command / Control / Platform navigation. */
export function Topbar({ section }: { section: "console" | "admin" | "owner" }) {
  const { user, logout } = useAuth();
  const sectionLabel = section === "admin" ? "Control" : section === "owner" ? "Platform" : "Command";

  const [agencyLogo, setAgencyLogo] = useState<string | null>(null);
  const agencyId = user?.agencyId ?? null;

  useEffect(() => {
    if (agencyId == null) {
      setAgencyLogo(null);
      return;
    }
    const token = getToken();
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch("/v1/agency/logo", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob && !cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setAgencyLogo(objectUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [agencyId]);

  return (
    <header className="topbar">
      <div className="brand">
        <SafetMark size={26} />
        <span className="brand-word">
          safe<b>T</b>
        </span>
        <span className="brand-section">{sectionLabel}</span>
      </div>
      <nav className="topnav">
        {section !== "owner" && (
          <>
            <Link className={section === "console" ? "nav-tab active" : "nav-tab"} to="/console">
              <IconRadio size={15} /> Command
            </Link>
            {user?.role === "admin" && (
              <Link className={section === "admin" ? "nav-tab active" : "nav-tab"} to="/admin">
                <IconShield size={15} /> Control
              </Link>
            )}
          </>
        )}
      </nav>
      <div className="who">
        {user?.agencyName && (
          <span className="agency-id" title={`Agency — ${user.agencyName}`}>
            {agencyLogo && <img className="agency-logo" src={agencyLogo} alt="" />}
            <span className="agency-name">{user.agencyName}</span>
          </span>
        )}
        <span className="role-chip">{user?.role}</span>
        <span className="who-name">{user?.displayName}</span>
        <ThemeToggle />
        <button className="btn sm icon-btn" onClick={logout}>
          <IconLogOut size={14} /> Sign out
        </button>
      </div>
    </header>
  );
}
