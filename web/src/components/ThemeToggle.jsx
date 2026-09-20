import { applyTheme, resolveTheme, THEME_OPTIONS } from "../lib/theme.js";
import Icon from "./Icon.jsx";

const LABELS = {
  system: { text: "Auto", title: "Following the system theme" },
  light: { text: "Light", title: "Light mode" },
  dark: { text: "Dark", title: "Dark mode" },
};

function themeIcon(preference) {
  if (preference === "light") return "sun";
  if (preference === "dark") return "moon";
  return "system";
}

/** Cycles Auto → Light → Dark. Quiet by design: the theme control shouldn't compete with the clock. */
export default function ThemeToggle({ preference, onChange, effective: effectiveProp }) {
  const next = THEME_OPTIONS[(THEME_OPTIONS.indexOf(preference) + 1) % THEME_OPTIONS.length];
  const label = LABELS[preference] || LABELS.system;
  const effective = effectiveProp || resolveTheme(preference);

  return (
    <button
      className="btn btn-ghost btn-sm ink-muted"
      onClick={() => {
        applyTheme(next);
        onChange(next);
      }}
      title={`${label.title}. Switch to ${LABELS[next].text.toLowerCase()} theme.`}
      aria-label={`Theme: ${label.text} (${effective})`}
    >
      <Icon name={themeIcon(preference)} size={16} />
      {label.text} theme
    </button>
  );
}
