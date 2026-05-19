export default function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  style,
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background:
          "linear-gradient(90deg, var(--bg-elevated) 0%, rgba(255,255,255,0.05) 50%, var(--bg-elevated) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
        ...style,
      }}
    />
  );
}
