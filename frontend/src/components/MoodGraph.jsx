import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TOOLTIP_STYLE = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
};

export default function MoodGraph({ data = [] }) {
  const completed = data.filter((point) => point.mood != null || point.energy != null);
  if (!completed.length) {
    return (
      <div className="chart-empty">
        Complete a conversation through its summary to begin your seven-day trend.
      </div>
    );
  }

  return (
    <div className="mood-graph">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
            tickFormatter={formatDayTick}
            interval={0}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis domain={[0, 10]} hide />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--text-secondary)" }}
            labelFormatter={formatDayLabel}
            cursor={{ stroke: "var(--border)" }}
          />
          <Line
            type="linear"
            dataKey="mood"
            stroke="var(--mood-color)"
            strokeWidth={3}
            dot={{ r: completed.length === 1 ? 5 : 3, fill: "var(--mood-color)", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "var(--mood-color)", strokeWidth: 0 }}
            connectNulls
            animationDuration={1000}
          />
          <Line
            type="linear"
            dataKey="energy"
            stroke="var(--energy-color)"
            strokeWidth={3}
            dot={{ r: completed.length === 1 ? 5 : 3, fill: "var(--energy-color)", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "var(--energy-color)", strokeWidth: 0 }}
            connectNulls
            animationDuration={1000}
            animationBegin={140}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function localDate(day) {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(year, month - 1, date);
}

function formatDayTick(day) {
  return localDate(day).toLocaleDateString(undefined, { weekday: "short" });
}

function formatDayLabel(day) {
  return localDate(day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
