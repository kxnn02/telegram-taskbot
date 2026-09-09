# Decision records

One file per architectural decision, in the order they were made. Each says what was decided,
what else was considered, and what it cost.

**You probably don't need to read these.** For what the bot does, read
[`USER_GUIDE.md`](../../USER_GUIDE.md). For how the code is shaped, read
[`CONTEXT.md`](../../CONTEXT.md). Come here when you want to know *why* a specific choice was
made — usually before changing it.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-replatform-to-vercel-supabase.md) | Run on Vercel + Supabase instead of a long-lived Node process | Live |
| [0002](./0002-authorization-stays-in-taskservice.md) | Permission checks live in `TaskService`, with RLS as a backstop | Superseded by 0013 |
| [0003](./0003-roster-moves-to-a-supabase-table.md) | The roster is a database table, not a JSON file | Live |
| [0004](./0004-webhook-transport-and-dry-run-strategy.md) | Telegram talks to us over a webhook; a dry-run cohort gates releases | Live |
| [0005](./0005-storage-port-testing-and-cicd.md) | One storage interface, two implementations (in-memory + Supabase); CI runs both | Live |
| [0006](./0006-database-schema-and-concurrency.md) | Table layout, and `row_version` for concurrent writes | Live |
| [0007](./0007-scheduled-jobs-and-operational-tasks.md) | Scheduled work runs on Supabase `pg_cron`, calling HTTP endpoints | Live |
| [0008](./0008-dashboard-sessions-and-mutations.md) | Dashboard sessions are a signed cookie; mutations are REST routes | Live |
| [0009](./0009-devie-parity-command-redesign.md) | One-line commands and six free-set statuses, copying Devie | Live |
| [0010](./0010-group-gated-registration-and-roster-management.md) | `/start` checks group membership before registering you | Superseded by 0013 |
| [0011](./0011-post-cutover-dry-run-loop.md) | The dry run gets its own bot, so both webhooks can be live at once | Live |
| [0012](./0012-migrations-applied-before-merge.md) | A migration reaches production before the code that needs it merges | Live |
| [0013](./0013-remove-access-control-for-devie-parity.md) | **Delete roles and permissions entirely**, copying Devie | Live |
| [0014](./0014-devie-parity-pass-2.md) | Seven parity gaps closed after a line-by-line re-read of Devie | Live |
| [0015](./0015-required-environment-variables-are-asserted-at-build-time.md) | A missing environment variable fails the build, not every request | Live |

"Superseded" records are kept, not deleted — they explain why the code once looked the way it did,
and their replacement links back to them.

## Adding one

Copy the shape of the most recent record: title, `Status`, `Date`, `Context`, `Decision`,
`Alternatives considered`, `Consequences`. Number it sequentially, add a row above, and link it
from the relevant section of `CONTEXT.md`.
