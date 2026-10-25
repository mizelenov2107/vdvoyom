// Ошибки сервера — владельцу (11.10.2026): 5xx и необработанное, не чаще одного
// одинакового за 10 минут, без тела запроса и данных людей, кроме id.
// Без BOT_TOKEN бот пишет в журнал строкой «[бот → …]» — по ней и проверяем.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { env } from "../src/env.ts";
import { onError, type AppEnv } from "../src/http.ts";
import { apiGate } from "../src/track.ts";
import { alarm, alarmOn5xx, ALARM_GAP_MS, faultText, resetAlarms } from "../src/alarm.ts";

env.devAuth = true;
env.supportChatId = 777;
const sub = new Hono<AppEnv>();
sub.post("/crash/:id", async (c) => {
  await c.req.json();
  throw new TypeError("Cannot read properties of undefined (reading 'title')");
});
sub.get("/down", (c) => c.json({ error: "Яндекс не ответил" }, 503));
sub.get("/fine", (c) => c.json({ ok: true }));
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", sub);
const app = new Hono<AppEnv>();
app.use("*", alarmOn5xx);
app.onError(onError);
app.route("/api", api);

/** Что «ушло владельцу» за время fn: строки журнала «[бот → 777] …». */
async function captured(fn: () => unknown): Promise<string[]> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = () => {};
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    console.log = log;
    console.error = err;
  }
  return lines.filter((l) => l.startsWith("[бот → 777]"));
}
const hdr = { authorization: `dev 7901:${encodeURIComponent("Тест")}`, "content-type": "application/json" };
const body = JSON.stringify({ title: "Секретное свидание", phone: "+79990001122" });

test("500 из-за исключения: маршрут шаблоном, ошибка, место в коде, id — и ничего из тела запроса", async () => {
  resetAlarms();
  const out = await captured(async () => {
    const r = await app.request("/api/crash/42?token=abc", { method: "POST", headers: hdr, body });
    assert.equal(r.status, 500);
    assert.equal((await r.json()).error, "Что-то сломалось на сервере");
  });
  assert.equal(out.length, 1);
  const text = out[0];
  assert.match(text, /Ошибка сервера/);
  assert.match(text, /500 POST \/api\/crash\/:id/);
  assert.match(text, /TypeError: Cannot read properties of undefined/);
  assert.match(text, /\nsrc\/[\w/]+\.ts:\d+:\d+\n/, "где упало: первая строка стека из src/");
  assert.match(text, /id 7901/);
  for (const secret of ["Секретное", "+7999", "42", "token", "Тест"]) assert.equal(text.includes(secret), false, `в сообщении нет «${secret}»`);
});

test("одинаковая ошибка — не чаще раза в 10 минут, другая — сразу", async () => {
  resetAlarms();
  const out = await captured(async () => {
    for (let i = 0; i < 3; i++) await app.request(`/api/crash/${i}`, { method: "POST", headers: hdr, body });
    await app.request("/api/down", { headers: hdr });
  });
  assert.equal(out.length, 2, "три одинаковых падения — одно сообщение, плюс 503");
  assert.match(out[1], /503 GET \/api\/down/);
  const f = { kind: "request" as const, status: 500, method: "GET", route: "/api/x", error: new Error("boom") };
  const t0 = Date.now() + 60 * 60_000;
  assert.equal(await captured(() => alarm(f, t0)).then((l) => l.length), 1);
  assert.equal(await alarm(f, t0 + ALARM_GAP_MS - 1), false);
  assert.equal(await captured(() => alarm(f, t0 + ALARM_GAP_MS)).then((l) => l.length), 1);
});

test("4xx и 2xx владельцу не пишутся", async () => {
  resetAlarms();
  const out = await captured(async () => {
    await app.request("/api/fine", { headers: hdr });
    await app.request("/api/nope", { headers: hdr });
    await app.request("/api/fine");
  });
  assert.deepEqual(out, []);
});

test("необработанное вне запроса: вид ошибки и место, без пути до папки проекта", () => {
  const e = new RangeError("Invalid time value");
  e.stack = `RangeError: Invalid time value\n    at toISOString (<anonymous>)\n    at tick (/app/server/src/cron.ts:44:12)`;
  const text = faultText({ kind: "rejection", error: e });
  assert.match(text, /Необработанный отказ промиса/);
  assert.match(text, /RangeError: Invalid time value/);
  assert.match(text, /src\/cron\.ts:44:12/);
  assert.equal(text.includes("/app/server"), false);
  assert.match(faultText({ kind: "uncaught", error: "строка" }), /перезапускается/);
});
