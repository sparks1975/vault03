// Vintage baseball-card style line illustration used on the dashboard stats panel.
// Loads the original uploaded artwork so it stays exactly as provided.
export function CollectorIllustration({ className }: { className?: string }) {
  return (
    <img
      src="/app_dashboard_snapshot.svg"
      alt="Vintage baseball card collector illustration"
      className={className}
      loading="eager"
    />
  );
}
