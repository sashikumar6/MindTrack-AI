export const COMPANIONS = [
  {
    id: "empathetic",
    name: "Jeni",
    label: "Empathetic",
    description: "A gentle listener who validates what you're feeling.",
    gradient: "linear-gradient(140deg, #00f2fe 0%, #4facfe 52%, #7028e4 100%)",
  },
  {
    id: "compassionate",
    name: "Mira",
    label: "Compassionate",
    description: "A caring presence that responds with tenderness.",
    gradient: "linear-gradient(140deg, #ff9a9e 0%, #fecfef 50%, #a18cd1 100%)",
  },
  {
    id: "logical",
    name: "Atlas",
    label: "Stoic",
    description: "A calm, logical companion for clearer thinking.",
    gradient: "linear-gradient(140deg, #8e9eab 0%, #52616b 52%, #2b3a42 100%)",
  },
  {
    id: "playful",
    name: "Nova",
    label: "Playful",
    description: "A lighthearted, gently witty companion for a lift.",
    gradient: "linear-gradient(140deg, #f6d365 0%, #fda085 52%, #ff6b9d 100%)",
  },
  {
    id: "motivational",
    name: "Kai",
    label: "Motivational",
    description: "An encouraging companion that helps you build momentum.",
    gradient: "linear-gradient(140deg, #fddb92 0%, #d1fdff 48%, #4facfe 100%)",
  },
  {
    id: "direct",
    name: "Quinn",
    label: "Direct",
    description: "Honest, concise guidance without the extra padding.",
    gradient: "linear-gradient(140deg, #30cfd0 0%, #330867 100%)",
  },
  {
    id: "strict",
    name: "Viktor",
    label: "Strict Coach",
    description: "Firm, respectful accountability when you need structure.",
    gradient: "linear-gradient(140deg, #f83600 0%, #f9d423 100%)",
  },
  {
    id: "calm",
    name: "Luna",
    label: "Calm Guide",
    description: "A grounded companion for slower, steadier moments.",
    gradient: "linear-gradient(140deg, #43e97b 0%, #38f9d7 52%, #4facfe 100%)",
  },
];

export const COMPANION_NAMES = Object.fromEntries(
  COMPANIONS.map((companion) => [companion.id, companion.name])
);

export function companionNameForPersona(persona) {
  return COMPANION_NAMES[persona] || COMPANION_NAMES.empathetic;
}

export function companionForPersona(persona) {
  return COMPANIONS.find((companion) => companion.id === persona) || COMPANIONS[0];
}
