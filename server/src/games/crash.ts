import type { GameDef } from "./types.js";

/** Краш с автовыводом: игрок заранее выбирает цель (например ×2).
 *  Точка краха = RTP / (1 − r). Вероятность дожить до цели t = RTP / t,
 *  поэтому ожидаемый возврат = (RTP / t) × t = RTP при любой цели.
 *  Для живого краша (вывод кнопкой во время полёта) нужен раунд на сервере
 *  с таймером — это следующий шаг, скелет под него тот же. */
type CrashParams = { target: number };
const RTP = 0.96;
const MAX = 1000;

export const crash: GameDef<CrashParams> = {
  id: "crash",
  title: "Краш",
  url: "/games/crash/index.html",
  rtp: RTP,
  maxMultiplier: MAX,
  parseParams(raw) {
    const target = Number((raw as any)?.target);
    if (!Number.isFinite(target) || target < 1.01 || target > MAX) {
      throw new Error(`Цель должна быть от 1.01 до ${MAX}`);
    }
    return { target: Math.floor(target * 100) / 100 };
  },
  play({ rng, params }) {
    const r = rng();
    const crashPoint = Math.min(MAX, Math.max(1, Math.floor((RTP / (1 - r)) * 100) / 100));
    const win = crashPoint >= params.target;
    return {
      multiplier: win ? params.target : 0,
      outcome: { crashPoint, target: params.target, win },
    };
  },
};
