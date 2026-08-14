import asset from "@/assets/dashboard3.svg.asset.json";

export function CollectorIllustration({ className }: { className?: string }) {
  return <img src={asset.url} alt="Vintage baseball card collector illustration" className={className} />;
}
