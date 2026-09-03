# Runbook: the dry-run loop

Every change reaches the live Cohort 5 group the moment its PR merges — Vercel deploys `main` to
production automatically (ADR-0005). The dry-run loop is the step before that: the same code,
deployed to the `dry-run` branch, driven by a **separate bot** in a **dump group**, against a
**separate cohort** in the same Supabase project. See
[ADR-0011](../adr/0011-post-cutover-dry-run-loop.md) for why it works this way.

Two bots exist and must never be confused:

|          | production                              | dry run                                       |
| -------- | --------------------------------------- | --------------------------------------------- |
| bot      | `@devcon_cohort5_taskbot`               | the second BotFather bot (`DRYRUN_BOT_USERNAME`) |
| group    | the live Cohort 5 group                 | the dump group you control                    |
| cohort   | `ACTIVE_COHORT_ID` (`cohort-5`)         | `DRYRUN_COHORT_ID` (`cohort5-dryrun`)         |
| branch   | `main`                                  | `dry-run`                                     |
| URL      | `https://telegram-taskbot-ten.vercel.app` | the `dry-run` branch deployment              |

---

## Part 1 — one-time setup

Do this once. Steps 1-3 are manual (BotFather and the Vercel dashboard have no CLI path worth
scripting for a one-off); steps 4-6 are commands.

### 1. Create the dry-run bot

