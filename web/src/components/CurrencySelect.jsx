import { CURRENCIES, currencyLabel } from "../lib/currencies.js";

/**
 * Currency picker used in Settings (client rows and the new-client form).
 * Known currencies come from a dropdown showing name and symbol; the last option
 * switches to a free 3-letter code input for anything outside the catalog.
 */
export default function CurrencySelect({ id, value, onChange, disabled = false, size = "select-sm" }) {
  const known = CURRENCIES.some((c) => c.code === value);
  const custom = value !== "" && !known;

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        id={id}
        className={`select ${size} w-44`}
        disabled={disabled}
        value={custom ? "__custom" : value || ""}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "__custom" ? "" : next);
        }}
        aria-label="Currency"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} - {c.name} ({c.symbol})
          </option>
        ))}
        <option value="__custom">Custom code…</option>
      </select>

      {custom ? (
        <span className="flex items-center gap-2">
          <input
            className={`input ${size} w-20 font-mono`}
            maxLength={3}
            placeholder="e.g. XRD"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            aria-label="Custom currency code"
          />
          <span className="text-xs ink-muted">3-letter ISO code</span>
        </span>
      ) : null}
      {known ? <span className="sr-only">{currencyLabel(value)}</span> : null}
    </span>
  );
}
