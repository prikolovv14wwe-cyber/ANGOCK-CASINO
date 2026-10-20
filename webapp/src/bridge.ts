import { api } from "./api";

/**
 * Мост между оболочкой казино и игрой в iframe.
 * Игра шлёт:    { type: "angock:bet", id, amount, params }
 *               { type: "angock:balance", id }
 * Оболочка отвечает: { type: "angock:reply", id, ok, data | error }
 * Так твоя игра на Phaser вообще не знает про Telegram, подписи и базу —
 * она просит ставку и получает готовый исход для анимации.
 */
export function attachBridge(frame: HTMLIFrameElement, gameId: string, onBalance: (b: number) => void) {
  const handler = async (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return;
    const msg = e.data;
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("angock:")) return;
    const reply = (ok: boolean, payload: unknown) =>
      frame.contentWindow?.postMessage({ type: "angock:reply", id: msg.id, ok, [ok ? "data" : "error"]: payload }, "*");
    try {
      if (msg.type === "angock:bet") {
        const r = await api.bet(gameId, Number(msg.amount), msg.params);
        onBalance(r.balance);
        reply(true, r);
      } else if (msg.type === "angock:round") {
        const r = await api.roundStart(gameId, Number(msg.bet), msg.stake === undefined ? undefined : Number(msg.stake));
        onBalance(r.balance);
        reply(true, r);
      } else if (msg.type === "angock:win") {
        const r = await api.roundWin(Number(msg.roundId), Number(msg.win));
        onBalance(r.balance);
        reply(true, r);
      } else if (msg.type === "angock:balance") {
        const me = await api.me();
        onBalance(me.balance);
        reply(true, { balance: me.balance, limits: me.limits });
      }
    } catch (err) {
      reply(false, (err as Error).message);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
