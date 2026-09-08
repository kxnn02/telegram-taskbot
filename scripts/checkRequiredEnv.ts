import "dotenv/config";
import { findMissingEnv, formatMissingEnvReport, REQUIRED_ENV, type DeployEnvironment } from "../src/config/requiredEnv.js";

/**
 * Build-time gate for issue #142 / #154 / #156: fails the deployment when a
 * required environment variable is missing, so a broken build never serves a
 * request and the previous working deployment stays live. Mirrors the
 * `scripts/checkMigrationsApplied.ts` / `src/migrations/migrationDrift.ts`
 * split — this file does the I/O (reading `process.env`, printing, exiting);
 * `src/config/requiredEnv.ts` is the pure, unit-tested module.
 *
 * Only runs against Vercel's own `production` and `preview` builds. Any other
 * value of VERCEL_ENV — including unset, which is what CI and local dev see
 * — skips the check, since those builds don't have the deployment's real
 * environment variables available anyway.
 */

function main() {
  const vercelEnv = process.env.VERCEL_ENV;

  if (vercelEnv !== "production" && vercelEnv !== "preview") {
    console.log(
      `Skipping required-env check: VERCEL_ENV is ${JSON.stringify(vercelEnv ?? "")}, not "production" or "preview".`,
    );
    return;
  }

  const environment: DeployEnvironment = vercelEnv;
  console.log(`Running required-env check for ${environment}.`);

  const missing = findMissingEnv(REQUIRED_ENV, environment, process.env);

  if (missing.length > 0) {
    console.error(formatMissingEnvReport(environment, missing));
    process.exit(1);
  }

  console.log(`${REQUIRED_ENV.filter((entry) => entry.environments.includes(environment)).length} required variable(s) present for ${environment}.`);
}

main();
