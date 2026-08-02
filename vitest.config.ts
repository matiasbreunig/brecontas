import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // tsconfigPaths resolves the "@/*" alias the same way Next does.
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
    // Same zone the container runs in, so date tests mean the same thing here
    // and in production.
    env: { TZ: "America/Sao_Paulo" },
  },
});
