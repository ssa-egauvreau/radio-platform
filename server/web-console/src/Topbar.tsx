import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { AGENCY_LOGO_CHANGED_EVENT, getToken } from "./api";
import { consoleNavFromPath, consoleNavLabel } from "./consoleNav";
import { ThemeToggle } from "./ThemeToggle";
import { IconRadio, IconShield, IconLogOut, IconWaveform, SafetMark } from "./icons";

/** Shared top menu bar with Mission Control / Bridges / Control / Platform navigation. */
export function Topbar({
  section,
}: {
  section: "console" | "admin" | "owner" | "bridges" | "radio";
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const consoleNav = section === "console" ? consoleNavFromPath(location.pathname) : null;

  const sectionLabel =
    section === "admin"
      ? "Control"
      : section === "owner"
        ? "Platform"
        : section === "bridges"
          ? "Bridges"
          : section === "radio"
            ? "Radio"
            : consoleNav
              ? consoleNavLabel(consoleNav)
              : "Mission Control";
  const isRadioRole = user?.role === "radio";

  function navTabClass(active: boolean): string {
    return active ? "nav-tab active" : "nav-tab";
  }

  const [agencyLogo, setAgencyLogo] = useState<string | null>(null);
  const [logoNonce, setLogoNonce] = useState(0);
  const agencyId = user?.agencyId ?? null;

  useEffect(() => {
    const bump = () => setLogoNonce((n) => n + 1);
    window.addEventListener(AGENCY_LOGO_CHANGED_EVENT, bump);
    return () => window.removeEventListener(AGENCY_LOGO_CHANGED_EVENT, bump);
  }, []);

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
        } else if (!cancelled) {
          setAgencyLogo(null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [agencyId, logoNonce]);

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
            {isRadioRole ? (
              <Link className={navTabClass(section === "radio")} to="/radio">
                <IconRadio size={15} /> Radio
              </Link>
            ) : (
              <>
                <Link
                  className={navTabClass(section === "console" && consoleNav === "mission")}
                  to="/console"
                >
                  <IconRadio size={15} /> Mission Control
                </Link>
                <Link
                  className={navTabClass(section === "console" && consoleNav === "dashboard")}
                  to="/console/dashboard"
                >
                  Dashboard
                </Link>
                <Link
                  className={navTabClass(section === "console" && consoleNav === "ai-activity")}
                  to="/console/ai-activity"
                >
                  AI Log
                </Link>
                <Link className={navTabClass(section === "bridges")} to="/bridges">
                  <IconWaveform size={15} /> Bridges
                </Link>
                <Link className={navTabClass(section === "radio")} to="/radio">
                  <IconRadio size={15} /> Radio
                </Link>
                {user?.role === "admin" && (
                  <Link className={navTabClass(section === "admin")} to="/admin">
                    <IconShield size={15} /> Control
                  </Link>
                )}
              </>
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
