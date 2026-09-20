import { useRef, useState } from "react";
import { parseVoiceTask } from "../lib/api.js";
import Icon from "./Icon.jsx";

const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  });
}

function supportedMimeType() {
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "audio/webm";
}

/** Records explicitly, sends audio to the Worker, and never starts a timer itself. */
export default function VoiceTaskCapture({ disabled = false, onDraft }) {
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [state, setState] = useState("idle"); // idle | recording | processing | success | error
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const processRecording = async (blob, mimeType, stream) => {
    stream.getTracks().forEach((track) => track.stop());
    setState("processing");

    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await parseVoiceTask({
        audioBase64,
        mimeType: mimeType.split(";")[0],
      });
      onDraft(result.draft);
      setSuccess("Draft added below. Review it, then start the timer when ready.");
      setState("success");
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  };

  const start = async () => {
    setError("");
    setSuccess("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser.");
      setState("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        processRecording(blob, mimeType, stream);
      };

      recorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (err) {
      const message = err.name === "NotAllowedError"
        ? "Microphone permission was denied."
        : `Could not start recording: ${err.message}`;
      setError(`${message} You can still fill the timer form manually.`);
      setState("error");
    }
  };

  const stop = () => {
    if (recorderRef.current?.state !== "recording") return;
    recorderRef.current.stop();
    recorderRef.current = null;
  };

  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isSuccess = state === "success";

  return (
    <div className="group/voice mt-4 flex flex-wrap items-center gap-3" aria-live="polite">
      {isRecording ? (
        <button type="button" className="btn btn-accent btn-sm" onClick={stop} aria-label="Stop voice recording">
          <Icon name="microphone" size={16} />
          Stop recording
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" disabled={disabled || isProcessing} onClick={start} title="Optional: creates a draft only — you review it before starting.">
          <Icon name="microphone" size={16} />
          {isProcessing ? "Understanding…" : "Describe by voice"}
        </button>
      )}
      {isRecording || isProcessing ? (
        <span className="text-sm ink-muted">
          {isRecording ? "Speak naturally: client, project, activity, and what you did." : "Turning your note into timer fields…"}
        </span>
      ) : (
        // Idle hint stays out of the way: revealed on hover/focus, title covers touch.
        <span className="text-sm ink-muted opacity-0 transition-opacity group-hover/voice:opacity-100 focus-within:opacity-100" title="Optional: creates a draft only — you review it before starting.">
          Optional: creates a draft only — you review it before starting.
        </span>
      )}
      {isSuccess ? <span className="text-sm text-success" role="status">{success}</span> : null}
      {error ? <span className="text-sm text-accent" role="alert">{error}</span> : null}
    </div>
  );
}
