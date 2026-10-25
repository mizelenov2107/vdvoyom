/** Кольцо прогресса: вклад каждого своим цветом, по часовой стрелке. */
export function Ring({
  parts,
  size = 64,
  stroke = 7,
  children,
}: {
  parts: { value: number; color: string }[];
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-3)" strokeWidth={stroke} />
        {parts.filter((p) => p.value > 0).map((p, i) => {
          const len = Math.max(0, Math.min(1, p.value)) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)" }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: size * 0.3 }}>{children}</div>
    </div>
  );
}
