import "./styles.css";
import { api, type Game, type Me } from "./api";
import { attachBridge } from "./bridge";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor("#1C2230");
tg?.setBackgroundColor("#1C2230");

const app = document.getElementById("app")!;
let me: Me;
let games: Game[] = [];
let detach: (() => void) | null = null;

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function setBalance(b: number) {
  me.balance = b;
  document.querySelectorAll<HTMLElement>("[data-balance]").forEach((el) => (el.textContent = fmt(b)));
}

// ── Возраст ─────────────────────────────────────────────
function ageGate(): Promise<void> {
  if (localStorage.getItem("age-ok") === "1") return Promise.resolve();
  return new Promise((done) => {
    app.innerHTML = `
      <section class="gate">
        <h1 class="brand">ANGOCK</h1>
        <p>Игры на ставки доступны только совершеннолетним.</p>
        <button class="btn btn-gold" id="age-yes">Мне есть 18</button>
      </section>`;
    document.getElementById("age-yes")!.onclick = () => {
      localStorage.setItem("age-ok", "1");
      done();
    };
  });
}

// ── Лобби ───────────────────────────────────────────────
async function renderLobby() {
  detach?.();
  detach = null;
  tg?.BackButton.hide();
  const history = await api.history().catch(() => []);
  const titleOf = (id: string) => games.find((g) => g.id === id)?.title ?? id;

  app.innerHTML = `
    <header class="top">
      <span class="hello">${esc(me.name)}</span>
    </header>
    <button class="wallet" id="open-deposit" aria-label="Пополнить баланс">
      <span class="wallet-star" aria-hidden="true">★</span>
      <span class="wallet-sum" data-balance>${fmt(me.balance)}</span>
      <span class="wallet-add">Пополнить</span>
    </button>

    <h2 class="section">Игры</h2>
    <div class="games">
      ${games.map((g) => `
        <button class="game" data-game="${g.id}">
          <span class="game-title">${esc(g.title)}</span>
          <span class="game-rtp">RTP ${(g.rtp * 100).toFixed(0)}%</span>
        </button>`).join("")}
    </div>

    <h2 class="section">Последние ставки</h2>
    ${history.length === 0
      ? `<p class="empty">Здесь появятся твои ставки. Выбери игру выше.</p>`
      : `<ul class="history">${history.map((h) => `
          <li>
            <span>${esc(titleOf(h.game))}</span>
            <span class="muted">${fmt(h.amount)} ★</span>
            <span class="${h.payout > 0 ? "win" : "lose"}">${h.payout > 0 ? "+" + fmt(h.payout) : "−" + fmt(h.amount)}</span>
          </li>`).join("")}</ul>`}

    <footer class="links">
      <button class="link" id="open-fair">Проверка честности</button>
      <button class="link" id="open-withdraw">Вывод</button>
    </footer>`;

  document.getElementById("open-deposit")!.onclick = openDeposit;
  document.getElementById("open-fair")!.onclick = openFair;
  document.getElementById("open-withdraw")!.onclick = openWithdraw;
  app.querySelectorAll<HTMLButtonElement>("[data-game]").forEach((b) => (b.onclick = () => openGame(b.dataset.game!)));
}

// ── Игра в iframe ───────────────────────────────────────
function openGame(id: string) {
  const game = games.find((g) => g.id === id)!;
  app.innerHTML = `
    <div class="play">
      <div class="play-bar">
        <button class="link" id="back">Назад</button>
        <span class="play-title">${esc(game.title)}</span>
        <span class="play-balance"><span data-balance>${fmt(me.balance)}</span> ★</span>
      </div>
      <iframe class="play-frame" src="${game.url}" title="${esc(game.title)}" allow="autoplay"></iframe>
    </div>`;
  const frame = app.querySelector<HTMLIFrameElement>("iframe")!;
  detach = attachBridge(frame, id, setBalance);
  const back = () => { tg?.BackButton.offClick(back); renderLobby(); };
  document.getElementById("back")!.onclick = back;
  tg?.BackButton.show();
  tg?.BackButton.onClick(back);
}

