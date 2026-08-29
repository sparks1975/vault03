import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone config: the app's vite.config.ts loads the TanStack Start plugin,
// which isn't needed (or safe) for plain unit tests of server-side helpers.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
