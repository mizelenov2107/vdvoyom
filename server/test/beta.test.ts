// Бета новых тестов (08.10.2026, этап 4): тесты формата 2 и «Шпаргалка» —
// только паре владельца (env.adminIds). Остальные пары живут со старыми семью тестами,
// а новые маршруты им отвечают 404, как несуществующие.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { all, get, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import type { AppEnv } from "../src/http.ts";
import { apiGate } from "../src/track.ts";
import { core } from "../src/routes/core.ts";
import { fun } from "../src/routes/fun.ts";
import { testy } from "../src/routes/testy.ts";
import { plus } from "../src/routes/plus.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { tests, testsV1 } from "../src/content.ts";
import { remindStale, testMessage } from "../src/testy.ts";
import { BETA, isBeta, isBetaPair } from "../src/beta.ts";
import type { UserRow } from "../src/model.ts";

env.devAuth = true;
const OWNER = 9951; // владелец (ADMIN_IDS)
const GIRL = 9952; // его девушка: сама не админ, но в его паре
const A = 9953; // обычная пара
const B = 9954;
env.adminIds.push(OWNER);

// Тот же порядок, что в index.ts: старые тесты (fun) раньше новых (testy)
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", core);
api.route("/", fun);
api.route("/", testy);
api.route("/", plus);
const app = new Hono();
app.route("/api", api);

