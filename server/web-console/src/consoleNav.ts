/** Console sub-routes — used for top nav highlight and brand section label. */

export type ConsoleNavId = "mission" | "dashboard" | "ai-activity";

export function consoleNavFromPath(pathname: string): ConsoleNavId {
  if (pathname.startsWith("/console/dashboard")) {
    return "dashboard";
  }
  if (pathname.startsWith("/console/ai-activity")) {
    return "ai-activity";
  }
  return "mission";
}

export function consoleNavLabel(id: ConsoleNavId): string {
  switch (id) {
    case "dashboard":
      return "Dashboard";
    case "ai-activity":
      return "AI Log";
    default:
      return "Mission Control";
  }
}
