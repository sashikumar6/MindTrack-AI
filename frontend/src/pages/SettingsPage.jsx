import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Mail,
  Monitor,
  Pause,
  Play,
  UserRound,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { fetchVoicePreview } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.jsx";
import { companionNameForPersona } from "../lib/companions.js";

const CONVERSATION_MODES = [
  { id: "advice", label: "Advice" },
  { id: "just_listen", label: "Just Listen" },
  { id: "soothe", label: "Soothe Me" },
  { id: "motivation", label: "Motivation" },
  { id: "action_plan", label: "Action Plan" },
];

const PERSONAS = [
  {
    id: "empathetic",
    name: "Empathetic",
    description: "A gentle listener who validates your feelings.",
    traits: ["Warm", "Patient", "Kind"],
    quote: "I hear how much weight you're carrying right now. I'm here with you.",
    gradient: "linear-gradient(140deg, #00f2fe 0%, #4facfe 52%, #7028e4 100%)",
  },
  {
    id: "compassionate",
    name: "Compassionate",
    description: "A caring presence that responds with tenderness.",
    traits: ["Caring", "Gentle", "Supportive"],
    quote: "You deserve patience here. We can take this as slowly as you need.",
    gradient: "linear-gradient(140deg, #ff9a9e 0%, #fecfef 50%, #a18cd1 100%)",
  },
  {
    id: "logical",
    name: "Stoic",
    description: "A logical and calm presence for clear thinking.",
    traits: ["Clear", "Steady", "Rational"],
    quote: "Let's separate what you know, what you feel, and what you can control.",
    gradient: "linear-gradient(140deg, #8e9eab 0%, #52616b 52%, #2b3a42 100%)",
  },
  {
    id: "playful",
    name: "Playful",
    description: "Lighthearted and witty when you need a lift.",
    traits: ["Bright", "Witty", "Easygoing"],
    quote: "That was a lot for one day. Your brain has definitely earned a softer landing.",
    gradient: "linear-gradient(140deg, #f6d365 0%, #fda085 52%, #ff6b9d 100%)",
  },
  {
    id: "motivational",
    name: "Motivational",
    description: "An encouraging voice that helps you find momentum.",
    traits: ["Positive", "Focused", "Energizing"],
    quote: "You've already started by showing up. Let's choose one next move you can own.",
    gradient: "linear-gradient(140deg, #fddb92 0%, #d1fdff 48%, #4facfe 100%)",
  },
  {
    id: "direct",
    name: "Direct",
    description: "Honest, concise guidance without the extra padding.",
    traits: ["Candid", "Practical", "Focused"],
    quote: "Here's the clearest next step based on what you've told me.",
    gradient: "linear-gradient(140deg, #30cfd0 0%, #330867 100%)",
  },
  {
    id: "strict",
    name: "Strict Coach",
    description: "Firm accountability delivered with respect.",
    traits: ["Firm", "Disciplined", "Honest"],
    quote: "You know what matters today. Let's make the commitment small and non-negotiable.",
    gradient: "linear-gradient(140deg, #f83600 0%, #f9d423 100%)",
  },
  {
    id: "calm",
    name: "Calm Guide",
    description: "A grounded voice for slower, steadier moments.",
    traits: ["Grounded", "Soft", "Patient"],
    quote: "Nothing has to be solved all at once. Let's begin with this moment.",
    gradient: "linear-gradient(140deg, #43e97b 0%, #38f9d7 52%, #4facfe 100%)",
  },
];

const VOICES = [
  { id: "marin", name: "Ava", gender: "feminine", style: "Soft" },
  { id: "cedar", name: "Julian", gender: "masculine", style: "Deep" },
  { id: "sage", name: "Terra", gender: "neutral", style: "Warm" },
  { id: "coral", name: "Aria", gender: "feminine", style: "Bright" },
  { id: "shimmer", name: "Nora", gender: "feminine", style: "Light" },
  { id: "verse", name: "Maya", gender: "feminine", style: "Expressive" },
  { id: "ash", name: "Noah", gender: "masculine", style: "Grounded" },
  { id: "echo", name: "Rowan", gender: "masculine", style: "Clear" },
  { id: "alloy", name: "Sage", gender: "neutral", style: "Balanced" },
  { id: "ballad", name: "Leo", gender: "masculine", style: "Smooth" },
];

