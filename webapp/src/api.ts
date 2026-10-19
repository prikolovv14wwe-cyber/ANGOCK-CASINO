const tg = window.Telegram?.WebApp;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      // Подпись Telegram — по ней сервер узнаёт, кто играет
      Authorization: `tma ${tg?.initData ?? ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as T;
}

export type Me = {
  id: number; name: string; balance: number;
  fair: { serverSeedHash: string; clientSeed: string; nonce: number };
  limits: { minBet: number; maxBet: number };
  depositPacks: number[];
};
export type Game = { id: string; title: string; url: string; rtp: number };
export type BetResult = { multiplier: number; outcome: unknown; bet: number; payout: number; balance: number; nonce: number };
export type HistoryRow = { id: number; game: string; amount: number; payout: number; multiplier: number; created_at: number };

export const api = {
  me: () => call<Me>("/api/me"),
  games: () => call<Game[]>("/api/games"),
  history: () => call<HistoryRow[]>("/api/history"),
  deposit: (stars: number) => call<{ link: string }>("/api/deposit", { stars }),
  bet: (game: string, bet: number, params: unknown) => call<BetResult>("/api/bet", { game, bet, params }),
  rotateSeed: (clientSeed?: string) =>
    call<{ revealedServerSeed: string; newServerSeedHash: string; clientSeed: string }>("/api/fair/rotate", { clientSeed }),
  withdraw: (stars: number) => call<{ id: number }>("/api/withdraw", { stars }),
};
