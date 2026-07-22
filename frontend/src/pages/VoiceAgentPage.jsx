import VoiceSession from "../components/VoiceSession.jsx";

export default function VoiceAgentPage() {
  return (
    <section style={panel}>
      <div style={header}>
        <h1 style={title}>Voice Agent</h1>
        <p style={subtitle}>
          Talk through how you're doing — I'll ask a follow-up or two, then
          check back in tomorrow.
        </p>
      </div>
      <VoiceSession onComplete={() => {}} />
    </section>
  );
}

const panel = {
  maxWidth: 520,
  margin: "0 auto",
  textAlign: "center",
  animation: "fadeUp 420ms ease both",
};
const header = { display: "flex", flexDirection: "column", gap: 8 };
const title = { margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" };
const subtitle = { margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 };
