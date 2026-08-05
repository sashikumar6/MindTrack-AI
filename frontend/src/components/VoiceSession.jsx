import { useEffect, useRef, useState } from "react";
import VoiceWaveform from "./VoiceWaveform.jsx";
import { startMoodSession } from "../lib/api.js";
import { companionNameForPersona } from "../lib/companions.js";
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
export default function VoiceSession({ onComplete, personaMode = "empathetic" }) {
  const [state, setState] = useState("idle");
  const [turns, setTurns] = useState([]); // [{role: 'agent'|'user', text}]
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [recordingAnalyser, setRecordingAnalyser] = useState(null);
  const [playbackAnalyser, setPlaybackAnalyser] = useState(null);
  const [vibe, setVibe] = useState(DEFAULT_VIBE);
  const [result, setResult] = useState(null); // last turn_done payload, for the summary/crisis card
  const [agentName, setAgentName] = useState(() => companionNameForPersona(personaMode));

  const wsRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const openerAudioRef = useRef(null);
  const speechRef = useRef(null);
  const vadFrameRef = useRef(null);
  const startingRecordingRef = useRef(false);
  const sessionIdRef = useRef(null);
  const endRequestedRef = useRef(false);
  const requestFinalizeRef = useRef(null);

  const pendingAudioBytesRef = useRef([]); // Uint8Array[] for the sentence in flight
  const pendingSentenceTextRef = useRef("");
  const audioQueueRef = useRef([]); // {type: 'audio'|'speech', url?|text?}[]
  const isPlayingRef = useRef(false);
  const pendingTurnDoneRef = useRef(null);

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (state === "idle") setAgentName(companionNameForPersona(personaMode));
  }, [personaMode, state]);

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
    if (vadFrameRef.current) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    startingRecordingRef.current = false;
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
    if (speechRef.current) {
      speechRef.current.onend = null;
      speechRef.current.onerror = null;
      speechRef.current = null;
    }
    window.speechSynthesis?.cancel();
    audioQueueRef.current.forEach((item) => {
      if (item.type === "audio" && item.url) {
        try {
          URL.revokeObjectURL(item.url);
        } catch {
          /* already revoked */
        }
      }
    });
    audioQueueRef.current = [];
    pendingAudioBytesRef.current = [];
    pendingSentenceTextRef.current = "";
    pendingTurnDoneRef.current = null;
    sessionIdRef.current = null;
    endRequestedRef.current = false;
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
    } else if (endRequestedRef.current) {
      // If the user tapped End while we were still processing their last
      // recording, wait until that turn is fully captured before scoring it.
      endRequestedRef.current = false;
      requestFinalizeRef.current?.();
    } else {
      setState("recording-ready");
      window.setTimeout(() => startRecording(), 180);
    }
  };

  const playNextInQueue = () => {
    const item = audioQueueRef.current.shift();
    if (!item) {
      isPlayingRef.current = false;
      setPlaybackAnalyser(null);
      if (pendingTurnDoneRef.current) applyPendingTurnDone();
      return;
    }
    isPlayingRef.current = true;
    if (item.type === "speech") {
      setPlaybackAnalyser(null);
      playDeviceSpeech(item.text, agentName, speechRef).then(playNextInQueue);
      return;
    }

    const audio = new Audio(item.url);
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
      URL.revokeObjectURL(item.url);
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
        pendingSentenceTextRef.current = msg.text;
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
        const sentence = pendingSentenceTextRef.current;
        pendingSentenceTextRef.current = "";
        if (blob.size > 0) {
          audioQueueRef.current.push({ type: "audio", url: URL.createObjectURL(blob) });
        } else if (sentence) {
          audioQueueRef.current.push({ type: "speech", text: sentence });
        }
        if (!isPlayingRef.current && audioQueueRef.current.length > 0) playNextInQueue();
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

  const getMicrophoneStream = async () => {
    const existing = micStreamRef.current;
    if (existing?.getAudioTracks().some((track) => track.readyState === "live")) {
      return existing;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;
    return stream;
  };

  const playOpenerAudio = (b64, text) =>
    new Promise((resolve) => {
      if (!b64) {
        playDeviceSpeech(text, agentName, speechRef).then(resolve);
        return;
      }
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
      await getMicrophoneStream();
      const res = await startMoodSession();
      sessionIdRef.current = res.session_id;
      const sessionAgentName = res.agent_name || companionNameForPersona(personaMode);
      setAgentName(sessionAgentName);
      setVibe(res.vibe || DEFAULT_VIBE);
      setTurns([{ role: "agent", text: res.agent_message }]);
      await openSocket(res.session_id);
      setState("agent");
      await playOpenerAudio(res.audio_b64, res.agent_message);
      setState("recording-ready");
      await startRecording();
    } catch (e) {
      cleanup();
      setError(e?.response?.data?.detail || e.message || "Failed to start");
      setState("idle");
    }
  };

  const startRecording = async () => {
    if (startingRecordingRef.current || recorderRef.current?.state === "recording") return;
    startingRecordingRef.current = true;
    setError(null);
    try {
      const stream = await getMicrophoneStream();
      let analyser = null;
      try {
        const ctx = ensureAudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
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
      recorderRef.current = recorder;
      recorder.onstop = () => handleStop(recorder);
      recorder.start(250);
      setState("recording");
      if (analyser) {
        startSilenceDetection(analyser, recorder, vadFrameRef, () => {
          if (recorder.state === "recording") recorder.stop();
        });
      }
    } catch (e) {
      setError(e.message || "Microphone access denied");
      setState("recording-ready");
    } finally {
      startingRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    stopSilenceDetection(vadFrameRef);
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  };

  const requestFinalize = () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Connection lost — please start a new check-in.");
      return;
    }
    setError(null);
    setState("processing");
    wsRef.current.send(JSON.stringify({ type: "finalize" }));
  };

  requestFinalizeRef.current = requestFinalize;

  const endCheckin = () => {
    if (state === "recording") {
      // Preserve the last spoken thought: the recording is transcribed and
      // stored first, then the explicit finalize request follows.
      endRequestedRef.current = true;
      stopRecording();
      return;
    }
    if (state === "agent" || state === "processing") {
      endRequestedRef.current = true;
      return;
    }
    if (state === "recording-ready") requestFinalize();
  };

  const handleStop = (recorder) => {
    stopSilenceDetection(vadFrameRef);
    setState("processing");
    setRecordingAnalyser(null);
    const blob = new Blob(chunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
    if (recorderRef.current === recorder) recorderRef.current = null;

    if (!blob.size) {
      setError("I didn't catch that. Keep speaking and I'll send when you pause.");
      setState("recording-ready");
      return;
    }

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
    <div className="voice-session">
      {state === "crisis" ? (
        <CrisisCard onContinue={reset} />
      ) : state === "done" ? (
        <SummaryCard entry={result?.mood_entry} onReset={reset} />
      ) : (
        <>
          {isOrbState ? (
            <Orb
              state={state}
              agentName={agentName}
              onStart={beginSession}
              onRecord={startRecording}
              onStop={stopRecording}
            />
          ) : null}

          {state === "recording" ? (
            <div className="voice-waveform-wrap">
              <VoiceWaveform
                analyser={recordingAnalyser}
                active
                color={VIBE_STYLES[vibe].color}
                intensity={VIBE_STYLES[vibe].intensity}
                barCount={12}
              />
            </div>
          ) : state === "agent" ? (
            <div className="voice-waveform-wrap">
              <VoiceWaveform
                analyser={playbackAnalyser}
                active={!!playbackAnalyser}
                color={VIBE_STYLES[vibe].color}
                intensity={VIBE_STYLES[vibe].intensity}
                barCount={12}
              />
            </div>
          ) : null}

          {turns.length > 0 ? (
            <div className="voice-captions" aria-live="polite">
              {turns.slice(-2).map((turn, index, visibleTurns) => (
                <div
                  key={`${turn.role}-${turns.length - visibleTurns.length + index}`}
                  className={`voice-caption ${turn.role === "user" ? "user" : "agent"}`}
                >
                  {turn.text}
                </div>
              ))}
              {state === "processing" ? <div className="voice-caption agent muted">{agentName} is thinking…</div> : null}
            </div>
          ) : null}

          {state === "recording-ready" ? (
            <details className="type-reply">
              <summary>Prefer to type?</summary>
              <div className="type-reply-row">
                <input
                  aria-label="Type your check-in"
                  placeholder="Type your reply…"
                  value={draft}
                  maxLength={4000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitText();
                  }}
                />
                <button aria-label="Send typed reply" onClick={submitText} disabled={!draft.trim()}>
                  Send
                </button>
              </div>
            </details>
          ) : null}

          {state !== "idle" && state !== "opening" ? (
            <button type="button" className="realtime-end-button" onClick={endCheckin}>
              <span className="realtime-end-icon" aria-hidden="true">✓</span>
              Finish &amp; save
            </button>
          ) : null}

        </>
      )}

      {error ? <div className="voice-error">{error}</div> : null}
    </div>
  );
}

const ORB_CONFIG = {
  idle: {
    gradient: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 3.4s ease-in-out infinite",
    glow: "0 0 60px rgba(77,163,255,0.35)",
    label: (name) => `Tap to start with ${name}`,
    clickable: true,
  },
  opening: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
    label: (name) => `Connecting to ${name}…`,
    clickable: false,
  },
  agent: {
    gradient: "radial-gradient(circle at 35% 30%, #6ee7b7, #34d399 45%, #4da3ff 100%)",
    animation: "breathe 0.8s ease-in-out infinite alternate",
    glow: "0 0 90px rgba(52,211,153,0.6)",
    label: (name) => `${name} is speaking…`,
    clickable: false,
  },
  "recording-ready": {
    gradient: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 3.4s ease-in-out infinite",
    glow: "0 0 60px rgba(77,163,255,0.35)",
    label: () => "Preparing to listen…",
    clickable: true,
  },
  recording: {
    gradient: "radial-gradient(circle at 35% 30%, #9ccaff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 1.1s ease-in-out infinite",
    glow: "0 0 90px rgba(77,163,255,0.6)",
    label: () => "Listening… take your time, or tap when you're done",
    clickable: true,
  },
  processing: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
    label: (name) => `${name} is thinking…`,
    clickable: false,
  },
};

