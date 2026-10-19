import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Provably fair (доказуемо честный) генератор.
 * Исход = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${cursor}`).
 * Игроку заранее показываем ХЭШ serverSeed, после смены сида — сам сид,
 * и он может проверить, что исходы не подкручивались задним числом.
 */
export function newServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** Создаёт поток чисел [0, 1) для одной ставки. Игры, которым нужно много
 *  случайных чисел (слоты, падение кирок), просто зовут rng() несколько раз. */
export function makeRng(serverSeed: string, clientSeed: string, nonce: number) {
  let cursor = 0;
  return function rng(): number {
    const h = createHmac("sha256", serverSeed)
      .update(`${clientSeed}:${nonce}:${cursor++}`)
      .digest();
    // 48 бит → число в [0, 1)
    let n = 0;
    for (let i = 0; i < 6; i++) n = n * 256 + h[i];
    return n / 2 ** 48;
  };
}
