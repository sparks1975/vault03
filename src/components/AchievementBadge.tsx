import championAsset from "@/assets/badge-champion.svg.asset.json";
import podiumAsset from "@/assets/badge-podium.svg.asset.json";
import topTenAsset from "@/assets/badge-top_10.svg.asset.json";
import firstEntryAsset from "@/assets/badge-first_entry.svg.asset.json";

const ART: Record<string, string> = {
  champion: championAsset.url,
  podium: podiumAsset.url,
  top_10_pct: topTenAsset.url,
  first_entry: firstEntryAsset.url,
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
  const src = ART[type] ?? ART.first_entry;

  return (
    <div
      className="flex w-[112px] flex-col items-center text-center"
      title={title}
    >
      <div
        className="flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <img
          src={src}
          alt={`${label} award`}
          loading="lazy"
          className="h-full w-full object-contain"
        />
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
