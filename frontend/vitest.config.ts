import { defineConfig } from "vitest/config";

// Keep unit tests independent from the production Tailwind/Vite plugin graph.
// The CSS scanner is irrelevant here and may traverse outside the workspace.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
