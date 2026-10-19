/** Прогоняет миллион ставок и печатает фактический RTP каждой игры.
 *  Запуск: npm run rtp  — делай это после любой правки математики. */
import { randomBytes } from "node:crypto";
import { games } from "../games/registry.js";
import { makeRng } from "../rng.js";

const ROUNDS = Number(process.env.ROUNDS ?? 1_000_000);
const sampleParams: Record<string, unknown[]> = {
  dice: [{ chance: 1 }, { chance: 25 }, { chance: 50 }, { chance: 95 }],
  crash: [{ target: 1.01 }, { target: 2 }, { target: 10 }, { target: 100 }],
};

for (const game of games.values()) {
  for (const raw of sampleParams[game.id] ?? [{}]) {
    const params = game.parseParams(raw);
    const seed = randomBytes(32).toString("hex");
    let paid = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { multiplier } = game.play({ rng: makeRng(seed, "test", i), bet: 1, params });
      paid += multiplier;
    }
    console.log(`${game.id} ${JSON.stringify(params)}  RTP = ${((paid / ROUNDS) * 100).toFixed(2)}%  (цель ${game.rtp * 100}%)`);
  }
}
