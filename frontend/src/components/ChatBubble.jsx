import { MessageCircle } from "lucide-react";

export default function ChatBubble({ role, text, muted }) {
  const isAgent = role === "agent";
  return (
    <div style={{ ...bubbleRow, justifyContent: isAgent ? "flex-start" : "flex-end" }}>
      <div
        style={{
          ...bubble,
          background: isAgent ? "var(--bg-elevated)" : "var(--mood-color)",
          color: isAgent ? "var(--text-primary)" : "var(--bg-primary)",
          opacity: muted ? 0.5 : 1,
          borderTopLeftRadius: isAgent ? 4 : 12,
          borderTopRightRadius: isAgent ? 12 : 4,
        }}
      >
        {isAgent ? (
          <div style={bubbleLabel}>
            <MessageCircle size={10} /> COACH
          </div>
        ) : null}
        <div style={bubbleText}>{text}</div>
      </div>
    </div>
  );
}

const bubbleRow = { display: "flex", width: "100%" };
const bubble = {
  maxWidth: "82%",
  padding: "8px 12px",
  borderRadius: 12,
  fontSize: 13,
  lineHeight: 1.45,
  border: "1px solid var(--border-soft)",
};
const bubbleLabel = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.14em",
  color: "var(--mood-color)",
  marginBottom: 4,
};
const bubbleText = { whiteSpace: "pre-wrap" };
