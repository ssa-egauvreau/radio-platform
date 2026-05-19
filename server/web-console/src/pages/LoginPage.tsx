import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { describeError } from "../api";
import { SafetMark } from "../icons";

export function LoginPage() {
  const { login } = useAuth();
  const [agencySlug, setAgencySlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, agencySlug.trim() || undefined);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <SafetMark size={46} />
          <div>
            <h1>
              safe<b>T</b> PTT
            </h1>
            <div className="sub">Dispatch Console</div>
          </div>
        </div>
        {error && <div className="banner error">{error}</div>}
        <label htmlFor="agency-slug">Agency / network (optional)</label>
        <input
          id="agency-slug"
          autoComplete="organization"
          placeholder="e.g. default or sunset-safety-agency"
          value={agencySlug}
          onChange={(e) => setAgencySlug(e.target.value)}
        />
        <p className="login-hint">
          If your company gave you a network code, enter it here. Leave blank if you only have one agency or
          you use a platform owner account.
        </p>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
