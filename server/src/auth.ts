import { createHmac, timingSafeEqual } from "node:crypto";

export type TgUser = { id: number; username?: string; first_name?: string };

/**
 * Проверка initData, которую Telegram передаёт в веб-ап.
 * Без этой проверки любой может прислать чужой user id и играть чужим балансом.
 * Алгоритм из документации Telegram: secret = HMAC("WebAppData", botToken),
 * hash = HMAC(secret, отсортированные поля "key=value" через \n).
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600): TgUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Нет подписи");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== calc.length || !timingSafeEqual(given, calc)) throw new Error("Подпись не совпала");

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) throw new Error("Сессия устарела, перезапусти веб-ап");

  const user = JSON.parse(params.get("user") ?? "null");
  if (!user?.id) throw new Error("Нет пользователя");
  return user;
}
