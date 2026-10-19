import "dotenv/config";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная ${name} (в .env или в настройках хостинга)`);
  return v;
}

// На Render адрес сервиса подставляется сам (RENDER_EXTERNAL_URL) — WEBAPP_URL можно не задавать
const publicUrl = (process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
if (!publicUrl) throw new Error("Не задан WEBAPP_URL — публичный HTTPS-адрес веб-апа");

export const config = {
  botToken: need("BOT_TOKEN"),
  webappUrl: publicUrl,
  port: Number(process.env.PORT ?? 3000),
  adminIds: (process.env.ADMIN_IDS ?? "")
    .split(",").map((s) => Number(s.trim())).filter(Boolean),
  // Админы по юзернейму (без @). Удобно, если не знаешь свой числовой ID
  adminUsernames: (process.env.ADMIN_USERNAMES ?? "")
    .split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
  // webhook — для хостинга (сервис просыпается от сообщений), polling — для локального запуска
  useWebhook: (process.env.BOT_MODE ?? (process.env.RENDER ? "webhook" : "polling")) === "webhook",
  dbPath: process.env.DB_PATH ?? "./casino.sqlite",
  minBet: Number(process.env.MIN_BET ?? 1),
  maxBet: Number(process.env.MAX_BET ?? 1000),
  devUserId: process.env.DEV_USER_ID ? Number(process.env.DEV_USER_ID) : null,
  depositPacks: [50, 100, 250, 500, 1000, 2500],
};