const FILTERS = ["all", "feminine", "masculine", "neutral"];

const DEVICE_VOICE_PROFILES = {
  marin: { rate: 0.92, pitch: 1.08 },
  cedar: { rate: 0.88, pitch: 0.84 },
  sage: { rate: 0.9, pitch: 1 },
  coral: { rate: 1.02, pitch: 1.12 },
  shimmer: { rate: 0.98, pitch: 1.18 },
  verse: { rate: 0.94, pitch: 1.06 },
  ash: { rate: 0.9, pitch: 0.88 },
  echo: { rate: 0.96, pitch: 0.92 },
  alloy: { rate: 1, pitch: 1 },
  ballad: { rate: 0.86, pitch: 0.9 },
};

const PREVIEW_USER = {
  name: "Jordan Silva",
  email: "jordan@example.com",
  picture_url: null,
  persona_mode: "empathetic",
  conversation_mode: "just_listen",
  tts_voice: "marin",
  tts_provider: "openai",
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dailyReminder, setDailyReminder] = useState(() => storedBoolean("mindtrack.dailyReminder", true));
  const [reduceMotion, setReduceMotion] = useState(() => storedBoolean("mindtrack.reduceMotion", false));
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    localStorage.setItem("mindtrack.reduceMotion", String(reduceMotion));
  }, [reduceMotion]);

  useEffect(() => {
    localStorage.setItem("mindtrack.dailyReminder", String(dailyReminder));
  }, [dailyReminder]);

  if (!user) return null;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate("/login");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="basic-settings-page">
      <div className="page-intro settings-intro">
        <h1>Settings</h1>
        <p>Account, connections, and basic app preferences.</p>
      </div>

      <section className="surface basic-account-card">
        <div className="basic-account-profile">
          {user.picture_url ? (
            <img src={user.picture_url} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span><UserRound size={24} /></span>
          )}
          <div><strong>{user.name}</strong><p>{user.email}</p></div>
        </div>
        <button type="button" onClick={signOut} disabled={signingOut}>
          <LogOut size={16} /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>

      <section className="basic-settings-group" aria-labelledby="preferences-heading">
        <h2 id="preferences-heading">Preferences</h2>
        <SettingRow
          icon={<Bell size={18} />}
          title="Daily check-in reminder"
          description="Show a gentle reminder inside MindTrack each day."
          enabled={dailyReminder}
          onToggle={() => setDailyReminder((enabled) => !enabled)}
        />
        <SettingRow
          icon={<Monitor size={18} />}
          title="Reduce motion"
          description="Minimize animated orbs, transitions, and moving indicators."
          enabled={reduceMotion}
          onToggle={() => setReduceMotion((enabled) => !enabled)}
        />
      </section>

      <section className="basic-settings-group" aria-labelledby="connections-heading">
        <h2 id="connections-heading">Connections</h2>
        <div className="basic-setting-row connection-row">
          <span className="basic-setting-icon"><Mail size={18} /></span>
          <div><strong>Google &amp; Gmail</strong><p>Used for sign-in and job-application tracking.</p></div>
          <Link to="/jobs">Connected</Link>
        </div>
      </section>

      <p className="settings-safety-note">
        MindTrack is a wellness demo, not medical advice or crisis support. In the U.S., call or text 988 for immediate emotional support.
      </p>
    </div>
  );
}

