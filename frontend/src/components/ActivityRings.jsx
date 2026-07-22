export default function ActivityRings({ score = null, size = 150 }) {
  const stroke = 12;
  const radius = size / 2 - stroke / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const normalized = score == null ? 0 : Math.max(0, Math.min(100, Number(score)));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="wellness-ring">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--mood-color)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - normalized / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="wellness-ring-progress"
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="wellness-ring-value">
        {score == null ? "—" : Math.round(normalized)}
      </text>
    </svg>
  );
}
