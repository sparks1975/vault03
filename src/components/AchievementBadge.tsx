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

// Every plate stays well inside the viewBox so outlines cannot clip.
const PATHS: Record<BadgeShape, string> = {
  shield: "M18 18H102V82C102 100 77 111 60 119C43 111 18 100 18 82Z",
  hexagon: "M60 16L102 39V93L60 116L18 93V39Z",
  circle: "M60 16A50 50 0 1 0 60 116A50 50 0 1 0 60 16Z",
  ribbon: "M20 16H100V116L60 94L20 116Z",
};

type Tone = {
  outline: string;
  face: string;
  icon: string;
};

const TONES: Record<string, Tone> = {
  champion: {
    outline: "var(--badge-champion)",
    face: "var(--badge-face)",
    icon: "var(--badge-icon)",
  },
  podium: {
    outline: "var(--badge-podium)",
    face: "var(--badge-face)",
    icon: "var(--badge-icon)",
  },
  top_10_pct: {
    outline: "var(--badge-top-ten)",
    face: "var(--badge-face)",
    icon: "var(--badge-icon)",
  },
  first_entry: {
    outline: "var(--badge-first-entry)",
    face: "var(--badge-face)",
    icon: "var(--badge-icon)",
  },
};

export function AchievementBadge({
  type,
  label,
  sublabel,
  title,
  size = 92,
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

  return (
    <div
      className="flex w-[112px] flex-col items-center text-center"
      title={title}
    >
      <div
        className="relative"
        style={{ width: size, height: (size * 132) / 120 }}
      >
        <svg viewBox="0 0 120 132" className="h-full w-full">
          {/* Flat outer plate and thin inset line, matching the reference. */}
          <path
            d={d}
            fill={t.face}
            stroke={t.outline}
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <g transform="translate(60 66) scale(0.84) translate(-60 -66)">
            <path
              d={d}
              fill="none"
              stroke={t.outline}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </g>
        </svg>

        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Icon
            style={{
              width: size * 0.32,
              height: size * 0.32,
              color: t.icon,
            }}
            strokeWidth={3}
          />
        </span>
      </div>

      {sublabel ? (
        <span className="mt-2 text-[10px] font-semibold leading-tight text-muted-foreground">
          {sublabel}
        </span>
      ) : null}
      <span className={`${sublabel ? "mt-1" : "mt-2"} text-[11px] font-black uppercase leading-tight tracking-wider`}>
        {label}
      </span>
    </div>
  );
}
