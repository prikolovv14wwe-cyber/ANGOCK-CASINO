import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Bot } from "grammy";
import { config } from "./config.js";
import { validateInitData, type TgUser } from "./auth.js";
import { adminIdList, CENTS, getUser, lastBets, placeBet, requestWithdrawal, rotateSeed, upsertUser } from "./db.js";
import { hashSeed } from "./rng.js";
import { publicGameList } from "./games/registry.js";

declare module "fastify" {
  interface FastifyRequest { tgUser: TgUser }
}

const stars = (cents: number) => cents / CENTS;

export function registerApi(app: FastifyInstance, bot: Bot) {
  // Каждый запрос /api/* должен нести заголовок: Authorization: tma <initData>
  app.addHook("preHandler", async (req: FastifyRequest, reply) => {
    if (!req.url.startsWith("/api/")) return;
    const header = req.headers.authorization ?? "";
    try {
      if (header.startsWith("tma ") && header.length > 4) {
        req.tgUser = validateInitData(header.slice(4), config.botToken);
      } else if (config.devUserId) {
        req.tgUser = { id: config.devUserId, first_name: "Dev" }; // только для теста в браузере
      } else {
        throw new Error("Открой казино через Telegram");
      }
      upsertUser(req.tgUser);
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message });
    }
  });

  app.get("/api/me", async (req) => {
    const u = getUser(req.tgUser.id)!;
    return {
      id: u.id,
      name: u.first_name ?? u.username ?? "Игрок",
      balance: stars(u.balance),
      fair: { serverSeedHash: hashSeed(u.server_seed), clientSeed: u.client_seed, nonce: u.nonce },
      limits: { minBet: config.minBet, maxBet: config.maxBet },
      depositPacks: config.depositPacks,
    };
  });

  app.get("/api/games", async () => publicGameList());

  // Пополнение: сервер создаёт ссылку на счёт в звёздах, веб-ап открывает её через openInvoice
  app.post<{ Body: { stars: number } }>("/api/deposit", async (req, reply) => {
    const amount = Number(req.body?.stars);
    if (!config.depositPacks.includes(amount)) return reply.code(400).send({ error: "Неверная сумма" });
    const link = await bot.api.createInvoiceLink(
      `${amount} ⭐ на баланс`,
      "Пополнение игрового баланса",
      JSON.stringify({ t: "dep", u: req.tgUser.id, s: amount }), // payload — вернётся нам при оплате
      "", // provider_token: для звёзд пустая строка
      "XTR", // валюта Telegram Stars
      [{ label: "Пополнение", amount }],
    );
    return { link };
  });

  app.post<{ Body: { game: string; bet: number; params: unknown } }>("/api/bet", async (req, reply) => {
    try {
      const r = placeBet(req.tgUser.id, req.body?.game, Number(req.body?.bet), req.body?.params);
      return {
        multiplier: r.multiplier,
        outcome: r.outcome,
        bet: stars(r.bet),
        payout: stars(r.payout),
        balance: stars(r.balance),
        nonce: r.nonce,
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { clientSeed?: string } }>("/api/fair/rotate", async (req) =>
    rotateSeed(req.tgUser.id, req.body?.clientSeed),
  );

  app.get("/api/history", async (req) =>
    lastBets(req.tgUser.id).map((b: any) => ({ ...b, amount: stars(b.amount), payout: stars(b.payout) })),
  );

  app.post<{ Body: { stars: number } }>("/api/withdraw", async (req, reply) => {
    try {
      const id = requestWithdrawal(req.tgUser.id, Number(req.body?.stars));
      for (const admin of adminIdList()) {
        bot.api
          .sendMessage(admin, `Заявка на вывод #${id}: ${req.body.stars} ⭐ от ${req.tgUser.id}\n/approve ${id} или /reject ${id}`)
          .catch(() => {});
      }
      return { id, status: "pending" };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
