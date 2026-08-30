import "dotenv/config";
import { createBot } from "./createBot.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}

const bot = createBot({
  token,
  dbPath: process.env.DATABASE_PATH ?? "./data/taskbot.sqlite",
  rosterPath: process.env.ROSTER_PATH ?? "roster.config.json",
  dashboardUrl:
    process.env.DASHBOARD_URL ?? "https://example.com/dashboard-coming-soon",
});

bot.start();
// eslint-disable-next-line no-console
console.log("Bot started.");
