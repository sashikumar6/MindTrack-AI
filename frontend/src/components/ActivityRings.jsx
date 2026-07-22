const RINGS = [
  { key: "mood", color: "#4da3ff", glow: "rgba(77, 163, 255, 0.45)" },
  { key: "energy", color: "#fbbf24", glow: "rgba(251, 191, 36, 0.45)" },
  { key: "anxiety", color: "#34d399", glow: "rgba(52, 211, 153, 0.45)" },
];

export default function ActivityRings({
  mood = null,
  energy = null,
  anxiety = null,
  size = 200,
}) {
  const center = size / 2;
  const stroke = 14;
  const gap = 6;

  const fills = {
    mood: fill(mood),
    energy: fill(energy),
    anxiety: fill(anxiety == null ? null : 10 - anxiety),
  };

  const overall =
    mood == null && energy == null && anxiety == null
      ? null
      : Math.round(
          ((num(mood) + num(energy) + (10 - num(anxiety))) / 3) * 10
        ) / 10;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", margin: "0 auto" }}
    >
      <defs>
        {RINGS.map((r, i) => (
          <filter
            key={`f-${i}`}
            id={`ring-glow-${i}`}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feFlood floodColor={r.glow} result="c" />
            <feComposite in="c" in2="b" operator="in" result="g" />
            <feMerge>
              <feMergeNode in="g" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>

      {RINGS.map((r, i) => {
        const radius = center - stroke / 2 - 4 - i * (stroke + gap);
        const c = 2 * Math.PI * radius;
        const f = fills[r.key];
        const offset = c - f * c;
        return (
          <g key={r.key}>
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeOpacity="0.12"
              strokeWidth={stroke}
            />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${center} ${center})`}
              filter={`url(#ring-glow-${i})`}
              style={{
                transition:
                  "stroke-dashoffset 1100ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </g>
        );
      })}

      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        fill="var(--text-primary)"
        style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}
      >
        {overall == null ? "—" : overall.toFixed(1)}
      </text>
      <text
        x={center}
        y={center + 18}
        textAnchor="middle"
        fill="var(--text-secondary)"
        style={{ fontSize: 10, letterSpacing: "0.18em" }}
      >
        WELLNESS
      </text>
    </svg>
  );
}

function num(v) {
  return v == null ? 0 : Number(v);
}

function fill(score) {
  if (score == null) return 0;
  return Math.max(0, Math.min(10, Number(score))) / 10;
}
