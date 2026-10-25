import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { webhookCallback } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.ts";
import { bot, initBot } from "./bot.ts";
import type { AppEnv } from "./http.ts";
import { core, stream } from "./routes/core.ts";
import { schedule } from "./routes/schedule.ts";
import { shared } from "./routes/shared.ts";
import { fun } from "./routes/fun.ts";
import { testy } from "./routes/testy.ts";
import { goals } from "./routes/goals.ts";
import { media } from "./routes/media.ts";
import { wardrobe } from "./routes/wardrobe.ts";
import { startCron } from "./cron.ts";
import { calendarPage, consentPage, homeScreenPage, plusTermsPage, privacyPage } from "./pages.ts";
import { icsFor } from "./ics.ts";
import { thumbnail } from "./imdb.ts";
import { pay, plus } from "./routes/plus.ts";
import { feedback } from "./routes/feedback.ts";
import { admin } from "./routes/admin.ts";
import { adminApp } from "./routes/adminApp.ts";
import { apiGate, trackRoute } from "./track.ts";
import { alarm, alarmOn5xx } from "./alarm.ts";
import { onError } from "./http.ts";

const app = new Hono<AppEnv>();

// Ошибки сервера — владельцу (alarm.ts): любой ответ 5xx, с самой ошибкой, если её поймал onError
app.use("*", alarmOn5xx);
app.onError(onError);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/privacy", (c) => c.html(privacyPage(), 200, { "cache-control": "public, max-age=3600" }));
app.get("/consent", (c) => c.html(consentPage(), 200, { "cache-control": "public, max-age=3600" }));
app.get("/plus-terms", (c) => c.html(plusTermsPage(), 200, { "cache-control": "public, max-age=3600" }));
app.get("/na-ekran", (c) => c.html(homeScreenPage(), 200, { "cache-control": "no-cache" }));
// Календарь телефона: сам файл подписки и страница «как подключить» (открывается в браузере)
app.get("/cal/:file{[\\w-]+\\.ics}", (c) => {
  const ics = icsFor(c.req.param("file").replace(/\.ics$/, ""));
  return ics ? c.body(ics, 200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" }) : c.body(null, 404);
});
app.get("/cal/:token", (c) => {
  const token = c.req.param("token");
  return icsFor(token) ? c.html(calendarPage(token), 200, { "cache-control": "no-cache" }) : c.body(null, 404);
});
app.route("/pay", pay);
app.route("/admin", admin);

// Вебхук телеграма. Секрет в заголовке проверяет grammY.
if (bot && env.botMode === "webhook" && env.webhookSecret) {
  app.post("/tg/webhook", webhookCallback(bot, "hono", { secretToken: env.webhookSecret }));
}

app.route("/api/stream", stream);
app.route("/media", media);

const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", core);
api.route("/schedule", schedule);
api.route("/", shared);
api.route("/", fun);
api.route("/", testy);
api.route("/", goals);
api.route("/", wardrobe);
api.route("/", plus);
api.route("/", feedback);
api.route("/", trackRoute);
api.route("/admin", adminApp);
app.route("/api", api);

// Постеры и картинки направлений: имена не меняются, кэш надолго
const longCache = { onFound: (_p: string, c: { header: (k: string, v: string) => void }) => c.header("Cache-Control", "public, max-age=2592000, immutable") };
app.use("/posters/*", serveStatic({ root: path.relative(process.cwd(), env.dataDir), ...longCache }));
app.use("/places/*", serveStatic({ root: path.relative(process.cwd(), env.dataDir), ...longCache }));
app.use("/ideas/*", serveStatic({ root: path.relative(process.cwd(), env.dataDir), ...longCache }));
// Постеры фильмов, добавленных поиском, лежат на томе: папка film-posters рядом с базой
app.get("/film-posters/:file", (c) => {
  const file = c.req.param("file");
  const full = path.join(env.filmPostersDir, file);
  if (!/^tt\d+\.jpg$/.test(file) || !fs.existsSync(full)) return c.body(null, 404);
  return c.body(new Uint8Array(fs.readFileSync(full)), 200, { "content-type": "image/jpeg", "cache-control": "public, max-age=2592000, immutable" });
});
app.get("/film-thumb/:imdb", async (c) => {
  const buf = await thumbnail(c.req.param("imdb"));
  if (!buf) return c.body(null, 404);
  return c.body(new Uint8Array(buf), 200, { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" });
});

// Мини-приложение: собранные файлы, index.html без кэша
if (fs.existsSync(env.webDist)) {
  const root = path.relative(process.cwd(), env.webDist);
  app.use("/assets/*", serveStatic({ root, ...longCache }));
  // HTML — всегда с проверкой у сервера: иначе телеграм показывал старую сборку после выката
  // (28.09.2026 реакции в вопросе дня не появились у владельца). Раньше no-cache стоял только
  // у запасного маршрута, а «/» отдавал index.html этот serveStatic — без заголовка.
  const noCacheHtml = { onFound: (p: string, c: { header: (k: string, v: string) => void }) => {
    if (p.endsWith(".html")) c.header("Cache-Control", "no-cache");
  } };
  app.use("*", serveStatic({ root, ...noCacheHtml }));
  app.get("*", serveStatic({ root, path: "index.html", onFound: (_p, c) => c.header("Cache-Control", "no-cache") }));
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`«Вдвоём» слушает :${info.port}${env.devAuth ? " (DEV_AUTH)" : ""}`);
});

// Необработанное — тоже владельцу. Отказ промиса (обычно сеть до телеграма) сервер
// переживает; после исключения состояние процесса неизвестно, поэтому выходим, а
// docker (restart: unless-stopped) поднимает заново.
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection", e);
  void alarm({ kind: "rejection", error: e });
});
process.on("uncaughtException", (e) => {
  console.error("uncaughtException", e);
  setTimeout(() => process.exit(1), 3000).unref();
  void alarm({ kind: "uncaught", error: e }).finally(() => process.exit(1));
});

void initBot();
startCron();
