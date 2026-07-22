import { useEffect, useRef, useState } from "react";
import ChatBubble from "./ChatBubble.jsx";
import VoiceWaveform from "./VoiceWaveform.jsx";
import { startMoodSession } from "../lib/api.js";
import { DEFAULT_VIBE, VIBE_STYLES } from "../lib/vibe.js";

// States:
//   idle           — no session yet, show "Start check-in"
//   opening        — calling /session/start + opening the WebSocket
//   agent          — agent reply streaming in (captions + audio)
//   recording-ready
//   recording      — user speaking, mic live (waveform)
//   processing     — turn sent, waiting for the agent's first reply
//   done           — finalized; show closing summary card
//   crisis         — finalized via the deterministic safety path; show the
//                    crisis-support card instead of the mood summary
//
// Turns after the opener go over a WebSocket (/ws/mood/session/{id}) rather
// than one REST call per turn: text renders per sentence as the coach reply
// is generated, and each sentence's audio starts playing as soon as it's
// synthesized, instead of waiting for the whole reply to finish generating
// and downloading before anything appears.
export default function VoiceSession({ onComplete }) {
  const [state, setState] = useState("idle");
  const [turns, setTurns] = useState([]); // [{role: 'agent'|'user', text}]
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [recordingAnalyser, setRecordingAnalyser] = useState(null);
  const [playbackAnalyser, setPlaybackAnalyser] = useState(null);
  const [vibe, setVibe] = useState(DEFAULT_VIBE);
  const [result, setResult] = useState(null); // last turn_done payload, for the summary/crisis card

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const openerAudioRef = useRef(null);

  const pendingAudioBytesRef = useRef([]); // Uint8Array[] for the sentence in flight
  const audioQueueRef = useRef([]); // object URLs waiting to play, in order
  const isPlayingRef = useRef(false);
  const pendingTurnDoneRef = useRef(null);

  useEffect(() => () => cleanup(), []);

  const ensureAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  const cleanup = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* already closed */
      }
      wsRef.current = null;
    }
    if (recorderRef.current?.stream) {
      recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    recorderRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (openerAudioRef.current) {
      openerAudioRef.current.pause();
      try {
        URL.revokeObjectURL(openerAudioRef.current.src);
      } catch {
        /* not an object URL */
      }
      openerAudioRef.current = null;
    }
    audioQueueRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    });
    audioQueueRef.current = [];
    pendingAudioBytesRef.current = [];
    pendingTurnDoneRef.current = null;
    isPlayingRef.current = false;
    setPlaybackAnalyser(null);
    setRecordingAnalyser(null);
    setVibe(DEFAULT_VIBE);
  };

  const applyPendingTurnDone = () => {
    const payload = pendingTurnDoneRef.current;
    pendingTurnDoneRef.current = null;
    if (!payload) return;
    if (payload.done) {
      setResult(payload);
      setState(payload.safety_event ? "crisis" : "done");
      if (payload.mood_entry && !payload.safety_event) onComplete?.(payload.mood_entry);
    } else {
      setState("recording-ready");
    }
  };

  const playNextInQueue = () => {
    const url = audioQueueRef.current.shift();
    if (!url) {
      isPlayingRef.current = false;
      setPlaybackAnalyser(null);
      if (pendingTurnDoneRef.current) applyPendingTurnDone();
      return;
    }
    isPlayingRef.current = true;
    const audio = new Audio(url);
    try {
      const ctx = ensureAudioCtx();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      setPlaybackAnalyser(analyser);
    } catch {
      // Web Audio graph unavailable -- audio still plays, just no waveform.
    }
    const advance = () => {
      URL.revokeObjectURL(url);
      playNextInQueue();
    };
    audio.onended = advance;
    audio.onerror = advance;
    audio.play().catch(advance);
  };

  const handleWsMessage = (msg) => {
    switch (msg.type) {
      case "vibe":
        setVibe(msg.vibe);
        break;
      case "transcript":
        setTurns((prev) => [...prev, { role: "user", text: msg.text }]);
        break;
      case "text_delta":
        setState("agent");
        setTurns((prev) => [...prev, { role: "agent", text: msg.text }]);
        break;
      case "audio_chunk": {
        const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
        pendingAudioBytesRef.current.push(bytes);
        break;
      }
      case "sentence_done": {
        const blob = new Blob(pendingAudioBytesRef.current, { type: "audio/mpeg" });
        pendingAudioBytesRef.current = [];
        if (blob.size > 0) {
          audioQueueRef.current.push(URL.createObjectURL(blob));
          if (!isPlayingRef.current) playNextInQueue();
        }
        break;
      }
      case "turn_done":
        pendingTurnDoneRef.current = msg;
        if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
          applyPendingTurnDone();
        }
        break;
      case "error":
        setError(msg.detail || "Something went wrong");
        setState((s) => (s === "processing" || s === "agent" ? "recording-ready" : s));
        break;
      default:
        break;
    }
  };

  const openSocket = (sessionId) =>
    new Promise((resolve, reject) => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/mood/session/${sessionId}`);
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error("Couldn't connect to the voice agent"));
      ws.onmessage = (event) => {
        try {
          handleWsMessage(JSON.parse(event.data));
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
      };
      wsRef.current = ws;
    });

  const playOpenerAudio = (b64) =>
    new Promise((resolve) => {
      if (!b64) return resolve();
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        openerAudioRef.current = audio;
        const done = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      } catch {
        resolve();
      }
    });

  const beginSession = async () => {
    setError(null);
    setTurns([]);
    setResult(null);
    setState("opening");
    ensureAudioCtx();
    try {
      const res = await startMoodSession();
      setVibe(res.vibe || DEFAULT_VIBE);
      setTurns([{ role: "agent", text: res.agent_message }]);
      await openSocket(res.session_id);
      setState("agent");
      await playOpenerAudio(res.audio_b64);
      setState("recording-ready");
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to start");
      setState("idle");
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      try {
        const ctx = ensureAudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        source.connect(analyser); // not connected to destination -- no echo
        setRecordingAnalyser(analyser);
      } catch {
        // Waveform unavailable -- recording itself still works.
      }

      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (type) => MediaRecorder.isTypeSupported(type)
      );
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
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

  const stopRecording = () => {
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  };

  const handleStop = () => {
    setState("processing");
    setRecordingAnalyser(null);
    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm",
    });
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    recorderRef.current = null;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      sendTurn({ type: "audio_turn", data: base64, mime: blob.type.includes("mp4") ? "mp4" : "webm" });
    };
    reader.onerror = () => {
      setError("Couldn't read the recording");
      setState("recording-ready");
    };
    reader.readAsDataURL(blob);
  };

  const sendTurn = (payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Connection lost — please start a new check-in.");
      setState("recording-ready");
      return;
    }
    wsRef.current.send(JSON.stringify(payload));
  };

  const submitText = () => {
    const text = draft.trim();
    if (!text || state !== "recording-ready") return;
    setDraft("");
    setError(null);
    setState("processing");
    setTurns((prev) => [...prev, { role: "user", text }]);
    sendTurn({ type: "text_turn", text });
  };

  const reset = () => {
    cleanup();
    setTurns([]);
    setDraft("");
    setError(null);
    setResult(null);
    setState("idle");
  };

  const isOrbState = ["idle", "opening", "agent", "recording-ready", "recording", "processing"].includes(
    state
  );

  return (
    <div style={wrap}>
      {state === "crisis" ? (
        <CrisisCard onContinue={reset} />
      ) : state === "done" ? (
        <SummaryCard entry={result?.mood_entry} onReset={reset} />
      ) : (
        <>
          {isOrbState ? (
            <Orb state={state} onStart={beginSession} onRecord={startRecording} onStop={stopRecording} />
          ) : null}

          {state === "recording" ? (
            <VoiceWaveform
              analyser={recordingAnalyser}
              active
              color={VIBE_STYLES[vibe].color}
              intensity={VIBE_STYLES[vibe].intensity}
            />
          ) : state === "agent" ? (
            <VoiceWaveform
              analyser={playbackAnalyser}
              active={!!playbackAnalyser}
              color={VIBE_STYLES[vibe].color}
              intensity={VIBE_STYLES[vibe].intensity}
            />
          ) : null}

          {turns.length > 0 ? (
            <div style={transcriptBox}>
              {turns.map((t, i) => (
                <ChatBubble key={i} role={t.role} text={t.text} />
              ))}
              {state === "processing" ? <ChatBubble role="agent" text="…" muted /> : null}
            </div>
          ) : null}

          {state === "recording-ready" ? (
            <div style={textReplyRow}>
              <input
                aria-label="Type your check-in"
                placeholder="Or type your reply…"
                value={draft}
                maxLength={4000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitText();
                }}
                style={textInput}
              />
              <button
                aria-label="Send typed reply"
                onClick={submitText}
                disabled={!draft.trim()}
                style={{ ...sendButton, opacity: draft.trim() ? 1 : 0.5 }}
              >
                Send
              </button>
            </div>
          ) : null}

          <div style={disclaimer}>
            Demo only — not medical advice or crisis support. In the U.S., call or
            text 988 for immediate emotional support.
          </div>
        </>
      )}

      {error ? <div style={errorBox}>{error}</div> : null}
    </div>
  );
}

const ORB_CONFIG = {
  idle: {
    gradient: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 3.4s ease-in-out infinite",
    glow: "0 0 60px rgba(77,163,255,0.35)",
    label: "Tap to start check-in",
    clickable: true,
  },
  opening: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
    label: "Connecting…",
    clickable: false,
  },
  agent: {
    gradient: "radial-gradient(circle at 35% 30%, #6ee7b7, #34d399 45%, #4da3ff 100%)",
    animation: "breathe 0.8s ease-in-out infinite alternate",
    glow: "0 0 90px rgba(52,211,153,0.6)",
    label: "Coach is speaking…",
    clickable: false,
  },
  "recording-ready": {
    gradient: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 3.4s ease-in-out infinite",
    glow: "0 0 60px rgba(77,163,255,0.35)",
    label: "Tap to answer",
    clickable: true,
  },
  recording: {
    gradient: "radial-gradient(circle at 35% 30%, #9ccaff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 1.1s ease-in-out infinite",
    glow: "0 0 90px rgba(77,163,255,0.6)",
    label: "Listening… (tap to send)",
    clickable: true,
  },
  processing: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
    label: "Thinking…",
    clickable: false,
  },
};

function Orb({ state, onStart, onRecord, onStop }) {
  const cfg = ORB_CONFIG[state] || ORB_CONFIG.idle;
  const onClick =
    state === "idle" ? onStart : state === "recording-ready" ? onRecord : state === "recording" ? onStop : undefined;
  return (
    <div style={orbWrap}>
      <div
        onClick={cfg.clickable ? onClick : undefined}
        style={{
          width: 176,
          height: 176,
          borderRadius: "50%",
          background: cfg.gradient,
          animation: cfg.animation,
          boxShadow: cfg.glow,
          cursor: cfg.clickable ? "pointer" : "default",
          transition: "box-shadow 400ms",
        }}
      />
      <div style={orbLabel}>{cfg.label}</div>
    </div>
  );
}

function SummaryCard({ entry, onReset }) {
  if (!entry) return null;
  return (
    <div style={summaryCard}>
      <div style={summaryEyebrow}>Today's check-in</div>
      <div style={summaryStats}>
        <div>
          <div style={{ ...summaryStatValue, color: "var(--mood-color)" }}>{entry.mood_score}</div>
          <div style={summaryStatLabel}>Mood</div>
        </div>
        <div>
          <div style={{ ...summaryStatValue, color: "var(--energy-color)" }}>{entry.energy_level}</div>
          <div style={summaryStatLabel}>Energy</div>
        </div>
        <div>
          <div style={{ ...summaryStatValue, color: "var(--anxiety-color)" }}>{entry.anxiety_level}</div>
          <div style={summaryStatLabel}>Anxiety</div>
        </div>
      </div>
      {entry.summary ? <p style={summaryText}>{entry.summary}</p> : null}
      <button onClick={onReset} style={summaryAction}>
        Done — Start another
      </button>
    </div>
  );
}

function CrisisCard({ onContinue }) {
  return (
    <div style={crisisCard}>
      <div style={crisisIcon} />
      <div style={crisisTitle}>That sounds really heavy.</div>
      <p style={crisisBody}>
        I want to make sure you're supported right now — you don't have to go
        through this alone.
      </p>
      <div style={crisisInfoBox}>
        <div style={crisisInfoLine}>
          988 Suicide &amp; Crisis Lifeline — call or text <a href="tel:988">988</a>
        </div>
        <div style={crisisInfoLine}>Crisis Text Line — text HOME to 741741</div>
      </div>
      <button onClick={onContinue} style={crisisAction}>
        I'm safe — continue check-in
      </button>
    </div>
  );
}

const wrap = { marginTop: 16 };
const orbWrap = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "24px 0",
};
const orbLabel = {
  marginTop: 26,
  fontSize: 15,
  color: "var(--text-secondary)",
  letterSpacing: "0.02em",
};
const transcriptBox = {
  maxHeight: 260,
  overflowY: "auto",
  padding: 12,
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 8,
  marginBottom: 12,
  textAlign: "left",
};
const disclaimer = {
  marginTop: 9,
  color: "var(--text-secondary)",
  fontSize: 10,
  lineHeight: 1.45,
  textAlign: "center",
};
const textReplyRow = {
  display: "flex",
  gap: 8,
  marginTop: 8,
};
const textInput = {
  flex: 1,
  minWidth: 0,
  padding: "11px 12px",
  color: "var(--text-primary)",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 13,
  outline: "none",
};
const sendButton = {
  padding: "0 16px",
  color: "var(--bg-primary)",
  background: "var(--mood-color)",
  border: 0,
  borderRadius: 10,
  fontWeight: 600,
  cursor: "pointer",
};
const errorBox = {
  marginTop: 8,
  padding: 10,
  background: "rgba(255,92,92,0.1)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
};
const summaryCard = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: 40,
  textAlign: "center",
  animation: "fadeUp 400ms ease both",
};
const summaryEyebrow = {
  fontSize: 13,
  letterSpacing: "0.1em",
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  marginBottom: 18,
};
const summaryStats = { display: "flex", justifyContent: "center", gap: 28, marginBottom: 26 };
const summaryStatValue = { fontSize: 28, fontWeight: 600 };
const summaryStatLabel = { fontSize: 12, color: "var(--text-secondary)", marginTop: 4 };
const summaryText = { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 28px" };
const summaryAction = {
  background: "var(--mood-color)",
  color: "var(--bg-primary)",
  border: 0,
  padding: 14,
  borderRadius: 100,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
};
const crisisCard = {
  background: "var(--bg-elevated)",
  border: "1px solid rgba(167,139,250,0.35)",
  borderRadius: 20,
  padding: 40,
  textAlign: "center",
  animation: "fadeUp 400ms ease both",
};
const crisisIcon = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: "rgba(167,139,250,0.16)",
  border: "1px solid rgba(167,139,250,0.4)",
  margin: "0 auto 20px",
};
const crisisTitle = { fontSize: 18, fontWeight: 600, marginBottom: 12 };
const crisisBody = { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, margin: "0 0 22px" };
const crisisInfoBox = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  textAlign: "left",
  marginBottom: 24,
};
const crisisInfoLine = { fontSize: 13, color: "var(--text-primary)", marginBottom: 6 };
const crisisAction = {
  background: "var(--text-primary)",
  color: "var(--bg-primary)",
  border: 0,
  padding: 14,
  borderRadius: 100,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
};
