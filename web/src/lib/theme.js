const THEME_KEY = "cf-timetracker:theme";

/** "system" follows the OS; the other two are explicit daisyUI themes. */
export const THEME_OPTIONS = ["system", "light", "dark"];

/** Preference → daisyUI theme name (see the @plugin "daisyui/theme" blocks in index.css). */
const THEME_NAMES = { light: "ledger", dark: "ledger-dark" };

export function storedTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return THEME_OPTIONS.includes(value) ? value : "system";
}

export function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference) {
  return preference === "system" ? systemTheme() : preference;
}

/**
 * daisyUI reads the theme name from `data-theme`; our Tailwind `dark:` utilities read a
 * `.dark` class. Both are written here so components and utilities can never disagree.
 *
 * "system" removes `data-theme` entirely so daisyUI's `--prefersdark` flag follows the OS.
 */
export function applyTheme(preference) {
  const root = document.documentElement;
  const resolved = resolveTheme(preference);

  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", THEME_NAMES[preference] ?? "ledger");
  }
  root.classList.toggle("dark", resolved === "dark");

  localStorage.setItem(THEME_KEY, preference);
}
