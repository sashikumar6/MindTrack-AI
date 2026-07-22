import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mic } from "lucide-react";
import ActivityRings from "../components/ActivityRings.jsx";
import MoodGraph from "../components/MoodGraph.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { fetchJobStats, fetchMoodHistory, fetchMoodStats } from "../lib/api.js";

const JOB_SNAPSHOT = [
  { key: "applied", label: "Applied", color: "var(--applied-color)" },
  { key: "interview", label: "Interview", color: "var(--interview-color)" },
  { key: "rejected", label: "Rejected", color: "var(--rejected-color)" },
  { key: "ghosted", label: "Ghosted", color: "var(--ghosted-color)" },
];

export default function Overview() {
  const [stats, setStats] = useState([]);
  const [history, setHistory] = useState([]);
  const [jobTotals, setJobTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, h, j] = await Promise.all([
        fetchMoodStats(7),
        fetchMoodHistory(30, 30),
        fetchJobStats().catch(() => null),
      ]);
      setStats(s);
      setHistory(h);
      setJobTotals(j?.totals ?? null);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = history[0];
  const yesterday = history[1];
  const sevenDay = computeSevenDayAverage(history);

  return (
    <div>
      <div style={hero}>
        <div style={eyebrow}>{greeting()}</div>
        <h1 style={headline}>Here's how the week's looking.</h1>
      </div>

      <div style={heroGrid}>
        <div style={{ ...card, ...ringCard }}>
          {loading && history.length === 0 ? (
            <Skeleton width={150} height={150} radius={999} />
          ) : (
            <ActivityRings
              mood={today?.mood_score ?? null}
              energy={today?.energy_level ?? null}
              anxiety={today?.anxiety_level ?? null}
              size={150}
            />
          )}
          <div style={ringCaption}>Wellness score</div>
        </div>

        <div style={card}>
          <div style={chartHeader}>
            <div style={cardTitle}>Mood, energy &amp; anxiety, last 7 check-ins</div>
            <div style={chartLegend}>
              <span><span style={{ color: "var(--mood-color)" }}>●</span> mood</span>
              <span><span style={{ color: "var(--energy-color)" }}>●</span> energy</span>
              <span><span style={{ color: "var(--anxiety-color)" }}>●</span> anxiety</span>
            </div>
          </div>
          {loading && history.length === 0 ? (
            <Skeleton height={140} radius={12} />
          ) : (
            <MoodGraph data={statsForChart(stats)} />
          )}
        </div>
      </div>

      <div style={actionGrid}>
        <Link to="/voice" style={startCard}>
          <div style={startOrb} />
          <div>
            <div style={actionTitle}>Start today's check-in</div>
            <div style={actionSubtitle}>Two minutes, spoken or typed.</div>
          </div>
        </Link>

        <Link to="/jobs" style={{ ...card, ...jobCard }}>
          <div style={actionTitle}>Job search snapshot</div>
          <div style={jobStatsRow}>
            {JOB_SNAPSHOT.map((j) => (
              <div key={j.key}>
                <div style={{ ...jobStatValue, color: j.color }}>{jobTotals?.[j.key] ?? 0}</div>
                <div style={jobStatLabel}>{j.label}</div>
              </div>
            ))}
          </div>
        </Link>
      </div>

      <div style={{ ...card, marginTop: 24 }}>
        <div style={ringLegend}>
          <LegendItem
            label="Mood"
            color="var(--mood-color)"
            value={today?.mood_score}
            delta={trend(today?.mood_score, yesterday?.mood_score)}
            loading={loading}
          />
          <LegendItem
            label="Energy"
            color="var(--energy-color)"
            value={today?.energy_level}
            delta={trend(today?.energy_level, yesterday?.energy_level)}
            loading={loading}
          />
          <LegendItem
            label="Anxiety"
            color="var(--anxiety-color)"
            value={today?.anxiety_level}
            delta={trend(today?.anxiety_level, yesterday?.anxiety_level)}
            inverted
            loading={loading}
          />
        </div>

        <div style={summaryRow}>
          <SummaryStat label="7-day mood" value={format(sevenDay.mood)} loading={loading && history.length === 0} />
          <SummaryStat label="7-day energy" value={format(sevenDay.energy)} loading={loading && history.length === 0} />
          <SummaryStat
            label="Last check-in"
            value={today?.created_at ? timeAgo(today.created_at) : "—"}
            loading={loading && history.length === 0}
          />
        </div>

        {today?.agent_response ? (
          <div style={coachBox}>
            <div style={coachLabel}>COACH</div>
            <div style={coachBody}>{today.agent_response}</div>
          </div>
        ) : null}

        {!loading && history.length === 0 ? (
          <div style={emptyState}>
            <Mic size={16} /> No check-ins yet — start one from the Voice Agent tab.
          </div>
        ) : null}

        {error ? <div style={errorBox}>{error}</div> : null}
      </div>
    </div>
  );
}

