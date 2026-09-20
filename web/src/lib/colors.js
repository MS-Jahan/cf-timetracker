// Stable per-entity accents, expressed in daisyUI theme tokens so they follow the
// active theme instead of hard-coding a palette.
// Literal class strings only - Tailwind scans this file for candidates.
const PALETTE = [
  { status: "status-primary", text: "text-primary", badge: "badge badge-soft badge-primary", bar: "bg-primary" },
  { status: "status-secondary", text: "text-secondary", badge: "badge badge-soft badge-secondary", bar: "bg-secondary" },
  { status: "status-accent", text: "text-accent", badge: "badge badge-soft badge-accent", bar: "bg-accent" },
  { status: "status-info", text: "text-info", badge: "badge badge-soft badge-info", bar: "bg-info" },
  { status: "status-success", text: "text-success", badge: "badge badge-soft badge-success", bar: "bg-success" },
  { status: "status-warning", text: "text-warning", badge: "badge badge-soft badge-warning", bar: "bg-warning" },
];

function hash(value = "") {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 9973;
  }
  return h;
}

export function colorFor(id) {
  return PALETTE[hash(String(id ?? "")) % PALETTE.length];
}
