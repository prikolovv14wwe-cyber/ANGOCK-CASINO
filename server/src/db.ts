import Database from "better-sqlite3";
import { config } from "./config.js";
import { hashSeed, makeRng, newServerSeed } from "./rng.js";
import { games } from "./games/registry.js";

/**
 * Деньги храним в «центах звезды» (1 ⭐ = 100), чтобы выигрыш ×1.92
 * со ставки 1 ⭐ не округлялся до 1 ⭐ и не съедал RTP.
 * Пополнение и вывод — только целыми звёздами.
 */
export const CENTS = 100;

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,           -- Telegram user id
  username     TEXT,
  first_name   TEXT,
  balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  server_seed  TEXT NOT NULL,
  client_seed  TEXT NOT NULL,
  nonce        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
-- Журнал всех движений денег: по нему всегда можно восстановить баланс
CREATE TABLE IF NOT EXISTS ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  kind          TEXT NOT NULL,   -- deposit | bet | win | withdraw_hold | withdraw_return | refund
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref           TEXT,
  created_at    INTEGER NOT NULL
);
-- Один платёж Telegram зачисляется строго один раз
CREATE UNIQUE INDEX IF NOT EXISTS ledger_deposit_once ON ledger(ref) WHERE kind = 'deposit';

CREATE TABLE IF NOT EXISTS bets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  game             TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  payout           INTEGER NOT NULL,
  multiplier       REAL NOT NULL,
  params           TEXT NOT NULL,
  outcome          TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed      TEXT NOT NULL,
  nonce            INTEGER NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | rejected
  created_at INTEGER NOT NULL
);
`);

export type UserRow = {
  id: number;
  username: string | null;
  first_name: string | null;
  balance: number;
  server_seed: string;
  client_seed: string;
  nonce: number;
};

const now = () => Date.now();

export function upsertUser(u: { id: number; username?: string; first_name?: string }): UserRow {
  db.prepare(
    `INSERT INTO users (id, username, first_name, server_seed, client_seed, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name`,
  ).run(u.id, u.username ?? null, u.first_name ?? null, newServerSeed(), String(u.id), now());
  return getUser(u.id)!;
}

export function getUser(id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

function move(userId: number, delta: number, kind: string, ref: string | null): number {
  const res = db
    .prepare(`UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0 RETURNING balance`)
    .get(delta, userId, delta) as { balance: number } | undefined;
  if (!res) throw new Error("Недостаточно средств");
  db.prepare(`INSERT INTO ledger (user_id, kind, amount, balance_after, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, kind, delta, res.balance, ref, now());
  return res.balance;
}

/** Зачисление оплаты звёздами. Возвращает false, если этот платёж уже был зачислен. */
export const creditDeposit = db.transaction(
  (userId: number, stars: number, chargeId: string): boolean => {
    const dup = db.prepare(`SELECT 1 FROM ledger WHERE kind = 'deposit' AND ref = ?`).get(chargeId);
    if (dup) return false;
    move(userId, stars * CENTS, "deposit", chargeId);
    return true;
  },
);

/** Ставка целиком в одной транзакции: списали → посчитали исход → начислили выигрыш. */
export const placeBet = db.transaction((userId: number, gameId: string, betStars: number, rawParams: unknown) => {
  const game = games.get(gameId);
  if (!game) throw new Error("Нет такой игры");
  if (!Number.isInteger(betStars) || betStars < config.minBet || betStars > config.maxBet) {
    throw new Error(`Ставка от ${config.minBet} до ${config.maxBet} ⭐`);
  }
  const params = game.parseParams(rawParams);
  const user = getUser(userId);
  if (!user) throw new Error("Пользователь не найден");

  const bet = betStars * CENTS;
  move(userId, -bet, "bet", gameId);

  const rng = makeRng(user.server_seed, user.client_seed, user.nonce);
  const { multiplier, outcome } = game.play({ rng, bet, params });
  const m = Math.min(multiplier, game.maxMultiplier);
  const payout = Math.floor(bet * m);
  const balance = payout > 0 ? move(userId, payout, "win", gameId) : getUser(userId)!.balance;

  db.prepare(`UPDATE users SET nonce = nonce + 1 WHERE id = ?`).run(userId);
  db.prepare(
    `INSERT INTO bets (user_id, game, amount, payout, multiplier, params, outcome, server_seed_hash, client_seed, nonce, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, gameId, bet, payout, m, JSON.stringify(params), JSON.stringify(outcome),
    hashSeed(user.server_seed), user.client_seed, user.nonce, now());

  return { multiplier: m, outcome, bet, payout, balance, nonce: user.nonce };
});

/** Смена сида: раскрываем старый (игрок может проверить прошлые ставки), выдаём новый. */
export const rotateSeed = db.transaction((userId: number, clientSeed?: string) => {
  const user = getUser(userId)!;
  const next = newServerSeed();
  const cs = (clientSeed ?? user.client_seed).slice(0, 64);
  db.prepare(`UPDATE users SET server_seed = ?, client_seed = ?, nonce = 0 WHERE id = ?`).run(next, cs, userId);
  return { revealedServerSeed: user.server_seed, newServerSeedHash: hashSeed(next), clientSeed: cs };
});

/** Заявка на вывод: деньги сразу замораживаются (списываются с баланса). */
export const requestWithdrawal = db.transaction((userId: number, stars: number) => {
  if (!Number.isInteger(stars) || stars < 1) throw new Error("Укажи целое число звёзд");
  move(userId, -stars * CENTS, "withdraw_hold", null);
  const r = db.prepare(`INSERT INTO withdrawals (user_id, stars, created_at) VALUES (?, ?, ?)`).run(userId, stars, now());
  return Number(r.lastInsertRowid);
});

export const resolveWithdrawal = db.transaction((id: number, approve: boolean) => {
  const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'`).get(id) as
    | { id: number; user_id: number; stars: number }
    | undefined;
  if (!w) throw new Error("Заявка не найдена или уже обработана");
  db.prepare(`UPDATE withdrawals SET status = ? WHERE id = ?`).run(approve ? "paid" : "rejected", id);
  if (!approve) move(w.user_id, w.stars * CENTS, "withdraw_return", String(id));
  return w;
});

export function lastBets(userId: number, limit = 20) {
  return db
    .prepare(`SELECT id, game, amount, payout, multiplier, created_at FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limit);
}

export function stats() {
  return db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM ledger WHERE kind='deposit') AS deposits,
       (SELECT COALESCE(SUM(amount),0) FROM bets) AS wagered,
       (SELECT COALESCE(SUM(payout),0) FROM bets) AS paid,
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM withdrawals WHERE status='pending') AS pending_withdrawals`,
  ).get() as Record<string, number>;
}

/** ID всех админов: из ADMIN_IDS + те, кто писал боту с юзернеймом из ADMIN_USERNAMES */
export function adminIdList(): number[] {
  const ids = new Set(config.adminIds);
  if (config.adminUsernames.length) {
    const marks = config.adminUsernames.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id FROM users WHERE lower(username) IN (${marks})`).all(...config.adminUsernames) as { id: number }[];
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}
