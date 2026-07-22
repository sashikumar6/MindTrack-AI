import { useCallback, useEffect, useState } from "react";
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
    } catch (requestError) {
      setError(requestError.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="history-page">
      <div className="page-intro history-intro">
        <h1>History</h1>
        <p>Past check-ins, and what came out of them.</p>
      </div>

      {loading ? (
        <div className="history-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} height={86} radius={0} />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">No check-ins yet — start one from the Voice Agent tab.</div>
      ) : (
        <div className="history-list">
          {sessions.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              expanded={expandedId === session.session_id}
              onToggle={() => setExpandedId(expandedId === session.session_id ? null : session.session_id)}
            />
          ))}
        </div>
      )}

      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}

function SessionRow({ session, expanded, onToggle }) {
  const [transcript, setTranscript] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  useEffect(() => {
    if (!expanded || transcript) return;
    setLoadingTranscript(true);
    fetchMoodSessionTranscript(session.session_id)
      .then(setTranscript)
      .catch(() => {})
      .finally(() => setLoadingTranscript(false));
  }, [expanded, transcript, session.session_id]);

  const mood = session.mood_entry;
  const when = session.ended_at || session.started_at;

  return (
    <article className={`history-row${expanded ? " expanded" : ""}`}>
      <button type="button" className="history-row-button" onClick={onToggle} aria-expanded={expanded}>
        <div className="history-copy">
          <strong>{formatDate(when)}</strong>
          <span>{mood?.summary || "Check-in completed."}</span>
        </div>
        {mood ? (
          <div className="history-stats">
            <Stat label="mood" value={mood.mood_score} color="var(--mood-color)" />
            <Stat label="energy" value={mood.energy_level} color="var(--energy-color)" />
            <Stat label="anxiety" value={mood.anxiety_level} color="var(--anxiety-color)" />
          </div>
        ) : null}
      </button>

      {expanded ? (
        <div className="history-transcript">
          {loadingTranscript ? (
            <Skeleton height={80} radius={8} />
          ) : transcript ? (
            transcript.turns.map((turn, index) => (
              <p key={index} className={turn.role === "agent" ? "coach" : "user"}>
                <strong>{turn.role === "agent" ? "Coach" : "You"}:</strong> {turn.content}
              </p>
            ))
          ) : (
            <p>Couldn't load transcript.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function Stat({ label, value, color }) {
  if (value == null) return null;
  return (
    <div>
      <strong style={{ color }}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const prefix = sameDay(date, now)
    ? "Today"
    : sameDay(date, yesterday)
    ? "Yesterday"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${prefix}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