export function CompanionCustomizer({ preview = false, onStartCheckin }) {
  const auth = useAuth();
  const [previewUser, setPreviewUser] = useState(PREVIEW_USER);
  const user = preview ? previewUser : auth.user;
  const updatePreferences = preview
    ? async (patch) => {
        const updated = { ...previewUser, ...patch };
        setPreviewUser(updated);
        return updated;
      }
    : auth.updatePreferences;
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => preferenceDraft(user));
  const [voiceFilter, setVoiceFilter] = useState("all");
  const [voiceCarouselId, setVoiceCarouselId] = useState(() => user?.tts_voice || "marin");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [playingVoice, setPlayingVoice] = useState(null);
  const [loadingVoice, setLoadingVoice] = useState(null);
  const audioRef = useRef(null);
  const speechRef = useRef(null);
  const previewUrlsRef = useRef(new Map());

  useEffect(() => {
    setDraft(preferenceDraft(user));
    setVoiceCarouselId(user?.tts_voice || "marin");
  }, [user]);

  useEffect(
    () => () => {
      stopVoicePreview(audioRef, speechRef);
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  if (!user) return null;

  const selectedPersona = PERSONAS.find((persona) => persona.id === draft.persona) || PERSONAS[0];
  const selectedMode = CONVERSATION_MODES.find((mode) => mode.id === draft.mode) || CONVERSATION_MODES[1];
  const selectedCompanionName = companionNameForPersona(selectedPersona.id);
  const personaIndex = PERSONAS.findIndex((persona) => persona.id === selectedPersona.id);
  const personaCards = carouselWindow(PERSONAS, personaIndex);
  const filteredVoices = VOICES.filter((voice) => voiceFilter === "all" || voice.gender === voiceFilter);
  const carouselVoiceIndex = filteredVoices.findIndex((voice) => voice.id === voiceCarouselId);
  const selectedVoiceIndex = filteredVoices.findIndex((voice) => voice.id === draft.voice);
  const filteredVoiceIndex = Math.max(0, carouselVoiceIndex >= 0 ? carouselVoiceIndex : selectedVoiceIndex);
  const visibleVoices = carouselWindow(filteredVoices, filteredVoiceIndex);
  const dirty =
    draft.persona !== user.persona_mode ||
    draft.mode !== (user.conversation_mode || "just_listen") ||
    draft.voice !== user.tts_voice;

  const choosePersona = (id) => {
    setDraft((current) => ({ ...current, persona: id }));
    setSaved(false);
  };

  const cyclePersona = (direction) => {
    const nextIndex = wrapIndex(personaIndex + direction, PERSONAS.length);
    choosePersona(PERSONAS[nextIndex].id);
  };

  const chooseVoice = (id) => {
    setDraft((current) => ({ ...current, voice: id }));
    setSaved(false);
  };

  const cycleVoice = (direction) => {
    if (!filteredVoices.length) return;
    const nextIndex = wrapIndex(filteredVoiceIndex + direction, filteredVoices.length);
    setVoiceCarouselId(filteredVoices[nextIndex].id);
  };

  const chooseVoiceFilter = (filter) => {
    const candidates = VOICES.filter((voice) => filter === "all" || voice.gender === filter);
    const selected = candidates.find((voice) => voice.id === draft.voice);
    setVoiceFilter(filter);
    setVoiceCarouselId(selected?.id || candidates[0]?.id || draft.voice);
  };

  const previewVoice = async (voiceId) => {
    setError(null);
    if (playingVoice === voiceId) {
      stopVoicePreview(audioRef, speechRef);
      setPlayingVoice(null);
      return;
    }
    stopVoicePreview(audioRef, speechRef);
    setPlayingVoice(null);
    setLoadingVoice(voiceId);
    try {
      let url = previewUrlsRef.current.get(voiceId);
      if (!url) {
        const blob = await fetchVoicePreview(voiceId);
        url = URL.createObjectURL(blob);
        previewUrlsRef.current.set(voiceId, url);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingVoice(null);
      audio.onerror = () => {
        setPlayingVoice(null);
        setError("That voice preview couldn't be played.");
      };
      await audio.play();
      setPlayingVoice(voiceId);
    } catch (cloudPreviewError) {
      try {
        const voice = VOICES.find((candidate) => candidate.id === voiceId) || VOICES[0];
        speechRef.current = playDeviceVoice(
          voice,
          () => setPlayingVoice(null),
          () => {
            setPlayingVoice(null);
            setError("That voice preview couldn't be played on this device.");
          }
        );
        setPlayingVoice(voiceId);
      } catch (devicePreviewError) {
        setError(
          devicePreviewError.message ||
            cloudPreviewError.message ||
            "Voice preview is temporarily unavailable."
        );
      }
    } finally {
      setLoadingVoice(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({
        persona_mode: draft.persona,
        conversation_mode: draft.mode,
        tts_voice: draft.voice,
      });
      setSaved(true);
      return true;
    } catch (saveError) {
      setError(saveError?.response?.data?.detail || saveError.message || "Failed to save preferences");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startCheckin = async () => {
    if (dirty && !(await save())) return;
    if (onStartCheckin) onStartCheckin();
    else navigate("/voice");
  };

  return (
    <div className="companion-customizer">
      <div className="companion-settings-main companion-settings-main-embedded">
        <section className="companion-summary">
          <div>
            <i />
            <span>Current Companion: <strong>{selectedCompanionName} · {selectedPersona.name} · {selectedMode.label}</strong></span>
          </div>
          <span>{dirty ? "Ready to save" : "Active sanctuary"}</span>
        </section>

        <section className="companion-section conversation-mode-section">
          <SectionHeading
            title="Conversation Mode"
            description="How should your companion interact with you today?"
          />
          <div className="conversation-mode-pills">
            {CONVERSATION_MODES.map((mode) => (
              <button
                type="button"
                key={mode.id}
                className={draft.mode === mode.id ? "active" : ""}
                aria-pressed={draft.mode === mode.id}
                onClick={() => {
                  setDraft((current) => ({ ...current, mode: mode.id }));
                  setSaved(false);
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        <section className="companion-section personality-section">
          <div className="companion-section-row">
            <SectionHeading
              title="AI Personality"
              description="Choose the emotional frequency that resonates with you."
            />
            <CarouselControls label="personality" onPrevious={() => cyclePersona(-1)} onNext={() => cyclePersona(1)} />
          </div>
          <div className="personality-carousel" aria-live="polite">
            {personaCards.map(({ item, position }) => (
              <button
                type="button"
                key={item.id}
                onClick={() => choosePersona(item.id)}
                className={`personality-card ${position}`}
                aria-pressed={position === "active"}
              >
                <div className="persona-orb" style={{ background: item.gradient }}><i /></div>
                <span className="persona-companion-name">{companionNameForPersona(item.id)}</span>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                {position === "active" ? (
                  <>
                    <div className="persona-traits">
                      {item.traits.map((trait) => <span key={trait}>{trait}</span>)}
                    </div>
                    <blockquote>“{item.quote}”</blockquote>
                  </>
                ) : null}
              </button>
            ))}
          </div>
          <div className="carousel-dots" aria-hidden="true">
            {PERSONAS.map((persona) => <i key={persona.id} className={persona.id === draft.persona ? "active" : ""} />)}
          </div>
        </section>

        <section className="companion-section voice-section">
          <div className="voice-section-heading">
            <SectionHeading title="AI Voice" description="Select a voice that feels comfortable for conversation." />
            <div className="voice-heading-actions">
              <div className="voice-filters" aria-label="Filter voices">
                {FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter}
                    className={voiceFilter === filter ? "active" : ""}
                    aria-pressed={voiceFilter === filter}
                    onClick={() => chooseVoiceFilter(filter)}
                  >
                    {capitalize(filter)}
                  </button>
                ))}
              </div>
              <CarouselControls label="voice" onPrevious={() => cycleVoice(-1)} onNext={() => cycleVoice(1)} />
            </div>
          </div>

          <div className="voice-card-grid" role="radiogroup" aria-label="Choose an AI voice">
            {visibleVoices.map(({ item: voice }) => {
              const active = draft.voice === voice.id;
              const playing = playingVoice === voice.id;
              const loading = loadingVoice === voice.id;
              return (
                <article
                  key={voice.id}
                  className={`voice-choice-card${active ? " active" : ""}`}
                  role="radio"
                  aria-checked={active}
                  tabIndex={0}
                  onClick={() => chooseVoice(voice.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseVoice(voice.id);
                    }
                  }}
                >
                  <div className="voice-card-top">
                    <div>
                      <h3>{voice.name}</h3>
                      <span>{capitalize(voice.gender)} · {voice.style}</span>
                    </div>
                    <button
                      type="button"
                      className="voice-preview-button"
                      aria-label={`${playing ? "Pause" : "Preview"} ${voice.name} voice`}
                      onClick={(event) => {
                        event.stopPropagation();
                        previewVoice(voice.id);
                      }}
                      disabled={loading}
                    >
                      {loading ? <i className="preview-spinner" /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                    </button>
                  </div>
                  <div className={`voice-bars${playing ? " playing" : ""}`} aria-hidden="true">
                    {Array.from({ length: 10 }).map((_, index) => <i key={index} style={{ animationDelay: `${index * 70}ms` }} />)}
                  </div>
                  <div className="voice-progress"><i className={playing ? "playing" : ""} /></div>
                  {active ? <span className="voice-selected"><Check size={13} /> Selected</span> : null}
                </article>
              );
            })}
          </div>
        </section>

        {error ? <div className="companion-error">{error}</div> : null}
      </div>

      <footer className="companion-action-bar embedded">
        <div>
          <div className="draft-status">
            <strong>{saved ? "Preferences saved" : dirty ? "Unsaved changes" : "Draft saved"}</strong>
            <span>{saved ? "Your companion has been updated." : dirty ? "Your choices are ready to save." : "All modifications are synced."}</span>
          </div>
          <div className="companion-actions">
            <button type="button" className="start-checkin-button" onClick={startCheckin}>Start a Check-in</button>
            <button type="button" className="save-preferences-button" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : saved ? "Saved" : "Save Preferences"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SettingRow({ icon, title, description, enabled, onToggle }) {
  return (
    <div className="basic-setting-row">
      <span className="basic-setting-icon">{icon}</span>
      <div><strong>{title}</strong><p>{description}</p></div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${title}: ${enabled ? "on" : "off"}`}
        className={`settings-toggle${enabled ? " on" : ""}`}
        onClick={onToggle}
      >
        <i />
      </button>
    </div>
  );
}

function storedBoolean(key, fallback) {
  const value = localStorage.getItem(key);
  return value == null ? fallback : value === "true";
}

function SectionHeading({ title, description }) {
  return <div className="companion-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function CarouselControls({ label, onPrevious, onNext }) {
  return (
    <div className="carousel-controls">
      <button type="button" aria-label={`Previous ${label}`} onClick={onPrevious}><ChevronLeft size={22} /></button>
      <button type="button" aria-label={`Next ${label}`} onClick={onNext}><ChevronRight size={22} /></button>
    </div>
  );
}

function preferenceDraft(user) {
  return {
    persona: user?.persona_mode || "empathetic",
    mode: user?.conversation_mode || "just_listen",
    voice: user?.tts_voice || "marin",
  };
}

function carouselWindow(items, activeIndex) {
  if (!items.length) return [];
  if (items.length <= 3) {
    return items.map((item, index) => ({
      item,
      position: index === activeIndex ? "active" : index < activeIndex ? "previous" : "next",
    }));
  }
  return [
    { item: items[wrapIndex(activeIndex - 1, items.length)], position: "previous" },
    { item: items[activeIndex], position: "active" },
    { item: items[wrapIndex(activeIndex + 1, items.length)], position: "next" },
  ];
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stopVoicePreview(audioRef, speechRef) {
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = null;
  }
  if (speechRef.current) {
    speechRef.current.onend = null;
    speechRef.current.onerror = null;
    window.speechSynthesis?.cancel();
    speechRef.current = null;
  }
}

function playDeviceVoice(voice, onEnd, onError) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    throw new Error("Voice previews are not supported by this browser.");
  }

  const utterance = new SpeechSynthesisUtterance(voicePreviewText(voice.name));
  const profile = DEVICE_VOICE_PROFILES[voice.id] || DEVICE_VOICE_PROFILES.alloy;
  const availableVoices = window.speechSynthesis.getVoices();
  const deviceVoice = chooseDeviceVoice(availableVoices, voice.gender, voice.id);
  if (deviceVoice) utterance.voice = deviceVoice;
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  utterance.onend = onEnd;
  utterance.onerror = onError;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function voicePreviewText(name) {
  return `Hi, I'm ${name}. Take your time and tell me how today has been feeling.`;
}

function chooseDeviceVoice(voices, gender, voiceId) {
  const englishVoices = voices.filter((voice) => !voice.lang || voice.lang.toLowerCase().startsWith("en"));
  const candidates = englishVoices.length ? englishVoices : voices;
  if (!candidates.length) return null;

  const genderHints = {
    feminine: ["samantha", "victoria", "karen", "moira", "tessa", "ava", "female", "zira", "susan"],
    masculine: ["daniel", "alex", "fred", "ralph", "david", "male", "mark", "thomas"],
    neutral: ["jordan", "river", "casey", "neutral", "serena", "jamie"],
  };
  const hints = genderHints[gender] || [];
  const matchingVoices = candidates.filter((candidate) =>
    hints.some((hint) => candidate.name.toLowerCase().includes(hint))
  );
  const pool = matchingVoices.length ? matchingVoices : candidates;
  const index = Math.max(0, VOICES.findIndex((candidate) => candidate.id === voiceId));
  return pool[index % pool.length];
}
