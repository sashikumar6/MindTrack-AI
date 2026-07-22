// Per-turn "emotional energy" read from the conversation agent (see the
// "vibe" WS message in VoiceSession.jsx) -- purely a live-UI signal, never
// persisted. Maps to the app's existing CSS custom properties, no new
// color tokens needed.
export const DEFAULT_VIBE = "calm";

export const VIBE_STYLES = {
  calm: { color: "var(--mood-color)", intensity: 0.7 },
  warm: { color: "var(--mood-color)", intensity: 1.0 },
  energized: { color: "var(--energy-color)", intensity: 1.3 },
  tense: { color: "var(--anxiety-color)", intensity: 1.3 },
  low: { color: "var(--text-secondary)", intensity: 0.5 },
};
