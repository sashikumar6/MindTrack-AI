import { useCallback, useEffect, useState } from "react";
import ActivityRings from "./ActivityRings.jsx";
import MoodGraph from "./MoodGraph.jsx";
import VoiceButton from "./VoiceButton.jsx";
import Skeleton from "./Skeleton.jsx";
import { fetchMoodHistory, fetchMoodStats } from "../lib/api.js";

export default function MoodPanel() {
  const [stats, setStats] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, h] = await Promise.all([fetchMoodStats(7), fetchMoodHistory(30, 30)]);
      setStats(s);
      setHistory(h);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onResult = (entry) => {
    setHistory((prev) => [entry, ...prev]);
    fetchMoodStats(7).then(setStats).catch(() => {});
  };

  const today = history[0];
  const yesterday = history[1];
  const sevenDay = computeSevenDayAverage(history);

  return (
    <section style={panel}>
      <div style={panelHeader}>
        <h2 style={title}>Mental Health</h2>
        <span style={badge}>{history.length} entries</span>
      </div>

      <ActivityRings
        mood={today?.mood_score ?? null}
        energy={today?.energy_level ?? null}
        anxiety={today?.anxiety_level ?? null}
      />

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

      {loading && history.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <Skeleton height={200} radius={12} />
        </div>
      ) : (
        <MoodGraph data={statsForChart(stats)} />
      )}

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

      <VoiceButton onResult={onResult} />

      {!loading && history.length === 0 ? (
        <div style={emptyState}>No check-ins yet — record your first one above.</div>
      ) : null}

      {error ? <div style={errorBox}>{error}</div> : null}
    </section>
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

const panel = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 24,
  boxShadow: "var(--card-shadow)",
};
const panelHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 20,
};
const title = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.01em",
};
const badge = {
  fontSize: 11,
  color: "var(--text-secondary)",
  background: "var(--bg-elevated)",
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid var(--border-soft)",
};
const ringLegend = {
  display: "flex",
  justifyContent: "center",
  gap: 18,
  marginTop: 14,
};
const legendItem = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
};
const legendDot = { width: 8, height: 8, borderRadius: "50%" };
const legendLabel = { color: "var(--text-secondary)" };
const legendValue = { color: "var(--text-primary)", fontWeight: 600 };
const summaryRow = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 8,
  marginTop: 18,
};
const summaryItem = {
  background: "var(--bg-elevated)",
  borderRadius: 10,
  padding: "10px 8px",
  textAlign: "center",
  border: "1px solid var(--border-soft)",
};
const summaryLabel = {
  color: "var(--text-secondary)",
  fontSize: 11,
  letterSpacing: "0.02em",
};
const summaryValue = {
  fontSize: 16,
  fontWeight: 600,
  marginTop: 2,
  letterSpacing: "-0.01em",
};
const coachBox = {
  marginTop: 18,
  padding: "12px 14px",
  background: "var(--bg-elevated)",
  borderLeft: "2px solid var(--mood-color)",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
};
const coachLabel = {
  color: "var(--mood-color)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.14em",
  marginBottom: 6,
};
const coachBody = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--text-primary)",
};
const emptyState = {
  marginTop: 14,
  padding: 14,
  color: "var(--text-secondary)",
  fontSize: 13,
  textAlign: "center",
  border: "1px dashed var(--border)",
  borderRadius: 12,
};
const errorBox = {
  marginTop: 12,
  padding: 10,
  background: "rgba(255,69,58,0.08)",
  border: "1px solid var(--rejected-color)",
  borderRadius: 8,
  color: "var(--rejected-color)",
  fontSize: 12,
};
