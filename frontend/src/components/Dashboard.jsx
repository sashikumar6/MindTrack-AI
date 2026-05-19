import MoodPanel from "./MoodPanel.jsx";
import JobPanel from "./JobPanel.jsx";

export default function Dashboard() {
  const today = new Date();
  const fullDate = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={styles.title}>
            <span style={styles.brand}></span> MindTrack AI
          </h1>
          <span style={styles.subtitle}>
            Personal mental health & job search
          </span>
        </div>
        <div style={styles.statusGroup}>
          <span style={styles.dot} />
          <span style={styles.date}>{fullDate}</span>
        </div>
      </header>

      <main style={styles.grid}>
        <div style={{ ...styles.panelWrap, animationDelay: "80ms" }}>
          <MoodPanel />
        </div>
        <div style={{ ...styles.panelWrap, animationDelay: "180ms" }}>
          <JobPanel />
        </div>
      </main>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    padding: "32px 32px 64px",
    maxWidth: 1400,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 32,
    animation: "fadeUp 600ms ease both",
  },
  title: {
    fontSize: 26,
    fontWeight: 600,
    margin: 0,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brand: { fontSize: 22 },
  subtitle: {
    color: "var(--text-secondary)",
    fontSize: 13,
  },
  statusGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-secondary)",
    fontSize: 13,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--mood-color)",
    boxShadow: "0 0 8px rgba(48,209,88,0.6)",
    animation: "livePulse 2.4s ease-in-out infinite",
  },
  date: { letterSpacing: "-0.01em" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
    gap: 24,
  },
  panelWrap: {
    animation: "fadeUp 700ms cubic-bezier(0.22,1,0.36,1) both",
  },
};
