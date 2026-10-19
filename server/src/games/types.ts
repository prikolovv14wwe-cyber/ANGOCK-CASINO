/**
 * Контракт игры. ВАЖНО: исход ставки считает ТОЛЬКО сервер.
 * Фронт игры (Phaser и т.д.) лишь красиво показывает уже решённый результат.
 */
export interface PlayContext<P> {
  rng: () => number; // честные случайные числа [0, 1)
  bet: number; // ставка в звёздах
  params: P; // параметры, выбранные игроком (шанс, цель и т.п.)
}

export interface PlayResult {
  multiplier: number; // итоговый множитель (0 = проигрыш)
  outcome: unknown; // всё, что нужно фронту для анимации
}

export interface GameDef<P = unknown> {
  id: string;
  title: string;
  url: string; // путь к фронту игры внутри веб-апа
  rtp: number; // теоретический возврат игроку, например 0.96
  maxMultiplier: number; // потолок множителя (защита кассы)
  parseParams(raw: unknown): P; // проверка того, что прислал клиент
  play(ctx: PlayContext<P>): PlayResult;
}
