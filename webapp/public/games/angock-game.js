/**
 * AG — помощник для больших игр (подключать ПОСЛЕ angock-sdk.js):
 *   <script src="../angock-game.js" data-game="slither"></script>
 *
 *   AG.on                       — true, если игра открыта внутри казино
 *   await AG.balance()          — баланс с сервера
 *   await AG.begin(bet, stake?) — старт раунда: сервер списывает stake (по умолчанию = bet),
 *                                 возвращает { roundId, fate, balance }
 *   await AG.win(amount)        — выплата в текущем раунде (сервер урежет до потолка), вернёт баланс
 * Все вызовы идут строго по очереди, так что win никогда не обгонит begin.
 */
(function () {
  const on = window.parent !== window && !!window.Angock;
  let queue = Promise.resolve();
  let roundId = null;
  const serial = (fn) => (queue = queue.then(fn, fn));
  const send = (type, extra) =>
    new Promise((resolve, reject) => {
      const id = "ag" + Math.random().toString(36).slice(2);
      const h = (e) => {
        const m = e.data;
        if (!m || m.type !== "angock:reply" || m.id !== id) return;
        window.removeEventListener("message", h);
        m.ok ? resolve(m.data) : reject(new Error(m.error));
      };
      window.addEventListener("message", h);
      window.parent.postMessage({ type, id, ...extra }, "*");
      setTimeout(() => { window.removeEventListener("message", h); reject(new Error("Сервер не ответил")); }, 15000);
    });

  window.AG = {
    on,
    balance: () => serial(() => send("angock:balance", {}).then((d) => d.balance)),
    begin: (bet, stake) =>
      serial(() => send("angock:round", { bet, stake }).then((d) => { roundId = d.roundId; return d; })),
    win: (amount) =>
      serial(() => (roundId == null || !(amount > 0) ? send("angock:balance", {}).then((d) => d.balance)
        : send("angock:win", { roundId, win: amount }).then((d) => d.balance))),
    err: (e) => alert(e && e.message ? e.message : String(e)),
  };
})();
