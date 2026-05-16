import { useEffect, useState, type FormEvent } from "react";
import { api, describeError, type UnitAlias } from "../../api";
import { clearUnitAliasCache } from "../../unitAliases";

export function UnitAliasesPanel() {
  const [aliases, setAliases] = useState<UnitAlias[]>([]);
  const [accountUnits, setAccountUnits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unitId, setUnitId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      const res = await api.unitAliases();
      setAliases(res.aliases);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
    clearUnitAliasCache();
  }

  useEffect(() => {
    void reload();
    api
      .listUsers()
      .then((res) => {
        const units = res.users.map((u) => u.unit_id).filter((u): u is string => !!u);
        setAccountUnits([...new Set(units)].sort());
      })
      .catch(() => undefined);
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!unitId.trim() || !label.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setUnitAlias(unitId.trim(), label.trim());
      setUnitId("");
      setLabel("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  function edit(alias: UnitAlias) {
    const next = window.prompt(`Alias for unit "${alias.unit_id}"`, alias.label);
    if (next != null && next.trim() && next.trim() !== alias.label) {
      void api
        .setUnitAlias(alias.unit_id, next.trim())
        .then(reload)
        .catch((err) => setError(describeError(err)));
    }
  }

  async function remove(alias: UnitAlias) {
    if (!window.confirm(`Remove the alias for unit "${alias.unit_id}"?`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteUnitAlias(alias.unit_id);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  const unaliased = accountUnits.filter((u) => !aliases.some((a) => a.unit_id.toLowerCase() === u.toLowerCase()));

  return (
    <div>
      <div className="panel-head">
        <h2>Unit Aliases</h2>
        <span className="count">{aliases.length} total</span>
      </div>
      <p className="panel-desc">
        Friendly labels for radio unit IDs. The console shows the alias in place of the raw unit ID
        in the transmission log, map, channel roster, and alerts.
      </p>

      {error && <div className="banner error">{error}</div>}

      <form className="card" onSubmit={onSave}>
        <h3>Set alias</h3>
        <div className="form-row">
          <div className="field">
            <label>Unit ID</label>
            <input
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              placeholder="e.g. S200-04"
              list="account-units"
              required
            />
            <datalist id="account-units">
              {unaliased.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Alias</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Patrol 4"
              required
            />
          </div>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save alias"}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : aliases.length === 0 ? (
        <div className="empty">No unit aliases yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Unit ID</th>
              <th>Alias</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {aliases.map((alias) => (
              <tr key={alias.unit_id}>
                <td>
                  <code className="mono">{alias.unit_id}</code>
                </td>
                <td>{alias.label}</td>
                <td>
                  <div className="cell-actions">
                    <button className="btn sm" onClick={() => edit(alias)}>
                      Edit
                    </button>
                    <button className="btn sm danger" onClick={() => remove(alias)}>
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
