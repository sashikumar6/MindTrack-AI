import { useState } from "react";
import { LogOut, Mail, MailCheck } from "lucide-react";
import { useAuth } from "../lib/AuthContext.jsx";

const PERSONAS = [
  { id: "warm", label: "Warm & Kind" },
  { id: "direct", label: "Direct & Advisable" },
  { id: "gentle", label: "Gentle & Reassuring" },
];

const VOICE_LABELS = {
  marin: "Marin — default",
  alloy: "Alloy — neutral",
  ash: "Ash — warm",
  ballad: "Ballad — smooth",
  coral: "Coral — bright",
  echo: "Echo — clear",
  sage: "Sage — calm",
  shimmer: "Shimmer — light",
  verse: "Verse — expressive",
  cedar: "Cedar — deep",
};

export default function SettingsPage() {
  const { user, logout, updatePreferences } = useAuth();
  const [error, setError] = useState(null);
  if (!user) return null;

  const onUpdate = async (patch) => {
    setError(null);
    try {
      await updatePreferences(patch);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to save");
    }
  };

  return (
    <section style={panel}>
      <h1 style={title}>Settings</h1>

      <div style={{ ...row, ...profileRow }}>
        {user.picture_url ? (
          <img src={user.picture_url} alt="" style={avatar} referrerPolicy="no-referrer" />
        ) : (
          <div style={avatarFallback}>{(user.name || user.email || "?")[0].toUpperCase()}</div>
        )}
        <div>
          <div style={name}>{user.name || "—"}</div>
          <div style={email}>{user.email}</div>
        </div>
      </div>

      <div style={row}>
        <div style={rowLabel}>
          {user.gmail_connected ? (
            <MailCheck size={16} color="var(--mood-color)" />
          ) : (
            <Mail size={16} color="var(--text-secondary)" />
          )}
          <div>
            <div style={rowTitle}>Gmail job tracking</div>
            <div style={rowSubtitle}>
              {user.gmail_connected
                ? "Connected — job-application emails are scanned automatically."
                : "Not connected. Reconnect to enable automatic job tracking."}
            </div>
          </div>
        </div>
        {!user.gmail_connected ? (
          <a href="/auth/login" style={connectBtn}>
            Connect Gmail
          </a>
        ) : null}
      </div>

      <div style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={rowTitle}>Coach tone</div>
        <div style={pillRow}>
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onUpdate({ persona_mode: p.id })}
              style={{
                ...pillBtn,
                ...(user.persona_mode === p.id ? pillBtnActive : null),
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...row, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={rowTitle}>Coach voice</div>
        {user.tts_provider === "openai" ? (
          <select
            value={user.tts_voice}
            onChange={(e) => onUpdate({ tts_voice: e.target.value })}
            style={voiceSelect}
          >
            {Object.entries(VOICE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <div style={rowSubtitle}>
            Voice selection isn't available with the current voice provider.
          </div>
        )}
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <button onClick={logout} style={signOutBtn}>
        <LogOut size={15} /> Sign out
      </button>
    </section>
  );
}

const panel = { maxWidth: 560, margin: "0 auto", animation: "fadeUp 420ms ease both" };
const title = { fontSize: 34, fontWeight: 600, margin: "0 0 36px" };
const profileRow = { gap: 16 };
const avatar = { width: 44, height: 44, borderRadius: "50%" };
const avatarFallback = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 15,
  fontWeight: 600,
};
const name = { fontSize: 15, fontWeight: 600 };
const email = { fontSize: 13, color: "var(--text-secondary)" };
const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "20px 22px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  marginBottom: 14,
};
const rowLabel = { display: "flex", alignItems: "center", gap: 10 };
const rowTitle = { fontSize: 14, fontWeight: 600 };
const rowSubtitle = { fontSize: 13, color: "var(--text-secondary)", marginTop: 2, maxWidth: 320 };
const connectBtn = {
  padding: "7px 14px",
  background: "var(--mood-color)",
  color: "var(--bg-primary)",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const signOutBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--rejected-color)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  marginTop: 6,
};
const pillRow = { display: "flex", flexWrap: "wrap", gap: 8 };
const pillBtn = {
  padding: "7px 14px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  color: "var(--text-secondary)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
};
const pillBtnActive = {
  background: "var(--mood-color)",
  borderColor: "var(--mood-color)",
  color: "var(--bg-primary)",
  fontWeight: 600,
};
const voiceSelect = {
  padding: "9px 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text-primary)",
  fontSize: 13,
};
const errorBox = {
  marginBottom: 12,
  padding: 10,
  background: "rgba(255,92,92,0.1)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
};
