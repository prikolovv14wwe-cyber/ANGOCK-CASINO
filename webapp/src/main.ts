import "./styles.css";
import { api, type Game, type Me } from "./api";
import { attachBridge } from "./bridge";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor("#2E3137");
tg?.setBackgroundColor("#2E3137");

const app = document.getElementById("app")!;
let me: Me;
let games: Game[] = [];
let detach: (() => void) | null = null;

// Пиксельная звезда 9×9 — валюта Telegram Stars
const STAR_ROWS = ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", "..##.##..", ".##...##.", ".#.....#."];
const STAR = `<svg class="star" viewBox="0 0 9 9" aria-hidden="true">${STAR_ROWS.flatMap((r, y) =>
  [...r].map((c, x) => (c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#F4C430"/>` : ""))).join("")}</svg>`;
const COVERS: Record<string, string> = {
  "jenny-drop": "/covers/jenny-drop.jpg",
  "pickaxe-hook": "/covers/pickaxe-hook.jpg",
  slither: "/covers/slither.jpg",
};
const GLYPHS: Record<string, string> = { dice: "62.47", crash: "×2.00" };

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
        <h1 class="wordmark">ANGOCK</h1>
        <p>Игры на звёзды доступны только с 18 лет.</p>
        <button class="block gold btn" id="age-yes">Мне есть 18</button>
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

  const tile = (g: Game, wide = false) => {
    const art = COVERS[g.id]
      ? `<img src="${COVERS[g.id]}" alt="" loading="lazy">`
      : `<span class="glyph" aria-hidden="true">${GLYPHS[g.id] ?? "?"}</span>`;
    return `
      <button class="block tile${wide ? " wide" : ""}" data-game="${g.id}">
        ${art}
        <span class="tile-bar"><span class="tile-name">${esc(g.title)}</span><span class="tile-rtp">RTP ${(g.rtp * 100).toFixed(0)}%</span></span>
      </button>`;
  };
  const [featured, ...rest] = games;

  app.innerHTML = `
    <header class="top">
      <span class="wordmark">ANGOCK</span>
      <span class="who">${esc(me.name)}</span>
    </header>
    <div class="purse">
      <div class="slot">${STAR}<span class="amount" data-balance>${fmt(me.balance)}</span></div>
      <button class="block gold btn" id="open-deposit">Пополнить</button>
    </div>

    <h2>Игры</h2>
    <div class="grid">
      ${featured ? tile(featured, true) : ""}
      ${rest.map((g) => tile(g)).join("")}
    </div>

    <h2>Твои ставки</h2>
    <div class="slot">
    ${history.length === 0
      ? `<p class="empty">Пока пусто. Выбери игру — ставки появятся здесь.</p>`
      : `<ul class="history">${history.map((h) => `
          <li>
            <span>${esc(titleOf(h.game))}</span>
            <span class="stake">${fmt(h.amount)}</span>
            <span class="res ${h.payout > 0 ? "win" : "lose"}">${h.payout > 0 ? "+" + fmt(h.payout) : "−" + fmt(h.amount)}</span>
          </li>`).join("")}</ul>`}
    </div>

    <div class="actions">
      <button class="block btn" id="open-fair">Проверить честность</button>
      <button class="block btn" id="open-withdraw">Вывести звёзды</button>
    </div>`;

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
        <button class="block back" id="back">Назад</button>
        <span class="play-title">${esc(game.title)}</span>
        <span class="play-balance">${STAR}<span data-balance>${fmt(me.balance)}</span></span>
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
  wrap.innerHTML = `<div class="sheet" role="dialog">${html}<button class="sheet-close">Закрыть</button></div>`;
  wrap.onclick = (e) => { if (e.target === wrap || (e.target as HTMLElement).classList.contains("sheet-close")) wrap.remove(); };
  document.body.appendChild(wrap);
  return wrap;
}

function openDeposit() {
  const s = sheet(`
    <h3>Пополнить баланс</h3>
    <p class="small">Оплата откроется в окне Telegram, звёзды придут на баланс сразу после неё.</p>
    <div class="packs">${me.depositPacks.map((p) => `<button class="block pack" data-pack="${p}">${STAR}${fmt(p)}</button>`).join("")}</div>`);
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
    <h3>Проверить честность</h3>
    <p class="small">Каждый исход считается из трёх значений. Хэш серверного ключа виден заранее, а сам ключ раскрывается при смене. Так можно убедиться, что результат не меняли после ставки.</p>
    <dl class="slot fair">
      <dt>Хэш серверного ключа</dt><dd>${me.fair.serverSeedHash}</dd>
      <dt>Твой ключ</dt><dd>${esc(me.fair.clientSeed)}</dd>
      <dt>Номер ставки</dt><dd>${me.fair.nonce}</dd>
    </dl>
    <button class="block btn" id="rotate">Сменить ключ и раскрыть старый</button>
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
    <h3>Вывести звёзды</h3>
    <p class="small">Заявку проверяет администратор. Пока она на проверке, сумма заморожена.</p>
    <input class="slot input" id="wd" type="number" min="1" step="1" inputmode="numeric" placeholder="Сколько звёзд" aria-label="Сколько звёзд вывести" />
    <button class="block gold btn" id="wd-go">Отправить заявку</button>`);
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
    app.innerHTML = `<section class="gate"><h1 class="wordmark">ANGOCK</h1><p>${esc((e as Error).message)}</p></section>`;
  }
})();
