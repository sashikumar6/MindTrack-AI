import { useEffect, useRef, useState } from "react";
import { Mic, Loader2, Check } from "lucide-react";
import { submitMoodAudio } from "../lib/api.js";

export default function VoiceButton({ onResult }) {
  const [state, setState] = useState("idle"); // idle | recording | processing | done
  const [error, setError] = useState(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioRef = useRef(null);

  useEffect(() => () => stopMediaTracks(), []);

  const stopMediaTracks = () => {
    const r = recorderRef.current;
    if (r && r.stream) {
      r.stream.getTracks().forEach((t) => t.stop());
    }
    recorderRef.current = null;
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
    } catch (e) {
      setError(e.message || "Microphone access denied");
    }
  };

  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  };

  const handleStop = async () => {
    setState("processing");
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    stopMediaTracks();

    try {
      const result = await submitMoodAudio(blob);
      if (result.audio_b64) {
        playAudio(result.audio_b64);
      }
      onResult?.(result);
      setState("done");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Submit failed");
      setState("idle");
    }
  };

  const playAudio = (b64) => {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch (e) {
      console.warn("Audio playback failed", e);
    }
  };

  const onClick = () => {
    if (state === "idle") start();
    else if (state === "recording") stop();
  };

  const meta = STATE_META[state];

  return (
    <div>
      <button
        onClick={onClick}
        disabled={state === "processing"}
        style={{ ...btn, background: meta.bg, animation: meta.animation }}
      >
        <meta.Icon size={18} style={meta.iconStyle} />
        <span>{meta.label}</span>
      </button>
      {error ? <div style={errorBox}>{error}</div> : null}
    </div>
  );
}

const STATE_META = {
  idle: { Icon: Mic, label: "Record Check-in", bg: "var(--bg-elevated)", animation: "pulse 2.4s ease-in-out infinite" },
  recording: { Icon: Mic, label: "Listening… (tap to stop)", bg: "var(--anxiety-color)", animation: "none" },
  processing: { Icon: Loader2, label: "Processing…", bg: "var(--bg-elevated)", animation: "none", iconStyle: { animation: "spin 1s linear infinite" } },
  done: { Icon: Check, label: "Saved", bg: "var(--mood-color)", animation: "none" },
};

const btn = {
  marginTop: 16,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "14px 16px",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--text-primary)",
  fontSize: 15,
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 200ms ease",
};

const errorBox = {
  marginTop: 8,
  padding: 10,
  background: "rgba(255,69,58,0.1)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
};
