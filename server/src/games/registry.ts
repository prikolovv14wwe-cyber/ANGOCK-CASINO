import type { GameDef } from "./types.js";
import { dice } from "./dice.js";
import { crash } from "./crash.js";

/** Сюда добавляются твои игры: Jenny Drop, Pickaxe Hook, Dunk Crash и т.д.
 *  Для каждой — файл с математикой (как dice.ts) + фронт в webapp/public/games/<id>/ */
const list: GameDef<any>[] = [dice, crash];

export const games = new Map(list.map((g) => [g.id, g]));

export function publicGameList() {
  return list.map((g) => ({ id: g.id, title: g.title, url: g.url, rtp: g.rtp }));
}
