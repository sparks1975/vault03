import { useEffect } from "react";
import { initNativeShell } from "@/lib/native";

/** Runs native-only setup (status bar, splash screen, safe areas) after hydration. */
export function NativeShell() {
  useEffect(() => {
    void initNativeShell();
  }, []);
  return null;
}
