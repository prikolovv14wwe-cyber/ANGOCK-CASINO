/**
 * «Клиентские» игры — твои большие игры (Jenny Drop, Червячки, Pickaxe Hook).
 * Их физика и анимация живут в браузере, а сервер:
 *   1) списывает ставку (start),
 *   2) при необходимости сам решает судьбу раунда (fate) — честным генератором,
 *   3) начисляет выигрыш (win), но НЕ больше потолка (cap), посчитанного при старте.
 * Раунд остаётся открытым до следующего старта — так работают цепочки бонусов,
 * когда за одну ставку бывает несколько выплат.
 */
export interface ClientGame {
  id: string;
  title: string;
  url: string;
  rtp: number;
  maxStakeX: number; // во сколько раз «цена спина» может превышать ставку (покупка бонуса и т.п.)
  fate?: (rng: () => number) => Record<string, number>;
  capX: (fate: Record<string, number> | undefined) => number; // потолок выплаты в ставках
}

const SLITHER_RTP = 0.95;

export const clientGames: ClientGame[] = [
  {
    id: "jenny-drop",
    title: "Jenny Drop",
    url: "/games/jenny-drop/index.html",
    rtp: 0.96,
    maxStakeX: 200, // покупка Энд-бонуса = 200 ставок
    // за раунд игра платит максимум 2000 ставок; запас на цепочку бонусов
    capX: () => 6000,
  },
  {
    id: "slither",
    title: "Червячки",
    url: "/games/slither/index.html",
    rtp: SLITHER_RTP,
    maxStakeX: 1,
    // Скрытая точка краша: P(M ≥ x) = RTP / x. Теперь её выбирает сервер, а не браузер
    fate: (rng) => ({ M: Math.min(1000, Math.floor((SLITHER_RTP / (1 - rng())) * 100) / 100) }),
    capX: (f) => f?.M ?? 0,
  },
  {
    id: "pickaxe-hook",
    title: "Pickaxe Hook",
    url: "/games/pickaxe-hook/index.html",
    rtp: 0.96,
    maxStakeX: 1,
    // Игра на ловкость: лестница сундуков до ×1000 + бонусы за руду
    capX: () => 1100,
  },
];

export const clientGameMap = new Map(clientGames.map((g) => [g.id, g]));
