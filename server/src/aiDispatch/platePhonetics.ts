const STATE_NAMES: Record<string, string> = {
  CA: "California",
  AZ: "Arizona",
  NV: "Nevada",
  OR: "Oregon",
};

export function stateCodeToSpoken(state: string | null | undefined): string {
  const s = (state ?? "CA").toUpperCase();
  return STATE_NAMES[s] ?? s;
}

export function plateToSpokenPhonetic(plate: string | null | undefined): string {
  if (!plate) {
    return "";
  }
  const out: string[] = [];
  for (const c of plate.toUpperCase()) {
    if (/[A-Z]/.test(c)) {
      out.push(c);
    } else if (/[0-9]/.test(c)) {
      out.push(c);
    }
  }
  return out.join(" ");
}

export function vinLast6Spoken(vin: string | null | undefined): string {
  if (!vin || vin.length < 6) {
    return "";
  }
  return plateToSpokenPhonetic(vin.slice(-6));
}

/** Radio unit id for spoken readback (strip 27- prefix for patrol). */
export function callSignForReadback(unitId: string): string {
  const u = unitId.trim().toUpperCase();
  if (/^27-0\d{2}$/.test(u)) {
    return u;
  }
  return u.replace(/^27-/, "");
}
