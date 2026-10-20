import { Bot, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { adminAdjust, creditDeposit, db, findUser, getUser, resolveWithdrawal, stats, upsertUser, CENTS } from "./db.js";
import type { User } from "grammy/types";

export function createBot() {
  const bot = new Bot(config.botToken);
  const isAdmin = (u?: User) =>
    !!u && (config.adminIds.includes(u.id) || (!!u.username && config.adminUsernames.includes(u.username.toLowerCase())));

  bot.command("start", async (ctx) => {
    if (ctx.from) upsertUser(ctx.from);
    await ctx.reply("Добро пожаловать! Игры, баланс и пополнение — в приложении 👇", {
      reply_markup: new InlineKeyboard().webApp("🎰 Открыть казино", config.webappUrl),
    });
    if (isAdmin(ctx.from)) {
      await ctx.reply(`Ты админ (ID ${ctx.from!.id}).\nКоманды:\n/give 1000 — выдать себе\n/give @ник 500 — выдать игроку\n/take @ник 500 — забрать\n/user @ник — баланс игрока\n/stats, /refund, /approve, /reject`);
    }
  });

  bot.command("balance", async (ctx) => {
    const u = ctx.from && getUser(ctx.from.id);
    await ctx.reply(`Баланс: ${u ? u.balance / CENTS : 0} ⭐`);
  });

  // ── Оплата звёздами ─────────────────────────────────────────────
  // 1) Telegram спрашивает «можно принять оплату?» — ответить нужно за 10 секунд
  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    try {
      const p = JSON.parse(q.invoice_payload);
      const ok = p.t === "dep" && p.u === q.from.id && p.s === q.total_amount && q.currency === "XTR";
      if (!ok) return ctx.answerPreCheckoutQuery(false, "Счёт недействителен, создай новый");
      return ctx.answerPreCheckoutQuery(true);
    } catch {
      return ctx.answerPreCheckoutQuery(false, "Ошибка счёта");
    }
  });

  // 2) Оплата прошла — зачисляем. telegram_payment_charge_id сохраняем: по нему делается возврат
  bot.on("message:successful_payment", async (ctx) => {
    const sp = ctx.message.successful_payment;
    upsertUser(ctx.from);
    const fresh = creditDeposit(ctx.from.id, sp.total_amount, sp.telegram_payment_charge_id);
    if (fresh) await ctx.reply(`✅ Зачислено ${sp.total_amount} ⭐`);
  });

  // ── Админка ────────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from)) return;
    const s = stats();
    const rtp = s.wagered ? ((s.paid / s.wagered) * 100).toFixed(2) : "—";
    await ctx.reply(
      `Игроков: ${s.users}\nПополнено: ${s.deposits / CENTS} ⭐\nПоставлено: ${s.wagered / CENTS} ⭐\n` +
        `Выплачено: ${s.paid / CENTS} ⭐\nФактический RTP: ${rtp}%\nЗаявок на вывод: ${s.pending_withdrawals}`,
    );
  });

  // /give 500 — себе; /give @ник 500 или /give 123456789 500 — игроку. /take — забрать
  bot.command(["give", "take"], async (ctx) => {
    if (!isAdmin(ctx.from)) return;
    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    const take = ctx.message?.text?.startsWith("/take") ?? false;
    const amountStr = parts.length === 1 ? parts[0] : parts[1];
    const target = parts.length === 1 ? String(ctx.from!.id) : parts[0];
    const amount = Number(amountStr);
    if (!target || !Number.isFinite(amount) || amount <= 0) {
      return ctx.reply("Формат: /give 1000 (себе) или /give @ник 500. Забрать: /take @ник 500");
    }
    const user = findUser(target);
    if (!user) return ctx.reply("Игрок не найден. Он должен хоть раз написать боту /start");
    const balance = adminAdjust(user.id, take ? -amount : amount, ctx.from!.id);
    const who = user.username ? "@" + user.username : String(user.id);
    await ctx.reply(`${take ? "Забрано" : "Выдано"} ${amount} ⭐ → ${who}. Баланс: ${balance / CENTS} ⭐`);
    if (!take && user.id !== ctx.from!.id) {
      await ctx.api.sendMessage(user.id, `🎁 Тебе начислено ${amount} ⭐`).catch(() => {});
    }
  });

  bot.command("user", async (ctx) => {
    if (!isAdmin(ctx.from)) return;
    const user = findUser(ctx.match || "");
    if (!user) return ctx.reply("Формат: /user @ник или /user 123456789");
    await ctx.reply(`${user.username ? "@" + user.username : user.first_name} (ID ${user.id})\nБаланс: ${user.balance / CENTS} ⭐`);
  });

  // /refund <user_id> <charge_id> — вернуть платёж звёздами (звёзды уйдут обратно игроку)
  bot.command("refund", async (ctx) => {
    if (!isAdmin(ctx.from)) return;
    const [uid, charge] = ctx.match.split(/\s+/);
    try {
      await ctx.api.refundStarPayment(Number(uid), charge);
      const row = db.prepare(`SELECT amount FROM ledger WHERE kind='deposit' AND ref=?`).get(charge) as any;
      if (row) {
        db.prepare(`UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?`).run(row.amount, Number(uid));
        db.prepare(`INSERT INTO ledger (user_id, kind, amount, balance_after, ref, created_at)
                    VALUES (?, 'refund', ?, (SELECT balance FROM users WHERE id = ?), ?, ?)`)
          .run(Number(uid), -row.amount, Number(uid), charge, Date.now());
      }
      await ctx.reply("Возврат выполнен");
    } catch (e) {
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
    }
  });

  bot.command(["approve", "reject"], async (ctx) => {
    if (!isAdmin(ctx.from)) return;
    const approve = ctx.message?.text?.startsWith("/approve") ?? false;
    try {
      const w = resolveWithdrawal(Number(ctx.match), approve);
      await ctx.reply(approve ? `#${w.id} отмечена выплаченной. Выплату сделай вручную.` : `#${w.id} отклонена, звёзды вернулись на баланс`);
      await ctx.api.sendMessage(w.user_id, approve ? `Вывод ${w.stars} ⭐ одобрен` : `Вывод ${w.stars} ⭐ отклонён, сумма вернулась на баланс`).catch(() => {});
    } catch (e) {
      await ctx.reply((e as Error).message);
    }
  });

  bot.catch((err) => console.error("Ошибка бота:", err.error));
  return bot;
}
