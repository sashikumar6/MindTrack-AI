import { useCallback, useEffect, useRef, useState } from "react";
import VoiceSession, { CrisisCard, SummaryCard } from "./VoiceSession.jsx";
import VoiceWaveform from "./VoiceWaveform.jsx";
import {
  checkRealtimeSafety,
  createRealtimeCall,
  finalizeRealtimeCheckin,
  reportVoiceLatency,
} from "../lib/api.js";
import { companionNameForPersona } from "../lib/companions.js";

const MAX_VISIBLE_TURNS = 4;
const CONNECTION_TIMEOUT_MS = 20_000;

const ORB_STYLE = {
  idle: {
    gradient: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 3.4s ease-in-out infinite",
    glow: "0 0 60px rgba(77,163,255,0.35)",
  },
  connecting: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 1.2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
  },
  listening: {
    gradient: "radial-gradient(circle at 35% 30%, #9ccaff, #4da3ff 45%, #34d399 100%)",
    animation: "breathe 1.1s ease-in-out infinite",
    glow: "0 0 90px rgba(77,163,255,0.6)",
  },
  thinking: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 1.2s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.55)",
  },
  speaking: {
    gradient: "radial-gradient(circle at 35% 30%, #6ee7b7, #34d399 45%, #4da3ff 100%)",
    animation: "breathe 0.7s ease-in-out infinite alternate",
    glow: "0 0 90px rgba(52,211,153,0.6)",
  },
  ending: {
    gradient: "conic-gradient(from 0deg, #4da3ff, #a78bfa, #34d399, #4da3ff)",
    animation: "spin 1.5s linear infinite",
    glow: "0 0 70px rgba(167,139,250,0.45)",
  },
};

function upsertTurn(turns, id, role, text, append = false) {
  const content = String(text || "");
  const index = turns.findIndex((turn) => turn.id === id);
  if (index === -1) return [...turns, { id, role, content }];
  const next = [...turns];
  next[index] = {
    ...next[index],
    content: append ? `${next[index].content}${content}` : content,
  };
  return next;
}

function cleanTranscript(turns) {
  return turns
    .filter((turn) => (turn.role === "user" || turn.role === "agent") && turn.content.trim())
    .map(({ role, content }) => ({ role, content: content.trim() }));
}

