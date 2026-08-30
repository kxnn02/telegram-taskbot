import "dotenv/config";
import { openDatabase } from "../db/schema.js";
import { loadRoster } from "../config/roster.js";
import { SystemClock } from "../domain/clock.js";
import { TaskService } from "../service/taskService.js";
import { createDashboardServer } from "./dashboardServer.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}
const botUsername = process.env.BOT_USERNAME;
if (!botUsername) {
  throw new Error("BOT_USERNAME is not set. Copy .env.example to .env and fill it in.");
}

const db = openDatabase(process.env.DATABASE_PATH ?? "./data/taskbot.sqlite");
const roster = loadRoster(process.env.ROSTER_PATH ?? "roster.config.json");
const service = new TaskService(db, roster, new SystemClock());

const app = createDashboardServer({ botToken: token, botUsername, roster, service });

const port = Number(process.env.DASHBOARD_PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard listening on port ${port}.`);
});
