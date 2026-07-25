import { useEffect, useRef } from "react";

const SCRIPT_SRC = "https://media.ethicalads.io/media/client/ethicalads.min.js";
const PUBLISHER_ID = import.meta.env.VITE_ETHICALADS_PUBLISHER_ID as string | undefined;

declare global {
  interface Window {
    ethicalads?: { load?: () => void };
  }
}

function loadScript() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
    window.ethicalads?.load?.();
    return;
  }
  const s = document.createElement("script");
  s.src = SCRIPT_SRC;
  s.async = true;
  s.onload = () => window.ethicalads?.load?.();
  document.head.appendChild(s);
}

export function EthicalAd({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!PUBLISHER_ID) return;
    loadScript();
  }, []);

  if (!PUBLISHER_ID) return null;

  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Ad</p>
      <div
        ref={ref}
        data-ea-publisher={PUBLISHER_ID}
        data-ea-type="image"
      />
    </div>
  );
}
