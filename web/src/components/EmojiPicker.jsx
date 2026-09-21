import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

/* Curated emoji catalog with search keywords. Large enough to feel like a real
   picker; names double as tooltips. */
const EMOJIS = [
  // work & roles
  ["💼", "briefcase work business"], ["🧑‍💻", "developer coding programmer"], ["👨‍💼", "manager office"],
  ["👩‍💻", "woman developer coding"], ["🧑‍🔧", "technician engineer"], ["🧑‍🎨", "artist designer"],
  ["🧑‍🏫", "training teaching teacher"], ["🧑‍⚕️", "health doctor"], ["🧑‍⚖️", "review judge"],
  ["👨‍🍳", "cook chef"], ["🕵️", "investigate debug detective"], ["🧑‍🚀", "launch astronaut"],
  // screens & code
  ["💻", "laptop computer code"], ["🖥️", "desktop computer monitor"], ["⌨️", "keyboard typing"],
  ["🖱️", "mouse click"], ["📱", "phone mobile app"], ["☎️", "telephone call"],
  ["📞", "phone call meeting"], ["📟", "pager device"], ["🖨️", "printer"],
  ["🧮", "calc accounting abacus"], ["💾", "save floppy"], ["💿", "disk cd"],
  ["🛜", "wireless network wifi"], ["📡", "antenna network broadcast"], ["🔌", "plug integration power"],
  ["🔋", "battery energy"], ["🪫", "low battery tired"],
  // web & data
  ["🌐", "web globe internet site"], ["🔗", "link url"], ["🧵", "thread queue"],
  ["📊", "chart report analytics data"], ["📈", "chart growth graph up"], ["📉", "chart decline down"],
  ["🗄️", "archive database files"], ["🗂️", "files folder organize"], ["📁", "folder"],
  ["📄", "document page"], ["📃", "papers"], ["📋", "clipboard checklist"],
  ["📌", "pin important"], ["📍", "location pin"], ["📎", "attach clip"],
  ["🏷️", "tag label"], ["🔖", "bookmark"], ["🔍", "search find magnify"],
  ["🔎", "search zoom"], ["🧩", "integration puzzle part"], ["🪢", "knot complex"],
  // writing & communication
  ["✉️", "email message mail"], ["📩", "incoming mail"], ["📤", "outbox send"],
  ["💬", "comment chat discussion"], ["💭", "thought idea bubble"], ["🗣️", "speaking discussion voice"],
  ["📝", "note writing notes memo"], ["✏️", "pencil edit"], ["🖊️", "pen write"],
  ["📚", "books docs documentation"], ["📖", "book reading"], ["📰", "news update"],
  ["📢", "announce marketing megaphone"], ["📣", "announcement"], ["🔇", "mute silence"],
  // time
  ["⏰", "clock alarm time morning"], ["⏱️", "stopwatch timer"], ["⏲️", "timer countdown"],
  ["🕐", "clock time hour"], ["⏳", "waiting pending hourglass"], ["📅", "calendar date schedule"],
  ["📆", "calendar month"], ["🗓️", "planner schedule"], ["🕒", "three oclock"],
  ["🌅", "morning start sunrise"], ["🌄", "dawn"], ["🌙", "night late moon"],
  ["🌃", "night city"], ["☀️", "sunny day"], ["☁️", "cloud"], ["🌧️", "rain slow"],
  ["🌩️", "incident storm outage"], ["❄️", "freeze cold"], ["🌊", "flow wave"],
  // build & fix
  ["🚀", "rocket launch ship deploy"], ["🛠️", "tools maintenance"], ["🔧", "wrench fix tool"],
  ["🔨", "hammer build"], ["⚙️", "gear settings config"], ["🧲", "attract magnet"],
  ["🧪", "test experiment lab"], ["🔬", "research microscope"], ["🔭", "vision telescope roadmap"],
  ["📦", "package deploy release box"], ["🚚", "shipping delivery"], ["🏗️", "construction build"],
  ["🧱", "blocks brick build"], ["⛏️", "mining dig"], ["🪚", "saw cut"],
  ["🔩", "bolt hardware"], ["🧰", "toolbox"], ["🪛", "screwdriver assemble"],
  // design
  ["🎨", "design art paint"], ["🖌️", "paint brush design"], ["🖍️", "highlight"],
  ["📐", "design measure ruler"], ["📏", "ruler size"], ["✂️", "cut edit scissors"],
  ["🖼️", "image picture frame"], ["📸", "photo camera"], ["🎬", "video film clip"],
  ["🎤", "microphone voice mic record"], ["🎧", "headphones audio"], ["🎼", "music"],
  ["🎭", "drama theater"], ["🪄", "magic automation wand"], ["✨", "sparkles new polish"],
  // money
  ["💰", "money bag billing"], ["💵", "dollar cash"], ["💴", "yen cash"],
  ["💶", "euro cash"], ["💷", "pound cash"], ["💸", "money fly spend"],
  // status & flow
  ["✅", "done check complete yes"], ["☑️", "checked task"], ["✔️", "check mark"],
  ["❌", "wrong cancel no"], ["⛔", "stop blocked"], ["🛑", "stop halt"],
  ["⚠️", "warning caution"], ["🚸", "caution care"], ["🔥", "hot urgent fire"],
  ["🚨", "alert emergency incident"], ["🚦", "status traffic light"], ["🚧", "wip maintenance construction"],
  ["🟢", "green ok"], ["🟡", "yellow pending"], ["🔴", "red down critical"],
  ["🔄", "sync update loop"], ["🔁", "repeat"], ["🔀", "branch merge"],
  ["➡️", "next forward"], ["⬅️", "back"], ["⬆️", "upgrade up"], ["⬇️", "downgrade"],
  ["♻️", "refactor recycle"], ["🌱", "seedling new start"], ["🪴", "growth potted"],
  ["🌳", "mature tree"], ["🌿", "nature green"], ["🧊", "freeze freeze"],
  ["💨", "fast wind"], ["⚡", "fast performance quick"], ["🎯", "target goal sprint"],
  ["🕹️", "game joystick"], ["🎮", "game play"], ["🎲", "random chance"],
  // people & meetings
  ["🤝", "handshake deal meeting"], ["🧑‍🤝‍🧑", "team people pair"], ["👥", "group users"],
  ["🙏", "thanks please"], ["👍", "thumbs up good"], ["👎", "thumbs down bad"],
  ["👏", "applaud praise"], ["👀", "review watch look"], ["🤔", "thinking question"],
  ["🫡", "salute acknowledge"], ["🧠", "brain smart plan"], ["❤️", "love favorite"],
  ["🩺", "diagnosis health check"], ["🛋️", "rest lounge"], ["☕", "coffee break"],
  ["🍵", "tea break"], ["🍽️", "lunch food eat"], ["🍕", "pizza team lunch"],
  ["🍪", "cookie snack"], ["🎉", "celebrate launch party"], ["🎊", "party"],
  ["🏆", "award win done trophy"], ["🥇", "gold first place"], ["🥈", "silver second"],
  ["🎁", "gift bonus"], ["🌟", "star excellent"], ["⭐", "star favorite"],
  ["💯", "hundred perfect"], ["💪", "strong effort"], ["🫶", "appreciate"],
  // travel & places
  ["🌍", "world i18n earth"], ["🗺️", "roadmap map plan"], ["🧭", "compass direction"],
  ["🏠", "home remote"], ["🏢", "office building"], ["🏬", "store shop"],
  ["🏥", "hospital health"], ["🏫", "school education"], ["🚗", "car travel"],
  ["✈️", "flight travel trip"], ["🚄", "fast train"], ["🛳️", "cruise long"],
  // misc useful
  ["🔑", "key access"], ["🔒", "lock security private"], ["🔓", "unlock open"],
  ["🛡️", "shield security protection"], ["🪪", "id card account"], ["📧", "email"],
  ["🆗", "ok approved"], ["🆕", "new"], ["🔝", "top priority"], ["☄️", "crash comet"],
  ["🧿", "protect charm"], ["🕯️", "candle late night"], ["🫧", "bubbles clean"],
  ["🪸", "coral reef ecosystem"], ["🍀", "luck fortune"], ["🌈", "rainbow diversity"],
  ["🫡", "respect"], ["🧘", "calm balance"], ["🚶", "walk step"], ["🏃", "run sprint fast"],
];

export default function EmojiPicker({ value, onChange, label = "Emoji" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  // Position: fixed so the table's overflow-x-auto cannot clip the popup; it
  // renders above the page chrome instead of inside the activity section.
  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 288; // w-72
    const height = 320; // generous estimate; clamped below
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top = rect.bottom + 6;
    setCoords({
      left,
      top: top + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : top,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJIS;
    return EMOJIS.filter(([, keywords]) => keywords.includes(q));
  }, [query]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm min-w-11 px-2 ring-1 ring-inset ring-base-300"
        aria-label={value ? `Emoji: ${value} - change` : `${label} - choose`}
        aria-expanded={open}
        title="Choose an emoji"
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
      >
        {value ? <span className="text-lg leading-none">{value}</span> : <><Icon name="plus" size={14} /><span className="text-xs">emoji</span></>}
      </button>

      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[70] w-72 border border-base-300 bg-base-100 p-3 shadow-xl"
              style={{ left: coords.left, top: coords.top }}
              role="dialog"
              aria-label="Choose an emoji"
            >
              <input
                className="input input-sm mb-2 w-full"
                placeholder="Search or paste an emoji…"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
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
            </div>,
            document.body
          )
        : null}
    </>
  );
}
