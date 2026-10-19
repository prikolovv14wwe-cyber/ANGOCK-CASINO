/**
 * ANGOCK SDK — подключи в любую свою игру:
 *   <script src="/games/angock-sdk.js"></script>
 *
 *   const { balance, limits } = await Angock.getBalance();
 *   const r = await Angock.bet(10, { chance: 50 });
 *   // r.outcome — что выпало (решил СЕРВЕР), r.payout — выигрыш, r.balance — новый баланс
 *   // Игра только анимирует r.outcome. Свою случайность для денег в игре не использовать!
 */
(function () {
  let seq = 0;
  const waiting = new Map();

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.type !== "angock:reply" || !waiting.has(m.id)) return;
    const { resolve, reject } = waiting.get(m.id);
    waiting.delete(m.id);
    m.ok ? resolve(m.data) : reject(new Error(m.error));
  });

  function send(type, extra) {
    return new Promise((resolve, reject) => {
      if (window.parent === window) return reject(new Error("Игра открыта не внутри казино"));
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.parent.postMessage({ type, id, ...extra }, "*");
      setTimeout(() => {
        if (waiting.has(id)) { waiting.delete(id); reject(new Error("Сервер не ответил")); }
      }, 15000);
    });
  }

  window.Angock = {
    bet: (amount, params) => send("angock:bet", { amount, params }),
    getBalance: () => send("angock:balance", {}),
  };
})();
