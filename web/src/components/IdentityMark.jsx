import { useState } from "react";

/** First letters of the first two words, uppercased — "" for an empty name. */
export function initialsOf(name) {
  return String(name).trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * Small identity mark: remote image when supplied, otherwise emoji or initials.
 * Images are decorative because the adjacent label remains the accessible name.
 */
export default function IdentityMark({ name = "", imageUrl, emoji, size = "sm" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = initialsOf(name) || "?";
  const box = size === "lg" ? "size-12 text-lg" : "size-8 text-xs";
  const fallback = emoji || initials;
  return (
    <span className={`inline-flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full bg-base-200 font-semibold text-base-content`} aria-hidden="true">
      {imageUrl && !imageFailed ? <img src={imageUrl} alt="" className="size-full object-cover" onError={() => setImageFailed(true)} /> : fallback}
    </span>
  );
}