const call = async (id: number, method: string, url: string, body?: unknown) => {
  const res = await app.request(`/api${url}`, {
    method,
    headers: { authorization: `dev ${id}:${encodeURIComponent(`Тест${id}`)}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
};

function pairOf(a: number, b: number, na: string, nb: string): number {
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded) VALUES (?, ?, ?, 1), (?, ?, ?, 1)", a, na, na, b, nb, nb);
  const p = ensurePair(a);
  assert.ok(joinPair(b, p.invite_code).ok);
  return p.id;
}
const betaPair = pairOf(OWNER, GIRL, "Миша", "Алина");
const plainPair = pairOf(A, B, "Аня", "Боря");
const user = (id: number) => get<UserRow>("SELECT * FROM users WHERE id = ?", id)!;

test("флаг: пара в бете, если в ней владелец; девушка владельца — тоже; обычная пара — нет", async () => {
  assert.equal(BETA.all, false, "по умолчанию бета только у пары владельца");
  assert.ok(isBeta(user(OWNER)) && isBeta(user(GIRL)));
  assert.ok(isBetaPair(betaPair) && !isBetaPair(plainPair));
  assert.ok(!isBeta(user(A)) && !isBeta(user(B)));
  assert.equal((await call(GIRL, "GET", "/me")).data.beta, true);
  const me = (await call(A, "GET", "/me")).data;
  assert.equal(me.beta, false);
});

test("обычная пара: старые семь тестов, «Языки любви» проходится как раньше", async () => {
  const list = (await call(A, "GET", "/tests")).data.tests as { id: string; mine: boolean; partner: boolean }[];
  assert.deepEqual(list.map((t) => t.id), testsV1().map((t) => t.id));
  assert.deepEqual(list.map((t) => t.id), ["love", "thisorthat", "knowme", "money", "life", "future", "dates"]);
  const love = testsV1().find((t) => t.id === "love")!;
  const t = (await call(A, "GET", "/tests/love")).data;
  assert.equal(t.test.title, "Языки любви");
  assert.equal(t.test.questions.length, 30);
  assert.equal(t.mine, null);
  // Аня проходит: ответы Бори закрыты, пока он не прошёл
  const answers = Object.fromEntries(love.questions.map((q, i) => [q.id as string, i % 2 ? "a" : "b"]));
  assert.equal((await call(A, "POST", "/tests/love", { answers })).status, 200);
  const b1 = (await call(B, "GET", "/tests/love")).data;
  assert.equal(b1.partnerDone, true);
  assert.equal(b1.partner, null);
  assert.equal((await call(B, "POST", "/tests/love", { answers })).status, 200);
  const a2 = (await call(A, "GET", "/tests/love")).data;
  assert.deepEqual(a2.partner, answers);
  const row = (await call(A, "GET", "/tests")).data.tests.find((x: { id: string }) => x.id === "love");
  assert.ok(row.mine && row.partner);
  // Ответы лежат в старой таблице, новые таблицы не тронуты
  assert.equal(all("SELECT 1 FROM test_answers WHERE pair_id = ? AND test_id = 'love'", plainPair).length, 2);
  assert.equal(all("SELECT 1 FROM test_rounds WHERE pair_id = ?", plainPair).length, 0);
});

test("обычная пара: новых маршрутов нет — 404, как у несуществующего адреса (не 403)", async () => {
  const unknown = await call(A, "GET", "/net-takogo-adresa");
  assert.equal(unknown.status, 404);
  const routes: [string, string][] = [
    ["GET", "/tests/ugaday"], ["POST", "/tests/ugaday/round"], ["PUT", "/tests/ugaday/draft"],
    ["POST", "/tests/ugaday/finish"], ["POST", "/tests/ugaday/nudge"], ["POST", "/tests/ugaday/talked"], ["POST", "/tests/ugaday/act"],
    ["GET", "/tests/ugaday/rounds/1"], ["GET", "/cheatsheet"],
  ];
  for (const [m, u] of routes) {
    const r = await call(A, m, u, m === "GET" ? undefined : { round: 1, answers: {}, agree: true });
    assert.equal(r.status, 404, `${m} ${u}`);
    // /tests/ugaday отвечает старый обработчик («Нет теста»), остальное — тот же ответ, что у несуществующего адреса
    if (u !== "/tests/ugaday") assert.equal(r.text, unknown.text, `${m} ${u}`);
  }
  // Ни одной записи в новых таблицах и в журнале действий
  assert.equal(all("SELECT 1 FROM test_rounds WHERE pair_id = ?", plainPair).length, 0);
  const acts = all<{ action: string }>("SELECT action FROM activity WHERE user_id = ?", A).map((r) => r.action);
  assert.ok(!acts.some((x) => /cheatsheet|\/tests\/:id\/\w/.test(x)), acts.join(", "));
});

test("обычная пара: на главной и в «Вдвоём+» — только старое, бот о новых тестах молчит", async () => {
  const p = (await call(A, "GET", "/plus")).data;
  assert.deepEqual(p.testList.map((t: { id: string }) => t.id), testsV1().map((t) => t.id));
  assert.deepEqual(p.freeTests, ["Языки любви", "Это или то"]);
  assert.equal(p.tests, 7);
  assert.equal((await call(A, "GET", "/home")).data.testWaiting, null);
  assert.equal(await testMessage(user(B), "тест", "tests", "Открыть"), "off");
  // Если у обычной пары откуда-то есть старый раунд нового теста — напоминание не уходит
  run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids) VALUES (?, 'ugaday', 1, '[]')", plainPair);
  run("INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, finished_at) VALUES (?, 'ugaday', 1, ?, '{}', datetime('now', '-3 days'))", plainPair, A);
  await remindStale();
  assert.equal(get("SELECT 1 FROM sent WHERE key LIKE ?", `tests:${B}:%`), undefined);
  assert.equal(get<{ reminded_at: string | null }>("SELECT reminded_at FROM test_rounds WHERE pair_id = ?", plainPair)!.reminded_at, null);
  run("DELETE FROM test_round_answers WHERE pair_id = ?", plainPair);
  run("DELETE FROM test_rounds WHERE pair_id = ?", plainPair);
});

test("бета: новые тесты и «Шпаргалка» у обоих, старых тестов нет", async () => {
  const list = (await call(GIRL, "GET", "/tests")).data.tests as { id: string }[];
  assert.deepEqual(list.map((t) => t.id), tests().map((t) => t.id));
  assert.ok(!list.some((t) => t.id === "love"));
  assert.equal((await call(GIRL, "GET", "/tests/love")).status, 404);
  assert.equal((await call(GIRL, "POST", "/tests/love", { answers: {} })).status, 404);
  assert.equal((await call(GIRL, "GET", "/cheatsheet")).status, 200);
  assert.equal((await call(OWNER, "POST", "/tests/ugaday/round")).status, 200);
  const p = (await call(OWNER, "GET", "/plus")).data;
  assert.ok(p.testList.some((t: { id: string }) => t.id === "ugaday"));
});

test("открыть всем — одна правка: BETA.all (TESTY_V2=all)", async () => {
  BETA.all = true;
  try {
    assert.ok(isBeta(user(A)));
    assert.equal((await call(A, "GET", "/me")).data.beta, true);
    const list = (await call(A, "GET", "/tests")).data.tests as { id: string }[];
    assert.ok(list.some((t) => t.id === "ugaday") && !list.some((t) => t.id === "love"));
    assert.equal((await call(A, "GET", "/cheatsheet")).status, 200);
  } finally {
    BETA.all = false;
  }
  assert.equal((await call(A, "GET", "/cheatsheet")).status, 404);
});
