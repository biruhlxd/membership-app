import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts so tests do not start the React Router plugin.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
