import { useEffect, useState, type FormEvent } from "react";
import { api, describeError, DEVICE_TYPE_OPTIONS, type AdminUser, type Role } from "../../api";

const ROLES: Role[] = ["admin", "dispatcher", "radio"];

/** Per-agency account management, embedded in the owner portal's agency list. */
export function AgencyUsersPanel({ agencyId, agencyName }: { agencyId: number; agencyName: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("radio");
  const [unitId, setUnitId] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      const res = await api.agencyUsers(agencyId);
      setUsers(res.users);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createAgencyUser(agencyId, {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        password,
        role,
        unitId: unitId.trim() ? unitId.trim().toUpperCase() : null,
        deviceType: deviceType || null,
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("radio");
      setUnitId("");
      setDeviceType("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  }

  async function patch(user: AdminUser, change: Parameters<typeof api.updateAgencyUser>[2]) {
    setError(null);
    try {
      await api.updateAgencyUser(agencyId, user.id, change);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function remove(user: AdminUser) {
    if (!window.confirm(`Delete account "${user.username}"? This cannot be undone.`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteAgencyUser(agencyId, user.id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  function resetPassword(user: AdminUser) {
    const next = window.prompt(`New password for "${user.username}"`);
    if (next != null && next.length > 0) {
      void patch(user, { password: next });
    }
  }

  return (
    <div className="card">
      <h3>{agencyName} — accounts</h3>
      {error && <div className="banner error">{error}</div>}

      <form className="form-row" onSubmit={onCreate}>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Unit ID</label>
          <input value={unitId} onChange={(e) => setUnitId(e.target.value)} placeholder="optional" />
        </div>
        <div className="field">
          <label>Device</label>
          <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
            {DEVICE_TYPE_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={creating}>
          {creating ? "Creating…" : "Add account"}
        </button>
      </form>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : users.length === 0 ? (
        <div className="empty">No accounts in this agency.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Role</th>
              <th>Unit ID</th>
              <th>Device</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <code className="mono">{user.username}</code>
                </td>
                <td>{user.display_name}</td>
                <td>
                  <select value={user.role} onChange={(e) => patch(user, { role: e.target.value as Role })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {user.unit_id ?? (
                    <span className="empty" style={{ padding: 0 }}>
                      —
                    </span>
                  )}
                </td>
                <td>
                  <select
                    value={user.device_type ?? ""}
                    onChange={(e) => patch(user, { deviceType: e.target.value || null })}
                  >
                    {DEVICE_TYPE_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={user.disabled ? "pill off" : "pill on"}>
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td>
                  <div className="cell-actions">
                    <button className="btn sm" onClick={() => resetPassword(user)}>
                      Password
                    </button>
                    <button className="btn sm" onClick={() => patch(user, { disabled: !user.disabled })}>
                      {user.disabled ? "Enable" : "Disable"}
                    </button>
                    <button className="btn sm danger" onClick={() => remove(user)}>
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
