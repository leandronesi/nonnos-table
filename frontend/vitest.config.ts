import { defineConfig } from "vitest/config";

// Keep unit tests independent from the production Tailwind/Vite plugin graph.
// The CSS scanner is irrelevant here and may traverse outside the workspace.
export default defineConfig({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "https://vitest.supabase.invalid"
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      "vitest-anon-key-not-a-secret"
    ),
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
