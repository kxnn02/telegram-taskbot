import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Contract tests against the real Supabase project are slow, need
    // network access, and require live credentials — they run separately
    // via `npm run test:live` (see vitest.live.config.ts), never as part
    // of the fast default suite CI runs on every push/PR.
    exclude: ["**/node_modules/**", "src/**/*.live.test.ts"],
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
  resolve: {
    conditions: ["node"],
  },
});
