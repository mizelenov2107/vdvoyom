import { useId, type ReactNode } from "react";

/**
 * Рисунки для пустых экранов. Один язык на все: два мягких круга цветов пары
 * на фоне («две половинки»), предмет тонким контуром цвета текста, детали —
 * фирменным градиентом. Цвета — переменные темы, поэтому рисунки сами
 * подстраиваются под светлую и тёмную тему и под выбранные цвета пары.
 */
export type ArtName =
  | "tasks" | "gift" | "jar" | "letter" | "vote" | "cards" | "notes" | "photos" | "goal"
  | "match" | "popcorn" | "map" | "calendar" | "chat" | "hourglass" | "invite";

const S = { stroke: "var(--text)", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Sparkle({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return <path d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z`} fill="var(--sun)" />;
}

function scene(name: ArtName, g: string): ReactNode {
  const grad = `url(#${g})`;
  switch (name) {
    case "tasks":
      return (
        <>
          <rect x="62" y="30" width="78" height="96" rx="14" fill="var(--card)" {...S} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx="80" cy={56 + i * 24} r="7" fill={i < 2 ? grad : "var(--card)"} {...S} strokeWidth={2.5} />
              {i < 2 && <path d={`M76.5 ${56 + i * 24}l2.5 2.5 5-5`} stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              <path d={`M94 ${56 + i * 24}h${i === 2 ? 22 : 32}`} {...S} opacity={i < 2 ? 0.45 : 1} />
            </g>
          ))}
          <Sparkle x={150} y={40} />
          <Sparkle x={48} y={112} r={4} />
        </>
      );
    case "gift":
      return (
        <>
          <rect x="60" y="72" width="80" height="52" rx="8" fill="var(--card)" {...S} />
          <rect x="54" y="58" width="92" height="18" rx="6" fill="var(--card)" {...S} />
          <rect x="93" y="58" width="14" height="66" fill={grad} />
          <path d="M100 58c-10-18-30-16-26-4 3 8 18 5 26 4zM100 58c10-18 30-16 26-4-3 8-18 5-26 4z" fill={grad} {...S} strokeWidth={2.5} />
          <Sparkle x={150} y={44} />
          <Sparkle x={46} y={60} r={4} />
        </>
      );
    case "jar":
      return (
        <>
          <path d="M72 50h56v8c8 6 12 14 12 26v26a14 14 0 0 1-14 14H74a14 14 0 0 1-14-14V84c0-12 4-20 12-26z" fill="var(--card)" {...S} />
          <rect x="68" y="40" width="64" height="12" rx="5" fill="var(--card)" {...S} />
          {[[82, 112], [100, 112], [118, 112], [91, 100], [109, 100]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="8" fill={grad} {...S} strokeWidth={2} />
          ))}
          <circle cx="100" cy="24" r="8" fill={grad} {...S} strokeWidth={2} />
          <path d="M100 13v-4" {...S} strokeWidth={2} />
          <Sparkle x={146} y={58} />
        </>
      );
    case "letter":
      return (
        <>
          <rect x="50" y="46" width="100" height="70" rx="10" fill="var(--card)" {...S} />
          <path d="M52 50l48 36 48-36" fill="none" {...S} />
          <path d="M100 96c-10-8-16-12-16-19 0-5 4-8 8-8 3 0 6 2 8 5 2-3 5-5 8-5 4 0 8 3 8 8 0 7-6 11-16 19z" fill={grad} />
          <circle cx="146" cy="44" r="14" fill="var(--card)" {...S} />
          <path d="M146 36v8l6 4" {...S} fill="none" />
          <Sparkle x={42} y={40} r={4} />
        </>
      );
    case "vote":
      return (
        <>
          <path d="M44 40h64a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H70l-14 12v-12H44a10 10 0 0 1-10-10V50a10 10 0 0 1 10-10z" fill="var(--card)" {...S} />
          <path d="M62 64l8 8 16-16" fill="none" {...S} stroke="var(--me)" strokeWidth={4} />
          <path d="M96 64h60a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10h-10v12l-14-12H96a10 10 0 0 1-10-10V74a10 10 0 0 1 10-10z" fill="var(--card)" {...S} />
          <text x="126" y="99" textAnchor="middle" fontSize="28" fontWeight="800" fill="var(--they)" fontFamily="var(--display)">?</text>
          <Sparkle x={160} y={42} />
        </>
      );
    case "cards":
      return (
        <>
          <rect x="44" y="44" width="92" height="58" rx="10" fill={grad} transform="rotate(-10 90 73)" {...S} />
          <rect x="66" y="62" width="92" height="58" rx="10" fill="var(--card)" {...S} />
          {Array.from({ length: 13 }, (_, i) => (
            <rect key={i} x={78 + i * 5.2} y="80" width={i % 3 === 0 ? 3 : 1.6} height="26" fill="var(--text)" />
          ))}
          <Sparkle x={160} y={50} />
        </>
      );
    case "notes":
      return (
        <>
          <rect x="60" y="30" width="72" height="96" rx="10" fill="var(--card)" {...S} />
          {[0, 1, 2, 3, 4].map((i) => <circle key={i} cx="60" cy={44 + i * 17} r="4" fill="var(--bg)" {...S} strokeWidth={2.5} />)}
          <path d="M76 52h40M76 66h40M76 80h26" {...S} opacity={0.45} />
          <g transform="rotate(35 128 88)">
            <rect x="120" y="44" width="14" height="70" rx="4" fill={grad} {...S} strokeWidth={2.5} />
            <path d="M120 114l7 14 7-14" fill="var(--card)" {...S} strokeWidth={2.5} />
          </g>
          <Sparkle x={48} y={34} r={4} />
        </>
      );
    case "photos":
      return (
        <>
          <g transform="rotate(-9 80 80)">
            <rect x="44" y="38" width="70" height="82" rx="6" fill="var(--card)" {...S} />
            <rect x="52" y="46" width="54" height="50" rx="3" fill="var(--me)" opacity="0.35" />
          </g>
          <g transform="rotate(8 120 76)">
            <rect x="88" y="32" width="70" height="82" rx="6" fill="var(--card)" {...S} />
            <rect x="96" y="40" width="54" height="50" rx="3" fill={grad} />
            <path d="M123 76c-7-6-11-8-11-13 0-3 3-6 6-6 2 0 4 1 5 3 1-2 3-3 5-3 3 0 6 3 6 6 0 5-4 7-11 13z" fill="#fff" />
          </g>
          <Sparkle x={160} y={30} />
        </>
      );
    case "goal":
      return (
        <>
          <path d="M30 124l44-62 24 30 18-22 54 54z" fill="var(--card)" {...S} />
          <path d="M116 70V28" {...S} />
          <path d="M116 30h28l-8 10 8 10h-28" fill={grad} {...S} strokeWidth={2.5} />
          <path d="M48 118c14-4 22-14 30-26" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" />
          <Sparkle x={160} y={70} />
        </>
      );
    case "match":
      return (
        <>
          <path d="M84 118c-26-20-40-32-40-50 0-12 9-21 20-21 8 0 15 5 20 11 5-6 12-11 20-11 11 0 20 9 20 21 0 18-14 30-40 50z" fill="var(--me)" opacity="0.9" />
          <path d="M118 112c-22-17-34-27-34-42 0-10 8-18 17-18 7 0 13 4 17 9 4-5 10-9 17-9 9 0 17 8 17 18 0 15-12 25-34 42z" fill="var(--they)" opacity="0.9" />
          <Sparkle x={150} y={36} r={6} />
          <Sparkle x={44} y={40} r={4} />
          <Sparkle x={160} y={118} r={4} />
        </>
      );
    case "popcorn":
      return (
        <>
          {[[76, 48], [92, 38], [110, 40], [126, 50], [100, 54], [84, 60], [118, 62]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="12" fill="var(--card)" {...S} strokeWidth={2.5} />
          ))}
          <path d="M66 66h68l-10 60H76z" fill="var(--card)" {...S} />
          <path d="M84 66l4 60M100 66v60M116 66l-4 60" stroke="var(--they)" strokeWidth="6" />
          <path d="M66 66h68l-10 60H76z" fill="none" {...S} />
          <Sparkle x={150} y={40} />
        </>
      );
    case "map":
      return (
        <>
          <path d="M40 48l38-12 44 12 38-12v76l-38 12-44-12-38 12z" fill="var(--card)" {...S} />
          <path d="M78 36v76M122 48v76" {...S} opacity={0.4} />
          <path d="M58 96c14-6 24 6 38-4s24-2 36-10" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" />
          <path d="M132 78c-10-12-14-18-14-24a14 14 0 0 1 28 0c0 6-4 12-14 24z" fill={grad} {...S} strokeWidth={2.5} />
          <circle cx="132" cy="54" r="4" fill="#fff" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="50" y="38" width="100" height="88" rx="12" fill="var(--card)" {...S} />
          <path d="M50 60h100" {...S} />
          <rect x="50" y="38" width="100" height="22" rx="12" fill={grad} opacity="0.9" />
          <path d="M74 30v16M126 30v16" {...S} />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={62 + (i % 4) * 20} y={70 + Math.floor(i / 4) * 17} width="10" height="8" rx="2" fill={i === 6 ? "var(--they)" : "var(--card-3)"} />
          ))}
          <Sparkle x={160} y={36} />
        </>
      );
    case "chat":
      return (
        <>
          <path d="M52 36h96a14 14 0 0 1 14 14v40a14 14 0 0 1-14 14h-58l-22 18v-18h-16a14 14 0 0 1-14-14V50a14 14 0 0 1 14-14z" fill="var(--card)" {...S} />
          <text x="100" y="86" textAnchor="middle" fontSize="40" fontWeight="800" fill={grad} fontFamily="var(--display)">?</text>
          <Sparkle x={166} y={32} />
          <Sparkle x={40} y={120} r={4} />
        </>
      );
    case "hourglass":
      return (
        <>
          <path d="M72 30h56M72 126h56" {...S} strokeWidth={4} />
          <path d="M78 32c0 26 22 30 22 46s-22 20-22 46h44c0-26-22-30-22-46s22-20 22-46z" fill="var(--card)" {...S} />
          <path d="M86 118c4-10 10-12 14-16 4 4 10 6 14 16z" fill={grad} />
          <path d="M90 50h20c-2 8-8 12-10 16-2-4-8-8-10-16z" fill={grad} opacity="0.7" />
          <Sparkle x={148} y={44} />
        </>
      );
    case "invite":
      return (
        <>
          <rect x="34" y="40" width="44" height="80" rx="10" fill="var(--card)" {...S} />
          <rect x="122" y="40" width="44" height="80" rx="10" fill="var(--card)" {...S} />
          <circle cx="56" cy="72" r="10" fill="var(--me)" />
          <circle cx="144" cy="72" r="10" fill="var(--they)" />
          <path d="M84 60c10-14 22-14 32 0" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeDasharray="2 6" strokeLinecap="round" />
          <path d="M100 104c-9-7-14-10-14-16 0-4 3-7 7-7 3 0 5 2 7 4 2-2 4-4 7-4 4 0 7 3 7 7 0 6-5 9-14 16z" fill={grad} />
          <Sparkle x={100} y={40} r={5} />
        </>
      );
  }
}

export function Art({ name, size = 180 }: { name: ArtName; size?: number }) {
  const g = `art${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 200 150" aria-hidden style={{ display: "block", margin: "0 auto", overflow: "visible" }}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--rose)" />
        </linearGradient>
      </defs>
      <circle cx="80" cy="82" r="58" fill="var(--me)" opacity="0.14" />
      <circle cx="124" cy="70" r="52" fill="var(--they)" opacity="0.14" />
      {scene(name, g)}
    </svg>
  );
}
