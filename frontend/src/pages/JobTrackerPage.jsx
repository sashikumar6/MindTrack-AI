import { Mail } from "lucide-react";
import JobPanel from "../components/JobPanel.jsx";
import { useAuth } from "../lib/AuthContext.jsx";

export default function JobTrackerPage() {
  const { user } = useAuth();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={header}>
        <h1 style={title}>Job Tracker</h1>
        <p style={subtitle}>Pulled quietly from your inbox every day.</p>
      </div>
      {user && !user.gmail_connected ? (
        <div style={banner}>
          <Mail size={18} color="var(--text-secondary)" />
          <div style={bannerText}>
            <div style={bannerTitle}>Gmail isn't connected</div>
            <div style={bannerSubtitle}>
              Connect Gmail to automatically track job-application emails —
              applied, rejected, interviews, and ghosted follow-ups.
            </div>
          </div>
          <a href="/auth/login" style={connectBtn}>
            Connect Gmail
          </a>
        </div>
      ) : null}
      <JobPanel />
    </div>
  );
}

const header = { animation: "fadeUp 420ms ease both" };
const title = { fontSize: 34, fontWeight: 600, margin: "0 0 8px" };
const subtitle = { fontSize: 15, color: "var(--text-secondary)", margin: "0 0 24px" };
const banner = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "14px 16px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  marginBottom: 18,
};
const bannerText = { flex: 1 };
const bannerTitle = { fontSize: 13, fontWeight: 600 };
const bannerSubtitle = { fontSize: 12, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 };
const connectBtn = {
  padding: "8px 16px",
  background: "var(--mood-color)",
  color: "var(--bg-primary)",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
