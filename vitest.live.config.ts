import { defineConfig } from "vitest/config";

// Runs only the contract tests that hit the real Supabase project (ADR-0005:
// "the contract-test suite ... runs additionally on every push to main
// only"). Needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set — see
// supabaseTaskStore.live.test.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 20_000,
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
