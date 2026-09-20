import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";

/* Curated common emojis with keywords for search. Names double as alt text. */
const EMOJIS = [
  ["💼", "briefcase work"], ["🧑‍💻", "developer coding programmer"], ["💻", "laptop computer code"],
  ["🖥️", "desktop computer"], ["📱", "phone mobile"], ["📞", "phone call meeting"],
  ["✉️", "email message"], ["📝", "note writing notes"], ["📊", "chart report analytics"],
  ["📈", "chart growth graph"], ["📉", "chart decline"], ["🗂️", "files folder organize"],
  ["📁", "folder"], ["📅", "calendar date schedule"], ["⏰", "clock alarm time"],
  ["⏱️", "stopwatch timer"], ["🕐", "clock time hour"], ["🎯", "target goal"],
  ["🚀", "rocket launch ship"], ["🐛", "bug error insect"], ["🔧", "wrench fix tool"],
  ["🔨", "hammer build"], ["⚙️", "gear settings config"], ["🧪", "test experiment lab"],
  ["🔬", "research microscope"], ["📐", "design measure ruler"], ["✂️", "cut edit scissors"],
  ["🎨", "design art paint"], ["🖌️", "paint brush design"], ["🖼️", "image picture frame"],
  ["📸", "photo camera"], ["🎬", "video film"], ["🎤", "microvoice voice mic"],
  ["🎧", "headphones audio"], ["📚", "books docs documentation"], ["📖", "book reading"],
  ["🧾", "invoice receipt billing"], ["💰", "money bag billing"], ["💳", "payment card"],
  ["🔒", "lock security"], ["🔑", "key access"], ["🛡️", "shield security protection"],
  ["🌐", "web globe internet"], ["🔗", "link url"], ["📡", "antenna network broadcast"],
  ["🔌", "plug integration"], ["🧵", "thread queue"], ["📦", "package deploy release"],
  ["🚚", "shipping delivery"], ["✅", "done check complete"], ["☑️", "checked task"],
  ["✔️", "check mark"], ["❌", "wrong cancel"], ["⚠️", "warning caution"],
  ["🔥", "hot urgent fire"], ["⭐", "star favorite"], ["✨", "sparkles new polish"],
  ["💡", "idea lightbulb"], ["🤔", "thinking question"], ["👀", "review watch"],
  ["🙏", "thanks please"], ["👍", "thumbs up good"], ["👋", "wave hello"],
  ["🤝", "handshake deal meeting"], ["🧑‍🤝‍🧑", "team people"], ["👤", "user person"],
  ["💬", "comment chat discussion"], ["🗣️", "speaking discussion"], ["📢", "announce marketing"],
  ["🧹", "cleanup chore"], ["♻️", "refactor recycle"], ["🔄", "sync update loop"],
  ["🔁", "repeat"], ["🔀", "branch merge"], ["🧩", "integration puzzle part"],
  ["🛠️", "tools maintenance"], ["⛏️", "mining dig"], ["🧱", "blocks brick build"],
  ["🏗️", "construction build"], ["🗺️", "roadmap map plan"], ["🧭", "compass direction"],
  ["📌", "pin important"], ["📎", "attach clip"], ["🏷️", "tag label"],
  ["🔖", "bookmark"], ["🔍", "search find"], ["🕵️", "investigate debug"],
  ["🧑‍🏫", "training teaching"], ["🎓", "learning education"], ["☕", "coffee break"],
  ["🍽️", "lunch food"], ["🌿", "nature green"], ["🏖️", "vacation beach"],
  ["🎉", "celebrate launch party"], ["🏆", "award win done"], ["🥇", "gold first"],
  ["⚡", "fast performance quick"], ["🌊", "flow"], ["🧊", "freeze"],
  ["☁️", "cloud"], ["🌩️", "incident storm"], ["🌅", "morning start"],
  ["🌙", "night late"], ["🌍", "world i18n"], ["🚦", "status traffic"],
  ["🚧", "wip maintenance construction"], ["🛑", "stop blocked"], ["➡️", "next forward"],
];

export default function EmojiPicker({ value, onChange, label = "Emoji" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJIS;
    return EMOJIS.filter(([, keywords]) => keywords.includes(q));
  }, [query]);

  return (
    <span className="relative inline-flex items-center" ref={rootRef}>
      <button
        type="button"
        className="btn btn-sm min-w-11 px-2 ring-1 ring-inset ring-base-300"
        aria-label={value ? `Emoji: ${value} — change` : `${label} — choose`}
        aria-expanded={open}
        title="Choose an emoji"
        onClick={() => setOpen((v) => !v)}
      >
        {value ? <span className="text-lg leading-none">{value}</span> : <><Icon name="plus" size={14} /><span className="text-xs">emoji</span></>}
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 border border-base-300 bg-base-100 p-3 shadow-lg" role="dialog" aria-label="Choose an emoji">
          <input
            className="input input-sm mb-2 w-full"
            placeholder="Search or paste an emoji…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="grid max-h-48 grid-cols-8 gap-1 overflow-y-auto">
            {matches.map(([emoji, keywords]) => (
              <button
                key={keywords}
                type="button"
                className="btn btn-ghost btn-sm text-xl"
                title={keywords.split(" ")[0]}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {emoji}
              </button>
            ))}
            {!matches.length ? <p className="col-span-8 py-4 text-center text-sm ink-muted">No match. Paste any emoji in the search box.</p> : null}
          </div>
          {query.trim() && /\p{Extended_Pictographic}/u.test(query) ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-2 w-full"
              onClick={() => {
                onChange(query.trim());
                setOpen(false);
                setQuery("");
              }}
            >
              Use pasted emoji {query.trim()}
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
