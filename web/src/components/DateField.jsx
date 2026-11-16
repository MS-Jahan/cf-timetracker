import { useRef } from "react";
import { DATE_FORMATS, dateTextToIso, isoToDateText } from "../lib/dateFormat.js";
import Icon from "./Icon.jsx";

/**
 * Date text field in the chosen date format that is still typeable. A visually hidden native
 * date input sits exactly over the field; showPicker() opens the browser calendar under it when
 * the field is clicked or focused, or when the calendar button is pressed. The native value is
 * converted back to the chosen format before onChange.
 */
export default function DateField({ id, value, onChange, format, invalid = false, ariaLabel, className = "" }) {
  const nativeRef = useRef(null);
  const iso = dateTextToIso(value, format);

  const openPicker = () => {
    try {
      nativeRef.current?.showPicker?.();
    } catch {
      // Browsers refuse programmatic pickers without a user gesture; typing still works.
    }
  };

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        className={`input figure w-full pr-10 ${invalid ? "input-error" : ""}`}
        value={value}
        placeholder={DATE_FORMATS[format].hint}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onClick={openPicker}
        onFocus={openPicker}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm absolute right-1 top-1/2 -translate-y-1/2 px-2"
        aria-label={`Open calendar for ${ariaLabel || "date"}`}
        tabIndex={-1}
        onClick={openPicker}
      >
        <Icon name="calendar" size={16} />
      </button>
      <input
        ref={nativeRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        value={iso ?? ""}
        onChange={(event) => {
          if (event.target.value) onChange(isoToDateText(event.target.value, format));
        }}
      />
    </div>
  );
}
