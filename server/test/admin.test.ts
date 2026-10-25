import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { all, get, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import type { AppEnv } from "../src/http.ts";
import { alerts, ALERT_UPLOADS_PER_HOUR, feed, label, overview, setBlocked, userCard, users } from "../src/adminData.ts";
import { apiGate } from "../src/track.ts";

// Та же вложенность, что в бою: app → /api → под-роутер с шаблонами маршрутов
env.devAuth = true;
const sub = new Hono<AppEnv>();
sub.post("/wardrobe", (c) => c.json({ ok: true }));
sub.delete("/goals/:id", (c) => c.json({ ok: true }));
sub.post("/presence", (c) => c.json({ ok: true }));
sub.get("/home", (c) => c.json({ ok: true }));
sub.post("/broken", (c) => c.json({ error: "нет" }, 400));
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", sub);
const app = new Hono();
app.route("/api", api);

const as = (id: number, method: string, url: string) => app.request(url, { method, headers: { authorization: `dev ${id}:${encodeURIComponent(`Тест${id}`)}` } });
const actions = (id: number) => all<{ action: string }>("SELECT action FROM activity WHERE user_id = ? ORDER BY id", id).map((r) => r.action);

test("журнал: первый вход, изменения по шаблону маршрута, без чтения, присутствия и ошибок", async () => {
  await as(9701, "GET", "/api/home");
  await as(9701, "POST", "/api/wardrobe");
  await as(9701, "DELETE", "/api/goals/42");
  await as(9701, "POST", "/api/presence");
  await as(9701, "POST", "/api/broken");
  // OPEN — первый запрос после получаса тишины (11.10.2026), дальше в той же сессии не повторяется
  assert.deepEqual(actions(9701), ["JOIN", "OPEN", "POST /wardrobe", "DELETE /goals/:id"]);
  assert.equal(label("POST /wardrobe"), "👕 вещь в гардероб");
  assert.equal(label("DELETE /goals/:id"), "удаление: /goals/:id");
  assert.ok(get<{ seen_at: string }>("SELECT seen_at FROM users WHERE id = 9701")?.seen_at, "отметка «был в сети»");
});

test("блокировка: заблокированному 403 на всё, разблокировка возвращает доступ", async () => {
  setBlocked(9701, true);
  assert.equal((await as(9701, "GET", "/api/home")).status, 403);
  assert.equal((await as(9701, "POST", "/api/wardrobe")).status, 403);
  setBlocked(9701, false);
  assert.equal((await as(9701, "GET", "/api/home")).status, 200);
});

test("админка: человек в списке и карточке, лента, тревога по загрузкам", async () => {
  const me = users().find((u) => u.id === 9701)!;
  assert.equal(me.name, "Тест9701");
  assert.ok(me.actions24h >= 2);
  const card = userCard(9701)!;
  assert.ok(card.recent.some((r) => r.label === "👕 вещь в гардероб"));
  assert.ok(feed(10).some((f) => f.userId === 9701));
  assert.ok(overview().new24h >= 1);

  assert.equal(alerts().some((a) => a.userId === 9701), false, "два действия — не тревога");
  for (let i = 0; i < ALERT_UPLOADS_PER_HOUR; i++) run("INSERT INTO activity (user_id, action) VALUES (9701, 'POST /wardrobe')");
  const a = alerts().find((x) => x.userId === 9701);
  assert.match(a?.why ?? "", /загрузок файлов за час/);
});
