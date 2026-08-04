import { Trophy, Medal, Flame, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type BadgeShape = "shield" | "hexagon" | "circle" | "ribbon";

const ICONS: Record<string, LucideIcon> = {
  champion: Trophy,
  podium: Medal,
  top_10_pct: Flame,
  first_entry: Star,
};

const SHAPES: Record<string, BadgeShape> = {
  champion: "shield",
  podium: "hexagon",
  top_10_pct: "ribbon",
  first_entry: "circle",
};

// All paths drawn inside a 120x132 viewBox with a 14px safe margin so thick
// strokes and glows never clip.
const PATHS: Record<BadgeShape, string> = {
  shield: "M14 16h92v62c0 24-34 34-46 40-12-6-46-16-46-40Z",
  hexagon: "M60 14l46 26v52L60 118 14 92V40Z",
  circle: "M60 14a52 52 0 1 0 0 104 52 52 0 1 0 0-104Z",
  ribbon: "M18 14h84v104L60 92 18 118Z",
};

type Tone = {
  rimA: string;
  rimB: string;
  faceA: string;
  faceB: string;
  icon: string;
  glow: string;
};

const TONES: Record<string, Tone> = {
  champion: {
    rimA: "#FDE68A",
    rimB: "#B45309",
    faceA: "#3A2A08",
    faceB: "#15100A",
    icon: "#FCD34D",
    glow: "#F59E0B",
  },
  podium: {
    rimA: "#F8FAFC",
    rimB: "#64748B",
    faceA: "#2A2F3A",
    faceB: "#111418",
    icon: "#E2E8F0",
    glow: "#94A3B8",
  },
  top_10_pct: {
    rimA: "#FDBA74",
    rimB: "#C2410C",
    faceA: "#3A1D0C",
    faceB: "#160C06",
    icon: "#FB923C",
    glow: "#EA580C",
  },
  first_entry: {
    rimA: "#C4B5FD",
    rimB: "#5B21B6",
    faceA: "#241A45",
    faceB: "#100B1F",
    icon: "#A78BFA",
    glow: "#7C3AED",
  },
};

export function AchievementBadge({
  type,
  label,
  sublabel,
  title,
  size = 96,
}: {
  type: string;
  label: string;
  sublabel?: string;
  title?: string;
  size?: number;
}) {
  const shape = SHAPES[type] ?? "shield";
  const Icon = ICONS[type] ?? Star;
  const t = TONES[type] ?? TONES.first_entry;
  const d = PATHS[shape];
  const uid = `bdg-${type}-${shape}`;

  return (
    <div
      className="flex w-[104px] flex-col items-center text-center"
      title={title}
    >
      <div
        className="relative"
        style={{ width: size, height: (size * 132) / 120 }}
      >
        <svg viewBox="0 0 120 132" className="h-full w-full overflow-visible">
          <defs>
            <filter
              id={`${uid}-shadow`}
              x="-40%"
              y="-40%"
              width="180%"
              height="180%"
            >
              <feDropShadow
                dx="0"
                dy="4"
                stdDeviation="4"
                floodColor="#000000"
                floodOpacity="0.45"
              />
            </filter>
            <clipPath id={`${uid}-clip`}>
              <path d={d} />
            </clipPath>
          </defs>

          {/* outer glow */}
          <path
            d={d}
            fill="none"
            stroke={t.glow}
            strokeWidth="10"
            opacity="0.22"
            filter={`url(#${uid}-shadow)`}
          />

          {/* solid rim */}
          <g filter={`url(#${uid}-shadow)`}>
            <path
              d={d}
              fill="none"
              stroke={t.rimA}
              strokeWidth="8"
              strokeLinejoin="round"
            />
          </g>

          {/* recessed face */}
          <g transform="translate(60 66) scale(0.84) translate(-60 -66)">
            <path d={d} fill={t.faceA} />
            <g clipPath={`url(#${uid}-clip`}>
              <path
                d={d}
                fill="#FFFFFF"
                fillOpacity="0.08"
              />
            </g>
            <path
              d={d}
              fill="none"
              stroke={t.rimA}
              strokeOpacity="0.35"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </g>
        </svg>

        <span className="absolute inset-0 flex items-center justify-center">
          <Icon
            style={{
              width: size * 0.34,
              height: size * 0.34,
              color: t.icon,
              filter: `drop-shadow(0 0 6px ${t.glow})`,
            }}
            strokeWidth={2.5}
          />
        </span>
      </div>

      <span className="mt-2 text-[11px] font-black uppercase leading-tight tracking-wider">
        {label}
      </span>
      {sublabel ? (
        <span className="font-mono text-[9px] uppercase leading-tight tracking-widest text-muted-foreground">
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}
