import {
  BarChart,
  Bar,
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

export default function JobChart({ data = [] }) {
  return (
    <div style={{ width: "100%", height: 200, marginTop: 18 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="day"
            stroke="var(--text-tertiary)"
            tickFormatter={(d) => d.slice(5)}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            stroke="var(--text-tertiary)"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={28}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="applied" stackId="a" fill="var(--applied-color)" radius={[0, 0, 0, 0]} animationDuration={700} />
          <Bar dataKey="interview" stackId="a" fill="var(--interview-color)" radius={[0, 0, 0, 0]} animationDuration={700} animationBegin={80} />
          <Bar dataKey="rejected" stackId="a" fill="var(--rejected-color)" radius={[0, 0, 0, 0]} animationDuration={700} animationBegin={160} />
          <Bar dataKey="ghosted" stackId="a" fill="var(--ghosted-color)" radius={[6, 6, 0, 0]} animationDuration={700} animationBegin={240} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
