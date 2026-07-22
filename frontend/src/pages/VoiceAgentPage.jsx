import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppShell.jsx";
import VoiceSession from "../components/VoiceSession.jsx";
import { useAuth } from "../lib/AuthContext.jsx";
import { companionForPersona } from "../lib/companions.js";

export default function VoiceAgentPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="voice-route-loading">Loading your companion…</div>;
  }

  if (user) {
    const companion = companionForPersona(user.persona_mode);
    return (
      <div className="app-shell voice-agent-shell">
        <AppHeader />
        <main className="app-main voice-agent-main">
          <div className="page-intro voice-agent-intro">
            <div>
              <div className="page-eyebrow">Your personal space</div>
              <h1>Talk It Out</h1>
              <p>A private space to check in, think aloud, or simply let the day out.</p>
            </div>
            <div className="active-companion-pill">
              <i style={{ background: companion.gradient }} />
              <span><small>Active companion</small><strong>{companion.name} · {companion.label}</strong></span>
            </div>
          </div>
        </main>

        <section className="voice-conversation-panel">
          <div className="voice-page-glow" />
          <div className="voice-stage voice-stage-embedded">
            <VoiceSession onComplete={() => {}} personaMode={user.persona_mode} />
          </div>
          <footer className="voice-page-footer">
            <p className="voice-disclaimer">
              Demo only — not medical advice or crisis support. In the U.S., call or text 988 for immediate emotional support.
            </p>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <main className="voice-page">
      <div className="voice-page-glow" />
      <div className="anonymous-banner">
        You're checking in anonymously — nothing is saved this session. <a href="/auth/login">Sign in to save</a>
      </div>
      <Link to="/login" className="voice-back">← MindTrack</Link>
      <div className="voice-stage">
        <VoiceSession onComplete={() => {}} />
      </div>
      <footer className="voice-page-footer">
        <Link to="/login" className="voice-persona-link">
          <span>More companions are available</span>
          <strong>Sign in to customize →</strong>
        </Link>
        <p className="voice-disclaimer">
          Demo only — not medical advice or crisis support. In the U.S., call or
          text 988 for immediate emotional support.
        </p>
      </footer>
    </main>
  );
}