// ── Нижние окна ─────────────────────────────────────────
function sheet(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<div class="sheet" role="dialog">${html}<button class="link sheet-close">Закрыть</button></div>`;
  wrap.onclick = (e) => { if (e.target === wrap || (e.target as HTMLElement).classList.contains("sheet-close")) wrap.remove(); };
  document.body.appendChild(wrap);
  return wrap;
}

function openDeposit() {
  const s = sheet(`
    <h3>Пополнить звёздами</h3>
    <div class="packs">${me.depositPacks.map((p) => `<button class="pack" data-pack="${p}">${p} ★</button>`).join("")}</div>
    <p class="muted small">Оплата проходит в окне Telegram. Звёзды зачислятся сразу после оплаты.</p>`);
  s.querySelectorAll<HTMLButtonElement>("[data-pack]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const { link } = await api.deposit(Number(b.dataset.pack));
        if (!tg) { alert("Оплата работает только внутри Telegram"); return; }
        tg.openInvoice(link, async (status) => {
          if (status === "paid") {
            tg.HapticFeedback?.notificationOccurred("success");
            s.remove();
            // Зачисление делает бот после successful_payment — подождём пару секунд
            for (let i = 0; i < 5; i++) {
              await new Promise((r) => setTimeout(r, 800));
              const fresh = await api.me();
              if (fresh.balance !== me.balance) { setBalance(fresh.balance); break; }
            }
          }
        });
      } catch (e) {
        tg?.showAlert((e as Error).message);
      } finally {
        b.disabled = false;
      }
    };
  });
}

function openFair() {
  const s = sheet(`
    <h3>Проверка честности</h3>
    <p class="small">Каждый исход считается из трёх значений. Хэш серверного ключа показан заранее, сам ключ раскрывается при смене — так можно проверить, что результаты не меняли после ставки.</p>
    <dl class="fair">
      <dt>Хэш серверного ключа</dt><dd>${me.fair.serverSeedHash}</dd>
      <dt>Твой ключ</dt><dd>${esc(me.fair.clientSeed)}</dd>
      <dt>Номер ставки</dt><dd>${me.fair.nonce}</dd>
    </dl>
    <button class="btn" id="rotate">Сменить ключ и раскрыть старый</button>
    <pre class="revealed" hidden></pre>`);
  s.querySelector<HTMLButtonElement>("#rotate")!.onclick = async () => {
    const r = await api.rotateSeed();
    const out = s.querySelector<HTMLPreElement>(".revealed")!;
    out.hidden = false;
    out.textContent = `Старый серверный ключ:\n${r.revealedServerSeed}\n\nНовый хэш:\n${r.newServerSeedHash}`;
    me = await api.me();
  };
}

function openWithdraw() {
  const s = sheet(`
    <h3>Вывод</h3>
    <p class="small">Заявку проверяет администратор. На время проверки сумма замораживается.</p>
    <input class="input" id="wd" type="number" min="1" step="1" inputmode="numeric" placeholder="Сколько звёзд" />
    <button class="btn btn-gold" id="wd-go">Отправить заявку</button>`);
  s.querySelector<HTMLButtonElement>("#wd-go")!.onclick = async () => {
    const v = Number(s.querySelector<HTMLInputElement>("#wd")!.value);
    try {
      const r = await api.withdraw(v);
      setBalance((await api.me()).balance);
      s.remove();
      tg?.showAlert(`Заявка #${r.id} отправлена`);
    } catch (e) {
      tg ? tg.showAlert((e as Error).message) : alert((e as Error).message);
    }
  };
}

// ── Старт ───────────────────────────────────────────────
(async () => {
  await ageGate();
  try {
    [me, games] = await Promise.all([api.me(), api.games()]);
    await renderLobby();
  } catch (e) {
    app.innerHTML = `<section class="gate"><h1 class="brand">ANGOCK</h1><p>${esc((e as Error).message)}</p></section>`;
  }
})();