export default function RealtimeVoiceSession({
  onComplete,
  personaMode = "empathetic",
}) {
  const agentName = companionNameForPersona(personaMode);
  const [state, setState] = useState("idle");
  const [connectionState, setConnectionState] = useState("prewarming");
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [recordingAnalyser, setRecordingAnalyser] = useState(null);
  const [playbackAnalyser, setPlaybackAnalyser] = useState(null);
  const [useFallback, setUseFallback] = useState(
    () => typeof RTCPeerConnection === "undefined"
  );

  const peerRef = useRef(null);
  const channelRef = useRef(null);
  const micStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const connectionPromiseRef = useRef(null);
  const startedRef = useRef(false);
  const openerPendingRef = useRef(false);
  const openerTimerRef = useRef(null);
  const turnsRef = useRef([]);
  const speechStoppedAtRef = useRef(null);
  const firstAudioSeenRef = useRef(false);
  const activeResponseRef = useRef(null);
  const eventHandlerRef = useRef(null);

  const updateTurns = useCallback((updater) => {
    setTurns((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      turnsRef.current = next;
      return next;
    });
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => { });
    }
    return audioCtxRef.current;
  }, []);

  const sendEvent = useCallback((event) => {
    const channel = channelRef.current;
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  const closeTransport = useCallback(() => {
    if (openerTimerRef.current) {
      window.clearTimeout(openerTimerRef.current);
      openerTimerRef.current = null;
    }
    connectionPromiseRef.current = null;
    startedRef.current = false;
    openerPendingRef.current = false;
    speechStoppedAtRef.current = null;
    firstAudioSeenRef.current = false;
    activeResponseRef.current = null;
    if (channelRef.current) {
      try {
        channelRef.current.close();
      } catch {
        // Already closed.
      }
      channelRef.current = null;
    }
    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch {
        // Already closed.
      }
      peerRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    setRecordingAnalyser(null);
    setPlaybackAnalyser(null);
  }, []);

  const finalizeTurns = useCallback(
    async (transcript, showSummary = true) => {
      if (!transcript.some((turn) => turn.role === "user")) return null;
      const payload = await finalizeRealtimeCheckin(transcript);
      if (showSummary) {
        if (payload.safety_event) {
          setState("crisis");
        } else {
          setResult(payload.mood_entry);
          setState("done");
          onComplete?.(payload.mood_entry);
        }
      }
      return payload;
    },
    [onComplete]
  );

  const triggerCrisis = useCallback(() => {
    if (state === "crisis") return;
    sendEvent({ type: "response.cancel" });
    if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
    const transcript = cleanTranscript(turnsRef.current);
    closeTransport();
    setState("crisis");
    finalizeTurns(transcript, false).catch(() => { });
  }, [closeTransport, finalizeTurns, sendEvent, state]);

  const checkSafety = useCallback(
    async (text) => {
      try {
        const safety = await checkRealtimeSafety(text);
        if (safety.safety_event) triggerCrisis();
      } catch {
        // The Realtime system prompt still owns the fail-safe response if
        // this parallel deterministic check is temporarily unavailable.
      }
    },
    [triggerCrisis]
  );

  const enableListening = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = true;
    openerPendingRef.current = false;
    setState("listening");
  }, []);

  eventHandlerRef.current = (event) => {
    switch (event.type) {
      case "session.created":
      case "session.updated":
        setConnectionState("ready");
        break;

      case "input_audio_buffer.speech_started":
        if (!startedRef.current) break;
        setState("listening");
        break;

      case "input_audio_buffer.speech_stopped":
        if (!startedRef.current) break;
        speechStoppedAtRef.current = performance.now();
        firstAudioSeenRef.current = false;
        setState("thinking");
        break;

      case "conversation.item.input_audio_transcription.delta": {
        const id = `user-${event.item_id || "active"}`;
        updateTurns((previous) =>
          upsertTurn(previous, id, "user", event.delta, true)
        );
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const text = String(event.transcript || "").trim();
        const id = `user-${event.item_id || "active"}`;
        if (text) {
          updateTurns((previous) => upsertTurn(previous, id, "user", text));
          checkSafety(text);
        }
        break;
      }

      case "response.created":
        activeResponseRef.current = event.response?.id || `response-${Date.now()}`;
        if (startedRef.current) setState("thinking");
        break;

      case "response.output_audio.delta":
        if (
          speechStoppedAtRef.current != null &&
          !firstAudioSeenRef.current &&
          !openerPendingRef.current
        ) {
          firstAudioSeenRef.current = true;
          const ttfaMs = performance.now() - speechStoppedAtRef.current;
          reportVoiceLatency("realtime_ttfa", ttfaMs);
        }
        if (startedRef.current) setState("speaking");
        break;

      case "response.output_audio_transcript.delta": {
        const id = `agent-${event.item_id || activeResponseRef.current || "active"}`;
        updateTurns((previous) =>
          upsertTurn(previous, id, "agent", event.delta, true)
        );
        if (startedRef.current) setState("speaking");
        break;
      }

      case "response.output_audio_transcript.done": {
        const text = String(event.transcript || "").trim();
        const id = `agent-${event.item_id || activeResponseRef.current || "active"}`;
        if (text) {
          updateTurns((previous) => upsertTurn(previous, id, "agent", text));
        }
        break;
      }

      case "response.done":
        if (openerPendingRef.current) {
          enableListening();
        } else if (startedRef.current && state !== "crisis") {
          setState("listening");
        }
        break;

      case "output_audio_buffer.stopped":
        if (startedRef.current && !openerPendingRef.current) setState("listening");
        break;

      case "error":
        setError(event.error?.message || "Realtime voice encountered an error.");
        if (startedRef.current) setState("listening");
        break;

      default:
        break;
    }
  };

  const activateSession = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    openerPendingRef.current = true;
    setError(null);
    setState("speaking");
    ensureAudioContext();
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => { });
    }
    const sent = sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `Introduce yourself as ${agentName} in one short sentence, then ask how the user's day is feeling. Do not call yourself MindTrack AI.`,
      },
    });
    if (!sent) {
      setError("The realtime connection was not ready. Please try again.");
      setState("idle");
      startedRef.current = false;
      openerPendingRef.current = false;
      return;
    }
    openerTimerRef.current = window.setTimeout(enableListening, 10_000);
  }, [agentName, enableListening, ensureAudioContext, sendEvent]);

  const connect = useCallback(
    async (activateAfter = false) => {
      if (channelRef.current?.readyState === "open") {
        if (activateAfter) activateSession();
        return;
      }
      if (connectionPromiseRef.current) {
        await connectionPromiseRef.current;
        if (activateAfter) activateSession();
        return;
      }
      if (
        typeof RTCPeerConnection === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setUseFallback(true);
        return;
      }

      const promise = (async () => {
        if (activateAfter) setState("connecting");
        setConnectionState("prewarming");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        micStreamRef.current = stream;
        const micTrack = stream.getAudioTracks()[0];
        micTrack.enabled = false;

        const context = ensureAudioContext();
        if (context) {
          try {
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 128;
            source.connect(analyser);
            setRecordingAnalyser(analyser);
          } catch {
            // Realtime audio still works if visual analysis is unavailable.
          }
        }

        const peer = new RTCPeerConnection();
        peerRef.current = peer;
        peer.addTrack(micTrack, stream);

        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = true;
        remoteAudioRef.current = audio;
        peer.ontrack = (event) => {
          const remoteStream = event.streams[0];
          audio.srcObject = remoteStream;
          if (context) {
            try {
              const source = context.createMediaStreamSource(remoteStream);
              const analyser = context.createAnalyser();
              analyser.fftSize = 128;
              source.connect(analyser);
              setPlaybackAnalyser(analyser);
            } catch {
              // Playback is handled by the media element.
            }
          }
          if (startedRef.current) audio.play().catch(() => { });
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "failed") {
            setError("Realtime connection failed. Switching to standard mode.");
            closeTransport();
            setUseFallback(true);
          }
        };

        const channel = peer.createDataChannel("oai-events");
        channelRef.current = channel;
        channel.onmessage = (message) => {
          try {
            eventHandlerRef.current?.(JSON.parse(message.data));
          } catch {
            // Ignore malformed provider events.
          }
        };
        const channelReady = new Promise((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error("Realtime connection timed out")),
            CONNECTION_TIMEOUT_MS
          );
          channel.onopen = () => {
            window.clearTimeout(timer);
            resolve();
          };
          channel.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("Realtime data channel failed"));
          };
        });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const answerSdp = await createRealtimeCall(offer.sdp);
        await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
        await channelReady;
        setConnectionState("ready");
      })();

      connectionPromiseRef.current = promise;
      try {
        await promise;
        if (activateAfter) activateSession();
      } catch (connectionError) {
        closeTransport();
        if (connectionError?.name === "NotAllowedError") {
          setConnectionState("permission-needed");
          setError("Microphone permission is required for a realtime conversation.");
          setState("idle");
        } else {
          setError("Realtime is unavailable. Using the standard voice path.");
          setUseFallback(true);
        }
      } finally {
        connectionPromiseRef.current = null;
      }
    },
    [activateSession, closeTransport, ensureAudioContext]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => connect(false), 80);
    return () => {
      window.clearTimeout(timer);
      closeTransport();
    };
  }, [closeTransport, connect]);

  const endSession = async () => {
    const transcript = cleanTranscript(turnsRef.current);
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = false;
    setState("ending");
    closeTransport();
    if (!transcript.some((turn) => turn.role === "user")) {
      setState("idle");
      setConnectionState("prewarming");
      connect(false);
      return;
    }
    try {
      await finalizeTurns(transcript, true);
    } catch (finalizeError) {
      setError(
        finalizeError?.response?.data?.detail ||
        "The conversation ended, but the check-in summary could not be saved."
      );
      setState("idle");
    }
  };

  const submitText = async () => {
    const text = draft.trim();
    if (!text || !startedRef.current) return;
    setDraft("");
    try {
      const safety = await checkRealtimeSafety(text);
      if (safety.safety_event) {
        updateTurns((previous) =>
          upsertTurn(previous, `typed-${Date.now()}`, "user", text)
        );
        triggerCrisis();
        return;
      }
    } catch {
      // The session prompt remains the fallback safety layer.
    }
    updateTurns((previous) =>
      upsertTurn(previous, `typed-${Date.now()}`, "user", text)
    );
    speechStoppedAtRef.current = performance.now();
    firstAudioSeenRef.current = false;
    setState("thinking");
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    sendEvent({ type: "response.create" });
  };

  const reset = () => {
    closeTransport();
    turnsRef.current = [];
    setTurns([]);
    setResult(null);
    setLatency(null);
    setError(null);
    setState("idle");
    setConnectionState("prewarming");
    window.setTimeout(() => connect(false), 80);
  };

  if (useFallback) {
    return (
      <div>
        <div className="realtime-fallback-note">
          Standard voice mode active — Realtime WebRTC was unavailable.
        </div>
        <VoiceSession onComplete={onComplete} personaMode={personaMode} />
      </div>
    );
  }

  if (state === "crisis") return <CrisisCard onContinue={reset} />;
  if (state === "done") return <SummaryCard entry={result} onReset={reset} />;

  const visualState = ORB_STYLE[state] ? state : "idle";
  const style = ORB_STYLE[visualState];
  const isActive = ["listening", "thinking", "speaking", "ending"].includes(state);
  const label =
    state === "connecting"
      ? `Connecting to ${agentName}…`
      : state === "listening"
        ? "Listening — speak naturally"
        : state === "thinking"
          ? `${agentName} heard you…`
          : state === "speaking"
            ? `${agentName} is speaking…`
            : state === "ending"
              ? "Saving your check-in…"
              : connectionState === "ready"
                ? `Tap to start with ${agentName} · realtime ready`
                : connectionState === "permission-needed"
                  ? "Tap to allow microphone"
                  : `Preparing ${agentName}…`;

  return (
    <div className="voice-session realtime-voice-session">
      <div className="voice-orb-wrap">
        <button
          type="button"
          aria-label={label}
          onClick={state === "idle" ? () => connect(true) : undefined}
          disabled={state !== "idle"}
          className="voice-orb"
          style={{
            background: style.gradient,
            animation: style.animation,
            boxShadow: style.glow,
            cursor: state === "idle" ? "pointer" : "default",
          }}
        />
        <div className="voice-orb-label">{label}</div>
      </div>

      {state === "listening" ? (
        <div className="voice-waveform-wrap">
          <VoiceWaveform
            analyser={recordingAnalyser}
            active
            color="var(--mood-color)"
            intensity={0.9}
            barCount={12}
          />
        </div>
      ) : state === "speaking" ? (
        <div className="voice-waveform-wrap">
          <VoiceWaveform
            analyser={playbackAnalyser}
            active={!!playbackAnalyser}
            color="var(--energy-color)"
            intensity={1}
            barCount={12}
          />
        </div>
      ) : null}

      {turns.length ? (
        <div className="voice-captions" aria-live="polite">
          {turns.slice(-MAX_VISIBLE_TURNS).map((turn) => (
            <div
              key={turn.id}
              className={`voice-caption ${turn.role === "user" ? "user" : "agent"}`}
            >
              {turn.content}
            </div>
          ))}
        </div>
      ) : null}

      {isActive && state !== "ending" ? (
        <>
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
              <button onClick={submitText} disabled={!draft.trim()}>
                Send
              </button>
            </div>
          </details>
          <button type="button" className="realtime-end-button" onClick={endSession}>
            End check-in
          </button>
        </>
      ) : null}

      {error ? <div className="voice-error">{error}</div> : null}
    </div>
  );
}
