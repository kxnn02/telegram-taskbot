import "dotenv/config";
import { loadRoster } from "../config/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import { InMemoryTaskStore } from "../storage/inMemoryTaskStore.js";
import { createDashboardServer } from "./dashboardServer.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}
const botUsername = process.env.BOT_USERNAME;
if (!botUsername) {
  throw new Error("BOT_USERNAME is not set. Copy .env.example to .env and fill it in.");
}

const roster = loadRoster(process.env.ROSTER_PATH ?? "roster.config.json");
// TaskService talks only through the TaskStorePort (ADR-0005) now. The real
// Supabase adapter lands in Phase 2 (issue #13); until then this in-memory
// store is a deliberate, non-persistent placeholder — note it is a
// *separate* process from the bot's own in-memory store (createBot.ts), so
// running the bot and the dashboard side by side in this phase will not see
// each other's tasks. That gap closes once both share the same Supabase
// project.
const service = new TaskService(new InMemoryTaskStore(), roster, new SystemClock());

const app = createDashboardServer({ botToken: token, botUsername, roster, service });

const port = Number(process.env.DASHBOARD_PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard listening on port ${port}.`);
});
