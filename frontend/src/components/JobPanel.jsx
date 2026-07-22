import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import JobChart from "./JobChart.jsx";
import Skeleton from "./Skeleton.jsx";
import {
  fetchJobHistory,
  fetchJobStats,
  fetchJobTimeline,
  triggerJobScan,
} from "../lib/api.js";

const STATUS_META = {
  applied: { label: "Applied", color: "var(--applied-color)", emoji: "✅" },
  rejected: { label: "Rejected", color: "var(--rejected-color)", emoji: "❌" },
  interview: { label: "Interviews", color: "var(--interview-color)", emoji: "📅" },
  ghosted: { label: "Ghosted", color: "var(--ghosted-color)", emoji: "👻" },
};

export default function JobPanel() {
  const [stats, setStats] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t, h] = await Promise.all([
        fetchJobStats(),
        fetchJobTimeline(14),
        fetchJobHistory(10),
      ]);
      setStats(s);
      setTimeline(t);
      setRecent(h);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onScan = async () => {
    setScanning(true);
    try {
      await triggerJobScan();
      await load();
    } catch (e) {
      setError(e.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <section style={panel}>
      <div style={panelHeader}>
        <h2 style={title}>Job Search</h2>
        <button onClick={onScan} disabled={scanning} style={syncBtn}>
          <RefreshCw size={13} style={scanning ? spin : null} />
          {scanning ? "Syncing…" : "Sync Gmail"}
        </button>
      </div>

      <div style={statsRow}>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <StatCard
            key={key}
            label={meta.label}
            value={stats?.totals?.[key]}
            delta={stats?.delta?.[key]}
            color={meta.color}
            loading={loading && !stats}
          />
        ))}
      </div>

      {loading && timeline.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <Skeleton height={200} radius={12} />
        </div>
      ) : (
        <JobChart data={timeline} />
      )}

      <div style={feedHeader}>RECENT ACTIVITY</div>
      <div style={feed}>
        {loading && recent.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={feedRow}>
                <Skeleton width={20} height={20} radius={6} />
                <Skeleton height={14} radius={4} style={{ flex: 1 }} />
                <Skeleton width={50} height={12} radius={4} />
              </div>
            ))
          : recent.length === 0
          ? <div style={emptyState}>No emails detected yet. Hit Sync Gmail to scan your inbox.</div>
          : recent.map((row) => <FeedRow key={row.id} row={row} />)}
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}
    </section>
  );
}

function StatCard({ label, value, delta, color, loading }) {
  if (loading) {
    return (
      <div style={{ ...statCard, borderTop: `2px solid ${color}` }}>
        <div style={statLabel}>{label}</div>
        <Skeleton width={36} height={26} radius={6} style={{ marginTop: 6 }} />
        <Skeleton width={60} height={11} radius={4} style={{ marginTop: 6 }} />
      </div>
    );
  }
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta > 0
    ? "var(--mood-color)"
    : delta < 0
    ? "var(--rejected-color)"
    : "var(--text-secondary)";
  const sign = delta > 0 ? "+" : "";
  return (
    <div style={{ ...statCard, borderTop: `2px solid ${color}` }}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value ?? 0}</div>
      <div style={{ ...statDelta, color: deltaColor }}>
        <Icon size={11} />
        {`${sign}${delta ?? 0} this week`}
      </div>
    </div>
  );
}

function FeedRow({ row }) {
  const meta = STATUS_META[row.status] || { emoji: "•", label: row.status };
  const when = row.detected_at ? timeAgo(row.detected_at) : "";
  return (
    <div style={feedRow}>
      <span style={feedEmoji}>{meta.emoji}</span>
      <span style={feedText}>
        <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{meta.label}</strong>
        {row.company ? (
          <span style={{ color: "var(--text-secondary)" }}> · {row.company}</span>
        ) : null}
        {row.job_title ? (
          <span style={{ color: "var(--text-tertiary)" }}> ({row.job_title})</span>
        ) : null}
      </span>
      <span style={feedTime}>{when}</span>
    </div>
  );
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const panel = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 26,
  boxShadow: "var(--card-shadow)",
};
const panelHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 18,
};
const title = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.01em",
};
const syncBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-soft)",
  borderRadius: 999,
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 200ms ease",
};
const spin = { animation: "spin 1s linear infinite" };
const statsRow = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 10,
};
const statCard = {
  background: "var(--bg-elevated)",
  borderRadius: 12,
  padding: 12,
  border: "1px solid var(--border-soft)",
};
const statLabel = {
  color: "var(--text-secondary)",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: "0.02em",
};
const statValue = {
  fontSize: 26,
  fontWeight: 600,
  marginTop: 4,
  letterSpacing: "-0.02em",
};
const statDelta = {
  fontSize: 11,
  marginTop: 4,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};
const feedHeader = {
  marginTop: 22,
  marginBottom: 8,
  fontSize: 10,
  letterSpacing: "0.18em",
  color: "var(--text-secondary)",
  fontWeight: 600,
};
const feed = { display: "flex", flexDirection: "column", gap: 6 };
const feedRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 12px",
  background: "var(--bg-elevated)",
  borderRadius: 10,
  border: "1px solid var(--border-soft)",
  fontSize: 13,
};
const feedEmoji = { fontSize: 14 };
const feedText = { flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const feedTime = { color: "var(--text-tertiary)", fontSize: 11, flexShrink: 0 };
const emptyState = {
  padding: 16,
  color: "var(--text-secondary)",
  fontSize: 13,
  textAlign: "center",
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
