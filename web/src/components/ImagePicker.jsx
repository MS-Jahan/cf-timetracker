import { useEffect, useRef, useState } from "react";
import { initialsOf } from "./IdentityMark.jsx";
import Icon from "./Icon.jsx";

const MAX_EDGE = 256;
const MAX_DATA_URL_LENGTH = 180_000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("That file is not a readable image."));
      image.onload = () => resolve(image);
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function resizeImage(file) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error("That image is still too large after resizing. Choose a simpler image.");
  }
  return dataUrl;
}

function Preview({ dataUrl, emoji, initials, size }) {
  return dataUrl ? (
    <img src={dataUrl} alt="" className={`${size} rounded-full object-cover`} />
  ) : (
    <span className={`${size} inline-flex items-center justify-center rounded-full bg-base-200 font-semibold text-base-content`}>
      {emoji || initials || "?"}
    </span>
  );
}

/**
 * Avatar-style image control: shows the stored image or an initials/emoji
 * placeholder next to the record name; hover or keyboard focus reveals an edit
 * affordance, and activating it opens a dialog with drag & drop, clipboard
 * paste, and file upload. Processing is unchanged: resize to ≤256×256 and store
 * a bounded base64 data URL.
 */
export default function ImagePicker({ value = "", name = "", emoji = "", label = "Image", onChange }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const initials = initialsOf(name);
  const dialogTitle = value ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`;

  const openDialog = () => {
    setPending("");
    setError("");
    setDragOver(false);
    setOpen(true);
    dialogRef.current?.showModal();
  };

  const closeDialog = () => dialogRef.current?.close();

  // Clipboard paste works anywhere while the dialog is open, not only when an
  // input inside it happens to hold focus.
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (event) => {
      const item = [...(event.clipboardData?.items || [])].find((candidate) => candidate.type.startsWith("image/"));
      if (!item) return;
      event.preventDefault();
      acceptFile(item.getAsFile());
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const acceptFile = async (file) => {
    if (!file?.type?.startsWith("image/")) {
      setError("That is not an image. Use a PNG, JPEG, or WebP file.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      setPending(await resizeImage(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (event) => {
    await acceptFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setDragOver(false);
    await acceptFile(event.dataTransfer.files?.[0]);
  };

  const apply = () => {
    if (!pending) return;
    onChange(pending);
    closeDialog();
  };

  const remove = () => {
    onChange("");
    closeDialog();
  };

  return (
    <>
      <button
        type="button"
        className="group relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-base-200 text-sm font-semibold text-base-content ring-accent transition-shadow hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
        aria-haspopup="dialog"
        aria-label={dialogTitle}
        title={`${dialogTitle} — drag & drop, paste, or upload`}
        onClick={openDialog}
      >
        <Preview dataUrl={value} emoji={emoji} initials={initials} size="size-full" />
        <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/55 text-white group-hover:flex group-focus-visible:flex" aria-hidden="true">
          <Icon name="edit" size={14} />
        </span>
      </button>

      <dialog ref={dialogRef} className="modal" onClose={() => setOpen(false)}>
        <div
          className="modal-box max-w-md"
          aria-labelledby="image-picker-title"
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <h3 id="image-picker-title" className="text-lg font-semibold">
            {dialogTitle}
          </h3>
          <p className="ink-muted mt-1 text-sm">
            Drag &amp; drop an image, paste it from the clipboard, or choose a file. It is resized to 256×256 and stored with the record.
          </p>

          <div className={`mt-4 flex flex-col items-center gap-3 rounded-box border-2 border-dashed p-5 text-center transition-colors ${dragOver ? "border-accent bg-accent/5" : "border-base-300"}`}>
            <Preview dataUrl={pending || value} emoji={emoji} initials={initials} size="size-16 text-xl" />
            {pending ? <p className="text-xs ink-muted">New image — not saved until you confirm.</p> : null}
            {busy ? <p className="text-sm ink-muted" role="status">Resizing…</p> : null}
            {error ? <p className="text-sm text-accent" role="alert">{error} Try another image.</p> : null}

            <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn btn-sm ring-1 ring-inset ring-base-300" disabled={busy} onClick={() => inputRef.current?.click()}>
                <Icon name="upload" size={15} />
                Choose a file
              </button>
              {pending ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={apply}>
                  <Icon name="check" size={15} />
                  Use this image
                </button>
              ) : null}
              {value && !pending ? (
                <button type="button" className="btn btn-ghost btn-sm text-accent" disabled={busy} onClick={remove}>
                  <Icon name="clear" size={15} />
                  Remove image
                </button>
              ) : null}
            </div>
          </div>

          <div className="modal-action">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button aria-label="Close">close</button>
        </form>
      </dialog>
    </>
  );
}