In [@BotFather](https://t.me/BotFather):

1. `/newbot` — name it something unmistakable, e.g. **DevCon Cohort 5 Taskbot (dry run)**, with a
   username ending in `_dryrun_bot`. Copy the token it gives you.
2. `/setprivacy` → pick the new bot → **Disable**. This is not optional: with privacy mode on, the
   bot cannot see plain (non-`/command`) messages in a group, and every wizard step — the
   step-by-step `/addtask` form, `/edit`, the due-date confirmation — reads exactly those. The
   production bot has privacy disabled, so leaving it on would make dry runs pass on flows that
   are broken in production.
3. Optional but recommended: give it a `(dry run)` display name or a different picture, so the two
   bots are never mistaken for each other in a chat list.

### 2. Put it in the dump group

1. Add the new bot to your dump group.
2. Give it **the same admin status the production bot has in the live Cohort 5 group** — check the
   live group's administrator list and mirror it. Making it an admin when production's bot is not
   would mask privacy-mode and permission bugs; making it a plain member when production's is an
   admin would produce failures production would not have.
3. Make sure both dry-run test accounts (`DRYRUN_HIGHERUP_USERNAME`, `DRYRUN_INTERN_USERNAME`) are
   in the group — `/start` checks group membership before it will register anyone (ADR-0010).

Then get the group's chat id. Send any message in the dump group, then:

```bash
curl -s "https://api.telegram.org/bot<DRYRUN_BOT_TOKEN>/getUpdates"
```

Look for `"chat":{"id":-100…}` — that negative number is `DRYRUN_GROUP_CHAT_ID`. Do this *before*
registering the webhook: `getUpdates` and a registered webhook are mutually exclusive.

### 3. Set the `dry-run` branch's Vercel environment

In the Vercel dashboard → Settings → Environment Variables, add these for the **Preview**
environment, scoped to the **`dry-run` branch specifically** (not all previews):

| variable                  | value                                     |
| ------------------------- | ----------------------------------------- |
| `BOT_TOKEN`               | the dry-run bot's token                   |
| `BOT_USERNAME`            | the dry-run bot's username, no `@`        |
| `TELEGRAM_WEBHOOK_SECRET` | a fresh secret, **not** production's      |
| `ACTIVE_COHORT_ID`        | `cohort5-dryrun`                          |

Everything else (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the job secrets, …) is inherited —
the dry run deliberately shares the one Supabase project and is isolated by cohort, not by
database (ADR-0004).

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

While you are in Settings, note two values you will need locally:

- **Deployment Protection → Protection Bypass for Automation** → `VERCEL_PROTECTION_BYPASS`.
  Deployment protection is on for every non-custom domain on this project, so without this the
  webhook URL returns Vercel's SSO page and Telegram never reaches the function.
- The `dry-run` branch's deployment URL (Deployments → filter by branch), of the form
  `https://telegram-taskbot-git-dry-run-<scope>.vercel.app` → `DRYRUN_DEPLOYMENT_URL`. It is
  stable across redeploys of the branch, which is why the webhook is only registered once.

### 4. Fill in your local `.env`

From `.env.example`: `DRYRUN_BOT_TOKEN`, `DRYRUN_BOT_USERNAME`, `DRYRUN_DEPLOYMENT_URL`,
`DRYRUN_WEBHOOK_SECRET` (the same value you put in Vercel), `DRYRUN_GROUP_CHAT_ID`,
`DRYRUN_HIGHERUP_USERNAME`, `DRYRUN_INTERN_USERNAME`, plus `PRODUCTION_DEPLOYMENT_URL` and
`VERCEL_PROTECTION_BYPASS`.

### 5. Seed the dry-run cohort

```bash
npm run seed:roster
```

Defaults to the dry-run cohort only and will not touch live rows. It creates the `cohort5-dryrun`
cohort pointing at the dump group, plus its two roster entries.

### 6. Register the dry-run webhook

```bash
npm run webhook:register -- --target dry-run --check   # prints the plan, writes nothing
npm run webhook:register -- --target dry-run
```

The script resolves `DRYRUN_BOT_TOKEN` through `getMe` and refuses to write if the token turns out
to belong to a bot other than `DRYRUN_BOT_USERNAME`, or if the URL is production's. Secrets are
masked in its output.

Confirm the loop is alive by sending `/whoami` in the dump group.

---

## Part 2 — the loop, per change

```bash
# 1. Put the branch under test on the dry-run deployment.
git push --force-with-lease origin HEAD:dry-run

# 2. Wait for the Vercel deployment of `dry-run` to go READY.

# 3. Exercise it in the dump group (smoke list below).

# 4. Only then open/merge the PR into main.
```

`dry-run` is a **deploy target, not a line of development**: it is force-pushed, holds exactly one
thing under test at a time, and is never merged *from*. Use `--force-with-lease` rather than
`--force` so you find out if something else had been put under test.

The webhook does not need re-registering — the branch domain is stable.

### Smoke list

Cover what unit tests structurally cannot: real Telegram rendering, real group behaviour, and
multi-step state. At minimum, as **both** test accounts:

- `/start` from an account not yet registered in the dry-run cohort — the group-membership gate.
- `/help` — the reply differs by role, and it is where a missing command shows up first.
- `/addtask` in its one-line form **and** bare, walking the whole step-by-step wizard including the
  due-date confirmation. Wizards are the flows most likely to break invisibly.
- `/tasks`, `/mytasks`, `/task <ref>` — long replies are chunked; check nothing is cut mid-message.
- `/update`, `/done`, `/complete`, `/blocked`, `/unblock` — the status transitions.
- `/roster` as a group admin and as a non-admin — the admin gate.
- Whatever the change itself touched, plus the command menu (type `/` and confirm the list matches
  what you expect).

The question the loop answers is the one CI cannot: *does a human using this in a real group get a
sensible result?*

---

## Part 3 — when production breaks anyway

1. **Roll the code back first.** Vercel dashboard → Deployments → the last known-good production
   deployment → **Promote to Production** (Instant Rollback). Faster than reverting a commit and
   rebuilding, and it does not wait on CI.
2. **Then revert on `main`**, so the next deploy does not reinstate the bad build.
3. **A rollback does not undo a migration.** If the bad deploy shipped alongside a schema change,
   the rolled-back code is now running against the new schema — check `supabase/migrations/` for
   anything applied recently and decide explicitly whether it needs a compensating migration.
4. **Do not repoint the production webhook** as a reflex. It is almost never the problem, and
   `--confirm-production` exists to make that a decision. Check first, without writing anything:

   ```bash
   npm run webhook:register -- --target production --check
   ```

   It prints the currently registered URL (secrets masked) and Telegram's last delivery error.
