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

const PATHS: Record<BadgeShape, string> = {
  // 100x112 viewBox
  shield: "M8 6h84v66c0 18-30 28-42 34C38 100 8 90 8 72Z",
  hexagon: "M50 4l40 23v50L50 100 10 77V27Z",
  circle: "M50 8a48 48 0 1 0 0 96 48 48 0 1 0 0-96Z",
  ribbon: "M10 4h80v104L50 82 10 108Z",
};

export function AchievementBadge({
  type,
  label,
  sublabel,
  title,
  size = 84,
}: {
  type: string;
  label: string;
  sublabel?: string;
  title?: string;
  size?: number;
}) {
  const shape = SHAPES[type] ?? "shield";
  const Icon = ICONS[type] ?? Star;
  const gold = type === "champion";

  return (
    <div className="flex flex-col items-center text-center w-[92px]" title={title}>
      <div
        className="relative drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
        style={{ width: size, height: (size * 112) / 100 }}
      >
        <svg viewBox="0 0 100 112" className="w-full h-full">
          <defs>
            <linearGradient id={`bg-${type}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.24 0.02 280)" />
              <stop offset="100%" stopColor="oklch(0.14 0.01 280)" />
            </linearGradient>
          </defs>
          {/* outer accent frame */}
          <path
            d={PATHS[shape]}
            fill="none"
            strokeWidth="7"
            className={gold ? "stroke-amber-400" : "stroke-primary"}
          />
          {/* inner plate */}
          <g transform="translate(50 56) scale(0.86) translate(-50 -56)">
            <path d={PATHS[shape]} fill={`url(#bg-${type})`} />
            <path
              d={PATHS[shape]}
              fill="none"
              strokeWidth="2"
              className={gold ? "stroke-amber-400/40" : "stroke-primary/40"}
            />
          </g>
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <Icon
            className={gold ? "text-amber-400" : "text-primary"}
            style={{ width: size * 0.36, height: size * 0.36 }}
            strokeWidth={2.25}
          />
        </span>
      </div>
      <span className="mt-2 text-[11px] font-black uppercase tracking-wider leading-tight">
        {label}
      </span>
      {sublabel ? (
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground leading-tight">
          {sublabel}
        </span>
      ) : null}
    </div>
  );
}
