# ANGOCK Casino — Telegram Mini App (скелет)

## Что внутри

```
server/                 бот + API + база (Node.js, TypeScript)
  src/bot.ts            /start, оплата звёздами, админ-команды
  src/api.ts            API для веб-апа (баланс, пополнение, ставка, вывод)
  src/auth.ts           проверка подписи Telegram (кто играет)
  src/db.ts             баланс, журнал денег, ставки (SQLite)
  src/rng.ts            честный генератор (provably fair)
  src/games/            МАТЕМАТИКА игр — по файлу на игру
  src/tools/rtp-check.ts  симуляция миллиона ставок → реальный RTP
webapp/                 сам веб-ап (Vite + TypeScript)
  src/main.ts           лобби, пополнение, история, честность, вывод
  src/bridge.ts         мост «оболочка ↔ игра в iframe»
  public/games/angock-sdk.js  SDK, который подключают игры
  public/games/dice, crash     две демо-игры
```

## Главное правило
Исход ставки считает **сервер** (`server/src/games/*.ts`). Игра на Phaser только
получает готовый результат и красиво его показывает. Если оставить случайность
в игре, любой подменит её через консоль браузера и выведет твою кассу.

## Запуск (локально)

1. Создай бота в @BotFather, получи токен.
2. `cd server && npm install && cp .env.example .env` — впиши `BOT_TOKEN`, свой ID в `ADMIN_IDS`.
3. `cd webapp && npm install && npm run build`
4. Telegram открывает веб-ап только по HTTPS. Для теста:
   `cloudflared tunnel --url http://localhost:3000` (или ngrok) → полученный адрес в `WEBAPP_URL`.
5. `cd server && npm run dev` → напиши боту /start.

Тест в обычном браузере без Telegram: впиши `DEV_USER_ID=твой_id` и открой
`http://localhost:3000`. На проде эту строку оставь пустой.

Проверка математики: `cd server && npm run rtp`.

## Временный хостинг (Render, бесплатно)

1. Залей папку в **приватный** репозиторий GitHub (файл `.env` туда не попадёт — он в .gitignore).
2. render.com → New → **Blueprint** → выбери репозиторий. Render прочитает `render.yaml`.
3. В поле `BOT_TOKEN` вставь токен из @BotFather → Apply. Через 3–5 минут сервис готов.
4. Напиши боту /start — ответит «Ты админ», кнопка меню откроет казино.

Ограничения бесплатного тарифа: засыпает после 15 минут без запросов (просыпается ~минуту),
база SQLite **стирается** при каждом засыпании и перезапуске. Это только для теста —
реальные звёзды туда не принимать.

## Как добавить свою игру
1. `server/src/games/mygame.ts` — по образцу `dice.ts`: `parseParams` (что игрок
   выбрал) и `play` (исход + множитель, случайность только из `rng()`).
2. Добавь её в `server/src/games/registry.ts`.
3. Положи сборку игры в `webapp/public/games/mygame/`, подключи
   `<script src="../angock-sdk.js"></script>` и вместо локального розыгрыша зови
   `const r = await Angock.bet(ставка, параметры)` → анимируй `r.outcome`.
4. `npm run rtp` — убедись, что RTP сходится.

## Админ-команды бота
`/stats` — пополнения, оборот, фактический RTP · `/refund <user_id> <charge_id>` — вернуть платёж ·
`/approve <id>` / `/reject <id>` — заявки на вывод.
