import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import ChatBubble from "../components/ChatBubble.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { fetchMoodSessionTranscript, fetchMoodSessions } from "../lib/api.js";

export default function HistoryPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await fetchMoodSessions(30));
    } catch (e) {
      setError(e.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={wrap}>
      <div style={header}>
        <h1 style={title}>History</h1>
        <p style={subtitle}>Past check-ins, and what came out of them.</p>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={64} radius={12} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div style={emptyState}>No check-ins yet — start one from the Voice Agent tab.</div>
      ) : (
        <div style={list}>
          {sessions.map((s) => (
            <SessionRow
              key={s.session_id}
              session={s}
              expanded={expandedId === s.session_id}
              onToggle={() => setExpandedId(expandedId === s.session_id ? null : s.session_id)}
            />
          ))}
        </div>
      )}

      {error ? <div style={errorBox}>{error}</div> : null}
    </div>
  );
}

function SessionRow({ session, expanded, onToggle }) {
  const [transcript, setTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  useEffect(() => {
    if (expanded && !transcript) {
      setLoadingTranscript(true);
      fetchMoodSessionTranscript(session.session_id)
        .then(setTranscript)
        .catch(() => {})
        .finally(() => setLoadingTranscript(false));
    }
  }, [expanded, transcript, session.session_id]);

  const mood = session.mood_entry;
  const when = session.ended_at || session.started_at;

  return (
    <div style={row}>
      <button type="button" style={rowHeader} onClick={onToggle}>
        <div style={rowHeaderLeft}>
          <div style={rowDate}>{formatDate(when)}</div>
          {mood?.summary ? <div style={rowSummary}>{mood.summary}</div> : null}
        </div>
        <div style={rowHeaderRight}>
          {mood ? (
            <div style={stats}>
              <Stat label="mood" value={mood.mood_score} color="var(--mood-color)" />
              <Stat label="energy" value={mood.energy_level} color="var(--energy-color)" />
              <Stat label="anxiety" value={mood.anxiety_level} color="var(--anxiety-color)" />
            </div>
          ) : null}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded ? (
        <div style={transcriptBox}>
          {loadingTranscript ? (
            <Skeleton height={80} radius={8} />
          ) : transcript ? (
            transcript.turns.map((t, i) => (
              <ChatBubble key={i} role={t.role} text={t.content} />
            ))
          ) : (
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Couldn't load transcript.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }) {
  if (value == null) return null;
  return (
    <div style={statItem}>
      <div style={{ ...statValue, color }}>{value}</div>
      <div style={statLabel}>{label}</div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const wrap = { maxWidth: 760, margin: "0 auto" };
const header = { animation: "fadeUp 420ms ease both" };
const title = { fontSize: 34, fontWeight: 600, margin: "0 0 8px" };
const subtitle = { fontSize: 15, color: "var(--text-secondary)", margin: "0 0 24px" };
const list = { animation: "fadeUp 460ms ease both", animationDelay: "60ms" };
const row = { borderTop: "1px solid var(--border)" };
const rowHeader = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "22px 4px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  color: "var(--text-primary)",
  font: "inherit",
};
const rowHeaderLeft = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
const rowDate = { fontSize: 15, fontWeight: 600 };
const rowSummary = {
  fontSize: 13,
  color: "var(--text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 420,
};
const rowHeaderRight = { display: "flex", alignItems: "center", gap: 18, flexShrink: 0 };
const stats = { display: "flex", gap: 18 };
const statItem = { textAlign: "center" };
const statValue = { fontSize: 16, fontWeight: 600 };
const statLabel = { fontSize: 11, color: "var(--text-tertiary)" };
const transcriptBox = {
  padding: "4px 4px 20px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const emptyState = {
  padding: 20,
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
