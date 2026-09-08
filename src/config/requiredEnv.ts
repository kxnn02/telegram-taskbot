export type DeployEnvironment = "production" | "preview";

export interface RequiredEnvVar {
  name: string;
  environments: DeployEnvironment[];
  why: string;
}

const BOTH: DeployEnvironment[] = ["production", "preview"];

/**
 * Every environment variable whose absence breaks a *deployed* code path
 * (issue #142). The single source of truth for the build-time gate in
 * `scripts/checkRequiredEnv.ts`; the README's table points here rather than
 * repeating it.
 *
 * Deliberately not derived from `.env.example`, which also documents
 * local-only, script-only and historical names (`GROUP_CHAT_ID` is
 * explicitly no longer read, `DRYRUN_*` belong to a laptop, `PROD_*` are
 * read only by `scripts/registerWebhook.ts`). A name earns a place here only
 * if a request served by `api/**` or `app/**` fails without it.
 */
export const REQUIRED_ENV: RequiredEnvVar[] = [
  { name: "BOT_TOKEN", environments: BOTH, why: "webhook, every /api/jobs/* endpoint, dashboard" },
  { name: "TELEGRAM_WEBHOOK_SECRET", environments: BOTH, why: "webhook secret-header check (ADR-0004)" },
  { name: "ACTIVE_COHORT_ID", environments: BOTH, why: "binds this deployment to one cohort" },
  { name: "SUPABASE_URL", environments: BOTH, why: "every store" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", environments: BOTH, why: "every store" },
  { name: "BOT_USERNAME", environments: BOTH, why: "dashboard Telegram Login Widget" },
  { name: "SESSION_SECRET", environments: BOTH, why: "dashboard session cookie (ADR-0008)" },
  { name: "INTERNAL_JOB_SECRET", environments: BOTH, why: "pg_net-triggered /api/jobs/* auth" },
  { name: "MAINTAINER_USERNAME", environments: BOTH, why: "self-DM-on-error target (ADR-0007)" },
  { name: "CRON_SECRET", environments: BOTH, why: "Vercel-Cron-triggered keep-alive and weekly-backup" },
  { name: "GROQ_API_KEY", environments: BOTH, why: "language parser; issue #142's own outage" },
  { name: "BACKUP_GITHUB_TOKEN", environments: ["production"], why: "weekly backup commits" },
  { name: "BACKUP_GITHUB_REPO", environments: ["production"], why: "weekly backup destination" },
];

export function findMissingEnv(
  required: RequiredEnvVar[],
  environment: DeployEnvironment,
  env: Record<string, string | undefined>,
): string[] {
  return required
    .filter((entry) => entry.environments.includes(environment))
    .filter((entry) => !(env[entry.name] ?? "").trim())
    .map((entry) => entry.name);
}

export function formatMissingEnvReport(
  environment: DeployEnvironment,
  missing: string[],
): string {
  const lines: string[] = [];
  lines.push(`Missing required environment variable(s) for ${environment}:`);
  for (const name of missing) {
    const entry = REQUIRED_ENV.find((candidate) => candidate.name === name);
    lines.push(`  ${name} — ${entry?.why ?? "required for this deployment"}`);
  }
  lines.push(
    `Add the missing variable(s) to the Vercel project's settings for ${environment} and redeploy.`,
  );
  return lines.join("\n");
}
