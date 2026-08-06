import asset from "@/assets/app_dashboard_snapshot.svg.asset.json";

export function CollectorIllustration({ className }: { className?: string }) {
  return <img src={asset.url} alt="Vintage baseball card collector illustration" className={className} />;
}
