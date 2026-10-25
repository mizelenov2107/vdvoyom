// События воронки (11.10.2026): OPEN, PAIR, LOCK:<feature> по ответу 402, события
// клиента через POST /api/track с белым списком. Без ответов.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { all, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import { onError, type AppEnv } from "../src/http.ts";
import { apiGate, trackRoute } from "../src/track.ts";
import { needPlus } from "../src/limits.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { label } from "../src/adminData.ts";

env.devAuth = true;
env.plusOn = true;
const sub = new Hono<AppEnv>();
sub.get("/home", (c) => c.json({ ok: true }));
sub.post("/goals", (c) => {
  needPlus(c.get("user").pair_id ?? 0, "goals", 5);
  return c.json({ ok: true });
});
sub.post("/tests/:id/round", (c) => {
  needPlus(c.get("user").pair_id ?? 0, "tests");
  return c.json({ ok: true });
});
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", sub);
api.route("/", trackRoute);
const app = new Hono();
app.onError(onError);
app.route("/api", api);

const hdr = (id: number) => ({ authorization: `dev ${id}:${encodeURIComponent(`Тест${id}`)}`, "content-type": "application/json" });
const get = (id: number, url: string) => app.request(url, { headers: hdr(id) });
const post = (id: number, url: string, body: unknown = {}) => app.request(url, { method: "POST", headers: hdr(id), body: JSON.stringify(body) });
const actions = (id: number) => all<{ action: string }>("SELECT action FROM activity WHERE user_id = ? ORDER BY id", id).map((r) => r.action);

test("OPEN: первый запрос, потом не чаще раза в 30 минут тишины", async () => {
  await get(7201, "/api/home");
  await get(7201, "/api/home");
  assert.deepEqual(actions(7201), ["JOIN", "OPEN"]);
  run("UPDATE users SET seen_at = datetime('now', '-20 minutes') WHERE id = 7201");
  await get(7201, "/api/home");
  assert.deepEqual(actions(7201), ["JOIN", "OPEN"], "20 минут — та же сессия");
  run("UPDATE users SET seen_at = datetime('now', '-31 minutes') WHERE id = 7201");
  await get(7201, "/api/home");
  assert.deepEqual(actions(7201), ["JOIN", "OPEN", "OPEN"]);
  assert.equal(label("OPEN"), "📱 открытие приложения");
});

test("PAIR: когда второй пришёл по приглашению, и только один раз", async () => {
  await get(7211, "/api/home");
  await get(7212, "/api/home");
  const code = ensurePair(7211).invite_code;
  joinPair(7212, code);
  joinPair(7212, code); // повторное открытие той же ссылки
  assert.equal(actions(7212).filter((a) => a === "PAIR").length, 1);
  assert.equal(actions(7211).includes("PAIR"), false, "пишется у пришедшего, пара — в pair_id");
});

test("упор в замок: 402 пишется как LOCK:<feature>", async () => {
  await get(7221, "/api/home");
  ensurePair(7221);
  const r = await post(7221, "/api/goals");
  assert.equal(r.status, 402);
  assert.equal((await r.json()).plus, "goals", "клиент получает тот же ответ, журнал его не съел");
  await post(7221, "/api/tests/dengi/round");
  const acts = actions(7221);
  assert.ok(acts.includes("LOCK:goals"));
  assert.ok(acts.includes("LOCK:tests"));
  assert.equal(label("LOCK:goals"), "🔒 упор в замок: цели");
});

test("события клиента: белый список, раздел проверяется", async () => {
  await get(7231, "/api/home");
  assert.equal((await post(7231, "/api/track", { name: "plus_view", props: { from: "menu" } })).status, 200);
  assert.equal((await post(7231, "/api/track", { name: "plus_view", props: { from: "куда-то" } })).status, 200);
  assert.equal((await post(7231, "/api/track", { name: "lock_view", props: { feature: "wardrobe" } })).status, 200);
  assert.equal((await post(7231, "/api/track", { name: "lock_view", props: { feature: "tests" } })).status, 200);
  assert.equal((await post(7231, "/api/track", { name: "lock_view", props: { feature: "что-то" } })).status, 400);
  assert.equal((await post(7231, "/api/track", { name: "answer", props: { text: "секрет" } })).status, 400);
  assert.equal((await post(7231, "/api/track", "не объект")).status, 400);
  const acts = actions(7231);
  assert.deepEqual(acts.filter((a) => a !== "JOIN" && a !== "OPEN"), ["PLUS_VIEW:menu", "PLUS_VIEW:other", "LOCK_VIEW:wardrobe", "LOCK_VIEW:tests"]);
  assert.equal(acts.includes("POST /track"), false, "сама ручка в журнал не пишется");
  assert.equal(label("PLUS_VIEW:menu"), "💎 экран «Вдвоём+» из меню");
});

test("события клиента: одинаковое — не чаще раза в минуту", async () => {
  await get(7241, "/api/home");
  for (let i = 0; i < 5; i++) await post(7241, "/api/track", { name: "plus_view", props: { from: "home" } });
  assert.equal(actions(7241).filter((a) => a === "PLUS_VIEW:home").length, 1);
  run("UPDATE activity SET at = datetime('now', '-2 minutes') WHERE user_id = 7241");
  await post(7241, "/api/track", { name: "plus_view", props: { from: "home" } });
  assert.equal(actions(7241).filter((a) => a === "PLUS_VIEW:home").length, 2);
});

test("события клиента без входа — 401", async () => {
  const r = await app.request("/api/track", { method: "POST", body: JSON.stringify({ name: "plus_view" }), headers: { "content-type": "application/json" } });
  assert.equal(r.status, 401);
});