function LegendItem({ label, color, value, delta, inverted, loading }) {
  if (loading) {
    return (
      <div style={legendItem}>
        <span style={{ ...legendDot, background: color }} />
        <span style={legendLabel}>{label}</span>
        <Skeleton width={28} height={12} radius={4} />
      </div>
    );
  }
  const arrow = delta == null ? "" : delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const isGood = inverted ? delta < 0 : delta > 0;
  const arrowColor =
    delta == null || delta === 0
      ? "var(--text-secondary)"
      : isGood
      ? "var(--mood-color)"
      : "var(--rejected-color)";
  return (
    <div style={legendItem}>
      <span style={{ ...legendDot, background: color }} />
      <span style={legendLabel}>{label}</span>
      <span style={legendValue}>{value ?? "—"}</span>
      <span style={{ color: arrowColor, fontSize: 11 }}>{arrow}</span>
    </div>
  );
}

function SummaryStat({ label, value, loading }) {
  return (
    <div style={summaryItem}>
      <div style={summaryLabel}>{label}</div>
      {loading ? (
        <Skeleton width={48} height={18} radius={6} style={{ margin: "4px auto 0" }} />
      ) : (
        <div style={summaryValue}>{value}</div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function statsForChart(stats) {
  return stats.map((s) => ({
    day: s.day.slice(5),
    mood: s.mood,
    energy: s.energy,
    anxiety: s.anxiety,
  }));
}

function computeSevenDayAverage(history) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = history.filter(
    (h) => h.created_at && new Date(h.created_at).getTime() >= cutoff
  );
  if (recent.length === 0) return { mood: null, energy: null, anxiety: null };
  const n = recent.length;
  return {
    mood: recent.reduce((s, e) => s + (e.mood_score || 0), 0) / n,
    energy: recent.reduce((s, e) => s + (e.energy_level || 0), 0) / n,
    anxiety: recent.reduce((s, e) => s + (e.anxiety_level || 0), 0) / n,
  };
}

function trend(a, b) {
  if (a == null || b == null) return null;
  return a - b;
}

function format(n) {
  if (n == null) return "—";
  return n.toFixed(1);
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const hero = { animation: "fadeUp 420ms ease both" };
const eyebrow = {
  fontSize: 13,
  letterSpacing: "0.1em",
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  marginBottom: 10,
};
const headline = { fontSize: 34, fontWeight: 600, margin: "0 0 8px" };
const card = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 28,
};
const heroGrid = {
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  gap: 24,
  marginTop: 36,
  animation: "fadeUp 460ms ease both",
  animationDelay: "60ms",
};
const ringCard = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
};
const ringCaption = {
  fontSize: 13,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const chartHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
  flexWrap: "wrap",
  gap: 8,
};
const cardTitle = { fontSize: 15, fontWeight: 600 };
const chartLegend = { display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" };
const actionGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 24,
  marginTop: 24,
  animation: "fadeUp 460ms ease both",
  animationDelay: "120ms",
};
const startCard = {
  background: "linear-gradient(135deg, rgba(77,163,255,0.14), rgba(52,211,153,0.1))",
  border: "1px solid rgba(77,163,255,0.28)",
  borderRadius: 18,
  padding: 28,
  display: "flex",
  alignItems: "center",
  gap: 20,
  cursor: "pointer",
  textDecoration: "none",
  color: "var(--text-primary)",
  transition: "border-color 160ms",
};
const startOrb = {
  width: 52,
  height: 52,
  borderRadius: "50%",
  background: "radial-gradient(circle at 35% 30%, #7dbcff, #4da3ff 45%, #34d399 100%)",
  animation: "breathe 3.6s ease-in-out infinite",
  flexShrink: 0,
};
const jobCard = {
  display: "block",
  textDecoration: "none",
  color: "var(--text-primary)",
  cursor: "pointer",
  transition: "border-color 160ms",
};
const actionTitle = { fontSize: 16, fontWeight: 600, marginBottom: 4 };
const actionSubtitle = { fontSize: 13, color: "var(--text-secondary)" };
const jobStatsRow = { display: "flex", gap: 22, marginTop: 14 };
const jobStatValue = { fontSize: 20, fontWeight: 700 };
const jobStatLabel = { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 };
const ringLegend = { display: "flex", justifyContent: "center", gap: 18 };
const legendItem = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 };
const legendDot = { width: 8, height: 8, borderRadius: "50%" };
const legendLabel = { color: "var(--text-secondary)" };
const legendValue = { color: "var(--text-primary)", fontWeight: 600 };
const summaryRow = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 18 };
const summaryItem = {
  background: "var(--bg-elevated)",
  borderRadius: 10,
  padding: "10px 8px",
  textAlign: "center",
  border: "1px solid var(--border-soft)",
};
const summaryLabel = { color: "var(--text-secondary)", fontSize: 11, letterSpacing: "0.02em" };
const summaryValue = { fontSize: 16, fontWeight: 600, marginTop: 2, letterSpacing: "-0.01em" };
const coachBox = {
  marginTop: 18,
  padding: "12px 14px",
  background: "var(--bg-elevated)",
  borderLeft: "2px solid var(--mood-color)",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
};
const coachLabel = { color: "var(--mood-color)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", marginBottom: 6 };
const coachBody = { fontSize: 13, lineHeight: 1.55, color: "var(--text-primary)" };
const emptyState = {
  marginTop: 14,
  padding: 14,
  color: "var(--text-secondary)",
  fontSize: 13,
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "1px dashed var(--border)",
  borderRadius: 12,
};
const errorBox = {
  marginTop: 12,
  padding: 10,
  background: "rgba(255,92,92,0.08)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
};
