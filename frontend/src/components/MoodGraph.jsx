import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

export default function MoodGraph({ data = [] }) {
  return (
    <div style={{ width: "100%", height: 200, marginTop: 18 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-mood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--mood-color)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--mood-color)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad-energy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--energy-color)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--energy-color)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad-anxiety" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--anxiety-color)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--anxiety-color)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="day"
            stroke="var(--text-tertiary)"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, 10]}
            stroke="var(--text-tertiary)"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={28}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="mood"
            stroke="var(--mood-color)"
            strokeWidth={2}
            fill="url(#grad-mood)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive
            animationDuration={900}
          />
          <Area
            type="monotone"
            dataKey="energy"
            stroke="var(--energy-color)"
            strokeWidth={2}
            fill="url(#grad-energy)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive
            animationDuration={900}
            animationBegin={120}
          />
          <Area
            type="monotone"
            dataKey="anxiety"
            stroke="var(--anxiety-color)"
            strokeWidth={2}
            fill="url(#grad-anxiety)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive
            animationDuration={900}
            animationBegin={240}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
