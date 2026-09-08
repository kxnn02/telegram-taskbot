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

### Which variable means what

`BOT_TOKEN` is **not** "the production bot". It means *the bot whichever instance
is reading it runs as*: the real bot inside production's Vercel environment, the
dry-run bot inside the `dry-run` branch's, and — deliberately — the dry-run bot in
a local `.env`, because every local code path reads it (`npm run dev`,
`src/jobs/buildJobDeps.ts`, `api/telegram/webhook.ts`, and the dashboard's settings
routes via `src/web/nextDashboardDeps.ts`). A local `BOT_TOKEN` pointed at
production would let a local dashboard's **Test Standup** post into the live cohort
group.

To *talk about* production from a local machine — `getMe`, `getWebhookInfo`,
`getChat`, or `webhook:register --target production` — use **`PROD_BOT_TOKEN` /
`PROD_BOT_USERNAME`**. Nothing in `src/` or `api/` reads those names, so they
cannot change what any deployment does.

The same applies to `ACTIVE_COHORT_ID`: it is the cohort binding for the instance
reading it, and it is the *only* thing separating dry-run data from live data —
both cohorts share one Supabase project (ADR-0004). A local `.env` must set it to
`cohort5-dryrun`; `cohort-5` there points a local dashboard at the real roster and
the real tasks.

Each target reads a fully disjoint set of variables, so no single edit can move
both loops. `envNamesFor` in `src/ops/webhookRegistration.ts` is the one place that
mapping is written down, and a unit test asserts the two sets do not intersect:

|                | production                | dry run                  |
| -------------- | ------------------------- | ------------------------ |
| token          | `PROD_BOT_TOKEN`          | `DRYRUN_BOT_TOKEN`       |
| username       | `PROD_BOT_USERNAME`       | `DRYRUN_BOT_USERNAME`    |
| URL            | `PRODUCTION_DEPLOYMENT_URL` | `DRYRUN_DEPLOYMENT_URL`  |
| webhook secret | `TELEGRAM_WEBHOOK_SECRET` | `DRYRUN_WEBHOOK_SECRET`  |

`planWebhookRegistration` refuses when a target's token resolves to the *other*
target's bot, not just when it disagrees with its own target's username. That extra
check exists because the pair can be wrong together: when `BOT_TOKEN` and
`BOT_USERNAME` were both moved to the test bot, the token-vs-username check agreed
with itself and `--target production --check` cheerfully reported that production's
webhook pointed at the dry-run deployment. It did not.

### Checking the split is intact

Neither command writes anything:

```bash
npm run webhook:register -- --target production --check
npm run webhook:register -- --target dry-run --check
```

Expect two different bots, two different URLs, and each `current:` line matching its
own target. Both webhooks are live at the same time — that is the whole point of the
second bot (ADR-0011). If the dry-run bot reports `(none)`, the dry-run loop is down
and nothing you send to it will be answered; re-register it with step 6 below.

---

## Part 1 — one-time setup

Do this once. Steps 1-3 are manual (BotFather and the Vercel dashboard have no CLI path worth
scripting for a one-off); steps 4-6 are commands.

### 1. Create the dry-run bot

In [@BotFather](https://t.me/BotFather):

1. `/newbot` — name it something unmistakable, e.g. **DevCon Cohort 5 Taskbot (dry run)**, with a
   username ending in `_dryrun_bot`. Copy the token it gives you.
2. `/setprivacy` → pick the new bot → **Disable**. This is not optional: with privacy mode on, the
   bot cannot see plain (non-`/command`) messages in a group, and the `@`-mention trigger and
   bulk-paste task extraction both read exactly those. The production bot has privacy disabled, so
   leaving it on would make dry runs pass on flows that are broken in production.
3. Optional but recommended: give it a `(dry run)` display name or a different picture, so the two
   bots are never mistaken for each other in a chat list.

### 2. Put it in the dump group

1. Add the new bot to your dump group.
2. Give it **the same admin status the production bot has in the live Cohort 5 group** — check the
   live group's administrator list and mirror it. Making it an admin when production's bot is not
   would mask privacy-mode and permission bugs; making it a plain member when production's is an
   admin would produce failures production would not have.
3. Both dry-run test accounts (`DRYRUN_HIGHERUP_USERNAME`, `DRYRUN_INTERN_USERNAME`) should still
   be in the group so group-chat command tests have someone to run them — `/start` itself no
   longer checks group membership (ADR-0013 removed that gate along with every other access
   check), but the group needs real members to be a realistic test of group-chat behaviour.

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

### 7. Register the Login Widget domain (dashboard access)

Separate from the webhook, and easy to forget because nothing above touches it: the dashboard's
sign-in page uses the Telegram Login Widget, and Telegram refuses it with **"Bot domain invalid"**
until the dry-run bot's domain is registered in BotFather. There is no API for this — it's a
one-time manual step per bot, done once and then persistent (BotFather remembers it across
redeploys; you do not need to repeat this unless you rotate to a new dry-run bot).

In [@BotFather](https://t.me/BotFather):

1. Send `/setdomain`.
2. Pick the dry-run bot from the list it shows (not the production bot — easy to mix up when both
   are in the same chat history).
3. When it asks for the domain, send **exactly** the branch alias from step 3 above, with no
   `https://`, no trailing slash, no path — e.g. `telegram-taskbot-git-dry-run-kxnn02s-projects.vercel.app`.
4. Confirm BotFather's reply names the right bot: "Success! Domain updated."

**If the login page still shows "Bot domain invalid" right after this:** it's near-always
propagation delay on Telegram's side (up to a minute or two), sometimes compounded by the browser
caching the failed widget iframe from before the fix. Wait ~60 seconds, then retry in a fresh
incognito/private window before assuming anything is actually broken.

Do this before the first time anyone tries to log into the dry-run dashboard — not after hitting
the error, which is what makes it feel like it "always" comes up.

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

- `/start` from an account that has never messaged the bot before — auto-registration.
- `/help` — it is where a missing or renamed command shows up first.
- `/addtask` in its one-line form (with `!priority`, `by <date>`, `@username`, `@all`) **and**
  bare, which should return a usage example, not a form. Also try the `@`-mention trigger and a
  multi-line/multi-mention paste, to exercise bulk-paste extraction.
- `/tasks`, `/deadlines`, `/standup` — long replies are chunked; check nothing is cut mid-message,
  and that `/tasks`/`/standup`'s inline filter and paging buttons still edit the message in place.
- `/update`, `/done`, `/complete`/`/completed` — the status transitions, including
  `/update <ref> blocked note:...` for blocking a task.
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
   This reads `PROD_BOT_TOKEN`, not `BOT_TOKEN`, so it reports on the real bot even from a
   machine whose `BOT_TOKEN` is the test bot. If `PROD_BOT_TOKEN` is unset it fails saying so,
   rather than reporting on whichever bot happens to be configured.
