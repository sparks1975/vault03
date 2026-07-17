import { Loader2 } from "lucide-react";

export function RouteLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6">
      <Loader2 className="size-6 animate-spin text-accent" />
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Loading</p>
    </div>
  );
}
