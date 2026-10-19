import type { GameDef } from "./types.js";

/** Кости: игрок выбирает шанс 1–95%. Выигрыш = RTP / шанс.
 *  RTP = шанс × (RTP / шанс) = RTP ровно. */
type DiceParams = { chance: number };
const RTP = 0.96;

export const dice: GameDef<DiceParams> = {
  id: "dice",
  title: "Кости",
  url: "/games/dice/index.html",
  rtp: RTP,
  maxMultiplier: RTP / 0.01,
  parseParams(raw) {
    const chance = Number((raw as any)?.chance);
    if (!Number.isFinite(chance) || chance < 1 || chance > 95) {
      throw new Error("Шанс должен быть от 1 до 95");
    }
    return { chance: Math.round(chance * 100) / 100 };
  },
  play({ rng, params }) {
    const roll = Math.floor(rng() * 10000) / 100; // 0.00 … 99.99
    const win = roll < params.chance;
    const multiplier = win ? RTP / (params.chance / 100) : 0;
    return { multiplier, outcome: { roll, win, chance: params.chance } };
  },
};
