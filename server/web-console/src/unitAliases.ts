// Shared resolver for friendly radio-unit aliases. The alias map is small and
// rarely changes, so it is fetched once and cached for the whole console.

import { useEffect, useState } from "react";
import { api } from "./api";

type AliasMap = Record<string, string>;

let cached: AliasMap | null = null;
let inflight: Promise<AliasMap> | null = null;

async function load(): Promise<AliasMap> {
  const res = await api.unitAliases();
  const map: AliasMap = {};
  for (const alias of res.aliases) {
    map[alias.unit_id.trim().toLowerCase()] = alias.label;
  }
  cached = map;
  return map;
}

/** Drops the cache so the next resolver mount re-fetches (call after an admin edit). */
export function clearUnitAliasCache(): void {
  cached = null;
  inflight = null;
}

/**
 * Returns a function mapping a raw unit id to its alias, falling back to the
 * raw id when no alias exists. Re-renders the caller once the map loads.
 */
export function useUnitAliasResolver(): (unitId: string | null | undefined) => string {
  const [map, setMap] = useState<AliasMap>(cached ?? {});

  useEffect(() => {
    let active = true;
    if (cached) {
      setMap(cached);
      return;
    }
    inflight ??= load().finally(() => {
      inflight = null;
    });
    inflight
      .then((loaded) => {
        if (active) {
          setMap(loaded);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (unitId) => {
    if (!unitId) {
      return unitId ?? "";
    }
    return map[unitId.trim().toLowerCase()] ?? unitId;
  };
}
