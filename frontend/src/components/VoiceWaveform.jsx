import { useEffect, useRef } from "react";

// Live bar visualizer driven by a Web Audio AnalyserNode -- used both for
// the user's mic input while recording and for the agent's streamed TTS
// audio while it plays, so "listening" and "speaking" both get real signal
// instead of a static icon.
export default function VoiceWaveform({
  analyser,
  active,
  color = "var(--mood-color)",
  intensity = 1,
  barCount = 28,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 56;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const barWidth = width / barCount;
      for (let i = 0; i < barCount; i++) {
        let level = 0.06;
        if (active && analyser && data) {
          analyser.getByteFrequencyData(data);
          const bucket = Math.floor((i / barCount) * (data.length * 0.6));
          level = Math.max(0.06, data[bucket] / 255);
        }
        const scaled = Math.min(1, level * intensity);
        const barHeight = Math.max(3, scaled * height);
        const x = i * barWidth;
        const y = (height - barHeight) / 2;
        ctx.globalAlpha = active ? 0.55 + scaled * 0.45 : 0.3;
        ctx.fillStyle = color;
        drawRoundedBar(ctx, x + barWidth * 0.22, y, barWidth * 0.56, barHeight, Math.min(barWidth * 0.3, 3));
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, active, color, intensity, barCount]);

  return <canvas ref={canvasRef} style={style} />;
}

function drawRoundedBar(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

const style = { width: "100%", height: 56, display: "block" };