function Orb({ state, agentName, onStart, onRecord, onStop }) {
  const cfg = ORB_CONFIG[state] || ORB_CONFIG.idle;
  const label = cfg.label(agentName);
  const onClick =
    state === "idle" ? onStart : state === "recording-ready" ? onRecord : state === "recording" ? onStop : undefined;
  return (
    <div className="voice-orb-wrap">
      <button
        type="button"
        aria-label={label}
        onClick={cfg.clickable ? onClick : undefined}
        disabled={!cfg.clickable}
        className="voice-orb"
        style={{
          background: cfg.gradient,
          animation: cfg.animation,
          boxShadow: cfg.glow,
          cursor: cfg.clickable ? "pointer" : "default",
        }}
      />
      <div className="voice-orb-label">{label}</div>
    </div>
  );
}

function stopSilenceDetection(frameRef) {
  if (frameRef.current) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
}

function startSilenceDetection(analyser, recorder, frameRef, onSilence) {
  stopSilenceDetection(frameRef);
  const samples = new Uint8Array(analyser.fftSize);
  let noiseFloor = 0.008;
  let voicedSince = null;
  let speechStarted = false;
  let lastSpeechAt = null;
  let speechStartedAt = null;

  const tick = () => {
    if (recorder.state !== "recording") {
      stopSilenceDetection(frameRef);
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      energy += normalized * normalized;
    }
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();

    if (!speechStarted) {
      if (rms < 0.08) noiseFloor = noiseFloor * 0.95 + rms * 0.05;
      const startThreshold = Math.max(0.025, noiseFloor * 2.8);
      if (rms >= startThreshold) {
        voicedSince ??= now;
        if (now - voicedSince >= 140) {
          speechStarted = true;
          lastSpeechAt = now;
          speechStartedAt = now;
        }
      } else {
        voicedSince = null;
      }
    } else {
      const continueThreshold = Math.max(0.018, noiseFloor * 1.7);
      if (rms >= continueThreshold) {
        lastSpeechAt = now;
      } else if (
        // Fallback recording mode is intentionally conservative. Natural
        // pauses are common in a reflective conversation; the user can tap
        // the orb to send immediately when they are actually finished.
        now - lastSpeechAt >= 2200 && now - speechStartedAt >= 900
      ) {
        stopSilenceDetection(frameRef);
        onSilence();
        return;
      }
    }

    frameRef.current = requestAnimationFrame(tick);
  };

  frameRef.current = requestAnimationFrame(tick);
}

function playDeviceSpeech(text, agentName, speechRef) {
  return new Promise((resolve) => {
    if (!text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis
      .getVoices()
      .filter((voice) => !voice.lang || voice.lang.toLowerCase().startsWith("en"));
    if (voices.length) {
      const nameSeed = [...agentName].reduce((total, char) => total + char.charCodeAt(0), 0);
      utterance.voice = voices[nameSeed % voices.length];
    }
    utterance.rate = 0.94;
    utterance.pitch = 1;
    let settled = false;
    const fallbackTimer = window.setTimeout(
      () => finish(),
      Math.min(30_000, Math.max(4_000, text.length * 90))
    );
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      if (speechRef.current === utterance) speechRef.current = null;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  });
}

export function SummaryCard({ entry, onReset }) {
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

export function CrisisCard({ onContinue }) {
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
