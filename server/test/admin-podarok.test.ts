// «Вдвоём+» из админки (11.10.2026): POST /api/admin/pairs/:id/plus — месяц, год,
// навсегда, до даты. Строка в payments с method='gift', запись в журнал, сообщение паре.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { all, get, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import { onError, type AppEnv } from "../src/http.ts";
import { apiGate } from "../src/track.ts";
import { adminApp } from "../src/routes/adminApp.ts";
import { admin } from "../src/routes/admin.ts";
import { FOREVER, plusOf } from "../src/plus.ts";
import { addDays, today } from "../src/time.ts";
import { grantPlus, label } from "../src/adminData.ts";

env.devAuth = true;
env.adminIds = [7601];
env.adminToken = "test-key-123";
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/admin", adminApp);
const app = new Hono();
app.onError(onError);
app.route("/api", api);
app.route("/admin", admin);

const as = (id: number, url: string, body: unknown) =>
  app.request(url, { method: "POST", headers: { authorization: `dev ${id}:${encodeURIComponent("Тест")}`, "content-type": "application/json" }, body: JSON.stringify(body) });

function newPair(id: number, a: number, b: number) {
  run("INSERT INTO pairs (id, invite_code) VALUES (?, ?)", id, `g${id}`);
  run("INSERT INTO users (id, first_name, pair_id, created_at) VALUES (?, 'А', ?, datetime('now', '-1 day')), (?, 'Б', ?, datetime('now'))", a, id, b, id);
}
const gifts = (pairId: number) => all<{ plan: string; amount: number; status: string; method: string; user_id: number }>("SELECT plan, amount, status, method, user_id FROM payments WHERE pair_id = ? ORDER BY rowid", pairId).map((r) => ({ ...r }));

test("месяц, потом год прибавляются к сроку; в payments — gift на 0 ₽, в журнале — кто выдал", async () => {
  newPair(8701, 76011, 76012);
  const r1 = await as(7601, "/api/admin/pairs/8701/plus", { term: "month" });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.until, addDays(today(), 30));
  assert.equal(j1.pair.plusActive, true);
  assert.equal(plusOf(8701).active, true);
  await as(7601, "/api/admin/pairs/8701/plus", { term: "year" });
  assert.equal(plusOf(8701).until, addDays(today(), 395));
  assert.deepEqual(gifts(8701), [
    { plan: "month", amount: 0, status: "succeeded", method: "gift", user_id: 76011 },
    { plan: "year", amount: 0, status: "succeeded", method: "gift", user_id: 76011 },
  ]);
  const log = all<{ user_id: number; pair_id: number; action: string }>("SELECT user_id, pair_id, action FROM activity WHERE action LIKE 'GIFT_PLUS:%' AND pair_id = 8701").map((r) => ({ ...r }));
  assert.deepEqual(log, [
    { user_id: 7601, pair_id: 8701, action: "GIFT_PLUS:month" },
    { user_id: 7601, pair_id: 8701, action: "GIFT_PLUS:year" },
  ]);
  assert.equal(label("GIFT_PLUS:forever"), "🎁 выдан «Вдвоём+» навсегда");
});

test("до даты: ровно до неё; прошедшая дата и срок короче уже открытого — отказ", async () => {
  newPair(8702, 76021, 76022);
  const d = addDays(today(), 45);
  assert.equal((await (await as(7601, "/api/admin/pairs/8702/plus", { term: "date", until: d })).json()).until, d);
  assert.equal(plusOf(8702).until, d);
  const shorter = await as(7601, "/api/admin/pairs/8702/plus", { term: "date", until: addDays(today(), 10) });
  assert.equal(shorter.status, 409);
  assert.match((await shorter.json()).error, /Уже открыто/);
  assert.equal((await as(7601, "/api/admin/pairs/8702/plus", { term: "date", until: "2020-01-01" })).status, 400);
  assert.equal((await as(7601, "/api/admin/pairs/8702/plus", { term: "date", until: "завтра" })).status, 400);
  assert.equal(gifts(8702).length, 1, "отказ не пишет платёж");
});

test("навсегда — FOREVER, после этого больше не выдаётся", async () => {
  newPair(8703, 76031, 76032);
  const r = await (await as(7601, "/api/admin/pairs/8703/plus", { term: "forever" })).json();
  assert.equal(r.forever, true);
  assert.equal(plusOf(8703).until, FOREVER);
  assert.equal((await as(7601, "/api/admin/pairs/8703/plus", { term: "month" })).status, 409);
});

test("чужим нельзя, неизвестная пара и срок — ошибки", async () => {
  newPair(8704, 76041, 76042);
  assert.equal((await as(76041, "/api/admin/pairs/8704/plus", { term: "forever" })).status, 403);
  assert.equal(plusOf(8704).active, false);
  assert.equal((await as(7601, "/api/admin/pairs/99999/plus", { term: "month" })).status, 404);
  assert.equal((await as(7601, "/api/admin/pairs/8704/plus", { term: "week" })).status, 400);
  assert.throws(() => grantPlus(8704, "lifetime" as never, 7601), /Срок/);
});

test("«Ассистент» по ключу: тот же подарок, в журнале — id 0", async () => {
  newPair(8705, 76051, 76052);
  const r = await app.request("/admin/pairs/8705/plus", {
    method: "POST",
    headers: { authorization: "Bearer test-key-123", "content-type": "application/json" },
    body: JSON.stringify({ term: "month", notify: false }),
  });
  assert.equal(r.status, 200);
  assert.equal(get<{ user_id: number }>("SELECT user_id FROM activity WHERE action = 'GIFT_PLUS:month' AND pair_id = 8705")?.user_id, 0);
  const bad = await app.request("/admin/pairs/8705/plus", { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
  assert.equal(bad.status, 404);
});

test("сообщение паре: без токена бот пишет в журнал обоим", async () => {
  newPair(8706, 76061, 76062);
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await as(7601, "/api/admin/pairs/8706/plus", { term: "forever" });
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    console.log = orig;
  }
  assert.ok(lines.some((l) => l.startsWith("[бот → 76061]") && l.includes("подарили «Вдвоём+» навсегда")));
  assert.ok(lines.some((l) => l.startsWith("[бот → 76062]")));
});
