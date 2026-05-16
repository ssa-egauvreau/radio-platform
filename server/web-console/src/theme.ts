// Day / night theme for the console, persisted across sessions.

export type Theme = "day" | "night";

const STORAGE_KEY = "securityradio.theme";

export function getTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "day" ? "day" : "night";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
