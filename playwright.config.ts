// Сквозные тесты «Вдвоём»: приложение в браузере размером с телефон, как у человека.
//   npm run e2e          — быстро, без окна
//   npm run e2e:okno     — в видимом окне Chrome, с паузой между шагами (смотреть глазами)
//   npm run e2e:ui       — окно Playwright: каждый шаг можно отмотать и посмотреть
// Сервер и сайт поднимаются сами на своих портах (3100 и 5174) со своей базой,
// разработке на 3000/5173 не мешают. Два движка: Chrome и WebKit (движок Safari
// на айфоне) — баг со шторками 26.09.2026 был как раз в WebKit.
import { defineConfig, devices } from "@playwright/test";

const slow = Number(process.env.PWSLOW ?? 0);
const DB = "/tmp/vdvoyom-e2e.db";
// Журнал сервера: без токена бот пишет сообщения туда строками «[бот → id] …»,
// по ним e2e/shag4.spec.ts проверяет, что дошло до половинки
export const BOT_LOG = "/tmp/vdvoyom-e2e-server.log";
// testy и testy-v1 читают журнал бота отсюда (агенты гоняют их на своих портах и журналах)
process.env.E2E_BOT_LOG ??= BOT_LOG;
// Владелец для админки и беты новых тестов (server/src/beta.ts): Миша (1) и по одному
// человеку из пар, на которых идут e2e новых тестов (см. e2e/seed.ts).
// Все остальные пары — обычные, со старыми тестами. В .env этого нет: только здесь.
// Пары 47–50 — граница бесплатного в новых тестах (e2e/limity.spec.ts).
const ADMIN_IDS = "1,29,31,47,48,49,50";
const ENV = `DB_PATH=${DB} IMDB_DB_PATH=/tmp/vdvoyom-e2e-imdb.db FILM_POSTERS_DIR=/tmp/vdvoyom-e2e-posters`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // База одна на все тесты, поэтому по очереди
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/otchet" }]],
  use: {
    baseURL: "http://localhost:5174",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: slow ? "on" : "off",
    launchOptions: { slowMo: slow },
  },
  projects: [
    { name: "chrome", use: { channel: "chrome", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
    // Андроид как у тестировщика (448×646 в телеграме): только кликабельность и жанры,
    // остальные тесты делят пары по движкам и третьего не ждут
    { name: "android", use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 448, height: 646 } }, testMatch: ["klikabelnost.spec.ts", "zhanry.spec.ts"] },
  ],
  webServer: [
    {
      command: `rm -rf ${DB}* /tmp/vdvoyom-e2e-posters ${BOT_LOG} && cd server && ${ENV} node ../e2e/seed.ts && ${ENV} DEV_AUTH=1 PLUS=1 ADMIN_IDS=${ADMIN_IDS} AI_FAKE=1 PORT=3100 PUBLIC_URL=http://localhost:5174 node src/index.ts 2>&1 | tee ${BOT_LOG}`,
      url: "http://localhost:3100/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "cd web && API_URL=http://localhost:3100 npx vite --port 5174 --strictPort",
      url: "http://localhost:5174",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
