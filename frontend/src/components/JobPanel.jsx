import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import Skeleton from "./Skeleton.jsx";
import { fetchJobHistory, triggerJobScan } from "../lib/api.js";

export default function JobPanel() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchJobHistory(100));
    } catch (requestError) {
      setError(requestError.message || "Failed to load job applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applications = useMemo(() => groupApplications(records), [records]);

  const onScan = async () => {
    setScanning(true);
    setError(null);
    try {
      await triggerJobScan();
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || requestError.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <section>
      <div className="jobs-toolbar">
        <button type="button" onClick={onScan} disabled={scanning}>
          <RefreshCw size={13} className={scanning ? "spinning" : ""} />
          {scanning ? "Scanning…" : "Sync Gmail"}
        </button>
      </div>

      {loading ? (
        <div className="job-timeline-list">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} height={168} radius={16} />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="empty-state">No job emails detected yet. Sync Gmail to scan your inbox.</div>
      ) : (
        <div className="job-timeline-list">
          {applications.map((application) => (
            <ApplicationCard key={application.key} application={application} />
          ))}
        </div>
      )}

      {error ? <div className="inline-error">{error}</div> : null}
    </section>
  );
}

function ApplicationCard({ application }) {
  const finalLabel = application.outcome === "rejected"
    ? "Rejected"
    : application.outcome === "ghosted"
    ? "Ghosted"
    : application.outcome === "offer"
    ? "Offer"
    : "Offer";
  const stages = [
    { label: "Applied", date: application.appliedDate, state: "reached" },
    {
      label: "Interview",
      date: application.interviewDate,
      state: application.interviewDate ? "reached" : "future",
    },
    {
      label: finalLabel,
      date: application.outcomeDate,
      state: application.outcome || application.offerDate ? application.outcome || "offer" : "future",
    },
  ];

  return (
    <article className="application-card">
      <div className="application-heading">
        <div>
          <h2>{application.company}</h2>
          <p>{application.role}</p>
        </div>
        <span>Applied {application.appliedDate || "—"}</span>
      </div>
      <div className="application-stages">
        {stages.map((stage, index) => (
          <div className="stage-segment" key={stage.label}>
            <div className={`stage-marker ${stage.state}`}>
              <i />
              <strong>{stage.label}</strong>
              <span>{stage.date || "—"}</span>
            </div>
            {index < stages.length - 1 ? (
              <div className={`stage-line ${isLineReached(stages, index) ? "reached" : ""}`} />
            ) : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function isLineReached(stages, index) {
  return stages[index + 1].state !== "future";
}

function groupApplications(records) {
  const grouped = new Map();
  const ordered = [...records].sort((a, b) => new Date(a.detected_at || 0) - new Date(b.detected_at || 0));
  for (const record of ordered) {
    const company = record.company || "Unknown company";
    const role = record.job_title || "Role not identified";
    const key = `${company.toLowerCase()}::${role.toLowerCase()}`;
    const current = grouped.get(key) || {
      key,
      company,
      role,
      appliedDate: null,
      interviewDate: null,
      offerDate: null,
      outcome: null,
      outcomeDate: null,
      latest: record.detected_at,
    };
    const date = formatShortDate(record.applied_date || record.response_date || record.detected_at);
    if (record.status === "applied") current.appliedDate = current.appliedDate || date;
    if (record.status === "interview") current.interviewDate = date;
    if (record.status === "offer") {
      current.offerDate = date;
      current.outcome = "offer";
      current.outcomeDate = date;
    }
    if (record.status === "rejected" || record.status === "ghosted") {
      current.outcome = record.status;
      current.outcomeDate = date;
    }
    if (!current.appliedDate) current.appliedDate = formatShortDate(record.applied_date || record.detected_at);
    current.latest = record.detected_at || current.latest;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => new Date(b.latest || 0) - new Date(a.latest || 0));
}

function formatShortDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
