import loadingAsset from "@/assets/loading.svg.asset.json";

export function RouteLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
      <img
        src={loadingAsset.url}
        alt=""
        aria-hidden="true"
        className="size-8 md:size-14 animate-spin [animation-duration:1.4s]"
      />
      <p className="font-display text-xl md:text-2xl uppercase tracking-wide text-foreground leading-none">
        Loading
      </p>
    </div>
  );
}
