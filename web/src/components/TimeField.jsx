import { useEffect, useRef, useState } from "react";
import { wallOf } from "../lib/time.js";
import { clockPlaceholder, formatClockText, parseClockText } from "../lib/timeFormat.js";

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"];
const two = (n) => String(n).padStart(2, "0");

/** One scrollable pick column; the selected value is highlighted and scrolled into view when opened. */
function PickColumn({ label, items, render, selected, onPick, register }) {
  return (
    <div className="flex flex-col">
      <span className="ink-muted px-1 pb-1 text-xs font-medium">{label}</span>
      <div ref={(el) => register(label, el)} className="relative h-56 w-16 overflow-y-auto" role="listbox" aria-label={label}>
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <button
              key={String(item)}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`btn btn-sm btn-block justify-center font-normal tabular-nums ${isSelected ? "btn-primary" : "btn-ghost"}`}
              onClick={() => onPick(item)}
            >
              {render(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Clock text field in the chosen notation (24h "14:05" or 12h "2:05 PM"). Typed text is parsed
 * in either notation and normalised on blur or Enter. Clicking or focusing the field opens a
 * custom picker (hour, minute and AM/PM columns) instead of the operating-system time control,
 * which would follow the device setting rather than this app's preference.
 */
export default function TimeField({ id, value, onChange, fmt, zone, invalid = false, ariaLabel, className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const columns = useRef({});
  const parsed = parseClockText(value);
  const basis = parsed ?? { hour: 0, minute: 0 };
  const twelve = fmt === "12h";
  const period = basis.hour < 12 ? "AM" : "PM";
  const selectedHour = parsed ? (twelve ? parsed.hour % 12 || 12 : parsed.hour) : null;
  const selectedPeriod = parsed ? period : null;

  const commit = (hour, minute) => onChange(formatClockText(hour, minute, fmt));
  const pickHour = (h) => commit(twelve ? (h % 12) + (period === "PM" ? 12 : 0) : h, basis.minute);
  const pickMinute = (m) => {
    commit(basis.hour, m);
    if (!twelve) setOpen(false);
  };
  const pickPeriod = (p) => {
    commit((basis.hour % 12) + (p === "PM" ? 12 : 0), basis.minute);
    setOpen(false);
  };
  const pickNow = () => {
    const w = wallOf(Date.now(), zone);
    commit(w.hour, w.minute);
    setOpen(false);
  };

  // Normalise typed text to the chosen notation once the user leaves the field.
  const normalise = () => {
    if (parsed) {
      const text = formatClockText(parsed.hour, parsed.minute, fmt);
      if (text !== value) onChange(text);
    }
  };

  // Keep the selected values visible when the picker opens.
  useEffect(() => {
    if (!open) return;
    for (const el of Object.values(columns.current)) {
      const selected = el?.querySelector('[aria-selected="true"]');
      if (el && selected) el.scrollTop = selected.offsetTop - el.clientHeight / 2 + selected.offsetHeight / 2;
    }
  }, [open]);

  // Close on a click or touch outside the field and its picker.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const register = (label, el) => {
    columns.current[label] = el;
  };

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        // Leaving the component with the keyboard closes the picker; a click on it does not (Safari
        // gives buttons no focus, so relatedTarget is null there and the outside-click handler decides).
        if (event.relatedTarget && !rootRef.current.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          rootRef.current?.querySelector("input")?.focus();
        } else if (event.key === "ArrowDown" && !open) {
          setOpen(true);
        }
      }}
    >
      <input
        id={id}
        type="text"
        className={`input figure w-full ${invalid ? "input-error" : ""}`}
        value={value}
        placeholder={clockPlaceholder(fmt)}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={normalise}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            normalise();
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div
          role="dialog"
          aria-label={`${ariaLabel || "Time"} picker`}
          className="absolute left-0 top-full z-50 mt-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
        >
          <div className="flex gap-2">
            <PickColumn
              label="Hour"
              items={twelve ? HOURS_12 : HOURS_24}
              render={(h) => (twelve ? h : two(h))}
              selected={selectedHour}
              onPick={pickHour}
              register={register}
            />
            <PickColumn
              label="Minute"
              items={MINUTES}
              render={two}
              selected={parsed ? parsed.minute : null}
              onPick={pickMinute}
              register={register}
            />
            {twelve ? (
              <PickColumn
                label="AM/PM"
                items={PERIODS}
                render={(p) => p}
                selected={selectedPeriod}
                onPick={pickPeriod}
                register={register}
              />
            ) : null}
          </div>
          <div className="mt-2 flex justify-end">
            <button type="button" className="btn btn-ghost btn-sm" onClick={pickNow}>Now</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
