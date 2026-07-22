import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Leaf, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import ActivityRings from "../components/ActivityRings.jsx";
import MoodGraph from "../components/MoodGraph.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { fetchJobStats, fetchMoodHistory, fetchMoodStats } from "../lib/api.js";

const JOB_SNAPSHOT = [
  { key: "applied", label: "Applied", color: "var(--applied-color)" },
  { key: "interview", label: "Interview", color: "var(--energy-color)" },
  { key: "rejected", label: "Rejected", color: "var(--rejected-color)" },
  { key: "ghosted", label: "Ghosted", color: "var(--ghosted-color)" },
];

export default function Overview() {
  const [stats, setStats] = useState([]);
  const [history, setHistory] = useState([]);
  const [jobTotals, setJobTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [moodStats, moodHistory, jobs] = await Promise.all([
        fetchMoodStats(7),
        fetchMoodHistory(30, 30),
        fetchJobStats().catch(() => null),
      ]);
      setStats(moodStats);
      setHistory(moodHistory);
      setJobTotals(jobs?.totals ?? null);
    } catch (requestError) {
      setError(requestError.message || "Failed to load your week");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const wellness = useMemo(() => wellnessScore(history), [history]);
  const weeklyInsight = useMemo(() => buildWeeklyInsight(history), [history]);
  const reflectionPrompt = dailyReflectionPrompt();

  return (
    <div className="overview-page">
      <div className="page-intro">
        <div className="page-eyebrow">{greeting()}</div>
        <h1>Here's how the week's looking.</h1>
      </div>

      <div className="overview-hero-grid">
        <section className="surface wellness-card" aria-label="Wellness score">
          {loading && history.length === 0 ? (
            <Skeleton width={150} height={150} radius={999} />
          ) : (
            <ActivityRings score={wellness} size={150} />
          )}
          <div className="wellness-caption">Wellness score</div>
        </section>

        <section className="surface trend-card">
          <div className="trend-card-header">
            <h2>Mood &amp; energy, last 7 days</h2>
            <div className="trend-legend" aria-label="Chart legend">
              <span><i className="legend-dot mood" />mood</span>
              <span><i className="legend-dot energy" />energy</span>
            </div>
          </div>
          {loading && stats.length === 0 ? (
            <Skeleton height={140} radius={12} />
          ) : (
            <MoodGraph data={statsForChart(stats)} />
          )}
        </section>
      </div>

      <div className="overview-action-grid">
        <Link to="/voice" className="checkin-card">
          <div className="mini-orb" aria-hidden="true" />
          <div>
            <h2>Start today's check-in</h2>
            <p>Two minutes, spoken or typed.</p>
          </div>
          <span className="checkin-arrow" aria-hidden="true"><ArrowRight size={19} /></span>
        </Link>

        <Link to="/jobs" className="surface job-snapshot-card">
          <h2>Job search snapshot</h2>
          <div className="job-snapshot-stats">
            {JOB_SNAPSHOT.map((item) => (
              <div key={item.key}>
                <strong style={{ color: item.color }}>{jobTotals?.[item.key] ?? 0}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Link>
      </div>

      <div className="overview-insights-grid">
        <section className="surface weekly-insights-card">
          <div className="insight-card-heading">
            <span className="insight-icon"><Lightbulb size={19} /></span>
            <div><h2>Weekly Insights</h2><p>Generated from your completed check-ins</p></div>
          </div>
          {loading ? (
            <div className="insight-loading" aria-label="Loading weekly insights"><i /><i /><i /></div>
          ) : weeklyInsight.ready ? (
            <div className="weekly-insight-copy">
              <strong>{weeklyInsight.title}</strong>
              <p>{weeklyInsight.body}</p>
              <Link to="/history">Review your check-ins →</Link>
            </div>
          ) : (
            <div className="insight-pending">
              <div className="insight-loading" aria-hidden="true"><i /><i /><i /></div>
              <p>Insights will appear after {weeklyInsight.remaining} more check-in{weeklyInsight.remaining === 1 ? "" : "s"}.</p>
            </div>
          )}
        </section>

        <section className={`surface daily-reflection-card${reflectionOpen ? " open" : ""}`}>
          <Leaf size={30} aria-hidden="true" />
          <h2>Daily Reflection</h2>
          {reflectionOpen ? (
            <div className="reflection-exercise" aria-live="polite">
              <p>{reflectionPrompt}</p>
              <Link to="/voice">Reflect with your voice agent →</Link>
            </div>
          ) : (
            <p>Take a moment to breathe and reflect on your progress.</p>
          )}
          <button type="button" onClick={() => setReflectionOpen((open) => !open)}>
            {reflectionOpen ? "Close Exercise" : "Explore Exercise"}
          </button>
        </section>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}
    </div>
  );
}

function wellnessScore(history) {
  if (!history.length) return null;
  const recent = history.slice(0, 7).filter((entry) =>
    [entry.mood_score, entry.energy_level, entry.anxiety_level].every((value) => value != null)
  );
  if (!recent.length) return null;
  const total = recent.reduce(
    (sum, entry) => sum + (entry.mood_score + entry.energy_level + (10 - entry.anxiety_level)) / 3,
    0
  );
  return Math.round((total / recent.length) * 10);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function statsForChart(stats) {
  return stats.map((point) => ({
    day: point.day,
    mood: point.mood,
    energy: point.energy,
  }));
}

function buildWeeklyInsight(history) {
  const completed = history
    .filter((entry) => entry.mood_score != null && entry.energy_level != null)
    .slice(0, 7);
  if (completed.length < 3) return { ready: false, remaining: 3 - completed.length };

  const recent = completed.slice(0, Math.min(3, completed.length));
  const earlier = completed.slice(-Math.min(3, completed.length));
  const recentMood = average(recent.map((entry) => entry.mood_score));
  const earlierMood = average(earlier.map((entry) => entry.mood_score));
  const recentEnergy = average(recent.map((entry) => entry.energy_level));
  const direction = recentMood - earlierMood;

  if (direction >= 0.75) {
    return {
      ready: true,
      title: "Your mood is moving upward.",
      body: `Recent mood averaged ${recentMood.toFixed(1)}/10, with energy at ${recentEnergy.toFixed(1)}/10. Notice what helped on your stronger days and make space for it again.`,
    };
  }
  if (direction <= -0.75) {
    return {
      ready: true,
      title: "This week has felt heavier.",
      body: `Recent mood averaged ${recentMood.toFixed(1)}/10. Consider protecting one small pocket of recovery time and naming what is taking the most energy.`,
    };
  }
  return {
    ready: true,
    title: "Your mood has been relatively steady.",
    body: `Recent mood averaged ${recentMood.toFixed(1)}/10 and energy ${recentEnergy.toFixed(1)}/10. Consistency is useful data—keep checking in to reveal the pattern underneath it.`,
  };
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function dailyReflectionPrompt() {
  const prompts = [
    "What gave you even a small amount of energy today?",
    "What are you carrying that you can set down for tonight?",
    "Name one thing you handled better than you expected.",
    "What would make tomorrow feel five percent lighter?",
    "Where did you show yourself patience today?",
  ];
  const now = new Date();
  const dayKey = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000);
  return prompts[dayKey % prompts.length];
}
