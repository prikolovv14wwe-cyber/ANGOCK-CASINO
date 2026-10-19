import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { webhookCallback } from "grammy";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { createBot } from "./bot.js";
import { registerApi } from "./api.js";

const bot = createBot();
const app = Fastify({ logger: { level: "info" } });

app.get("/health", async () => ({ ok: true }));
registerApi(app, bot);

// Секретный путь и заголовок для webhook, чтобы чужие не слали фейковые «оплаты»
const hookSecret = createHash("sha256").update(config.botToken).digest("hex").slice(0, 32);
const hookPath = `/tg/${hookSecret}`;
if (config.useWebhook) {
  app.post(hookPath, webhookCallback(bot, "fastify", { secretToken: hookSecret }));
}

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../webapp/dist");
if (existsSync(dist)) await app.register(fastifyStatic, { root: dist });
else app.log.warn("webapp/dist не найден — собери фронт: npm run build в корне проекта");

await app.listen({ port: config.port, host: "0.0.0.0" });

await bot.api.setChatMenuButton({
  menu_button: { type: "web_app", text: "Казино", web_app: { url: config.webappUrl } },
}).catch((e) => app.log.warn(`Кнопка меню: ${e.message}`));

const allowed = ["message", "pre_checkout_query"] as const;
if (config.useWebhook) {
  await bot.init();
  await bot.api.setWebhook(`${config.webappUrl}${hookPath}`, { secret_token: hookSecret, allowed_updates: [...allowed] });
  app.log.info(`Webhook установлен: ${config.webappUrl}/tg/…`);
} else {
  await bot.api.deleteWebhook().catch(() => {});
  bot.start({ allowed_updates: [...allowed] });
  app.log.info("Бот запущен в режиме polling");
}
console.log(`Веб-ап: ${config.webappUrl}`);
