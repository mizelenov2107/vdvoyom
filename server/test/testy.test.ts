// Тесты на совместимость, формат 2 (08.10.2026): раунды, черновик, результат,
// действия, закрытые тесты и бот без спама.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { all, get, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import type { AppEnv } from "../src/http.ts";
import { apiGate } from "../src/track.ts";
import { testy } from "../src/routes/testy.ts";
import { core } from "../src/routes/core.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { tests, type Test } from "../src/content.ts";
import { summarize, testMessage, waitingFor, nextSaturday, remindStale } from "../src/testy.ts";
import type { UserRow } from "../src/model.ts";
import { BETA } from "../src/beta.ts";

env.devAuth = true;
// Новые тесты — бета пары владельца (beta.ts); здесь проверяется сама механика, как при открытии всем
BETA.all = true;
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", core);
api.route("/", testy);
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
  return { status: res.status, data };
};

const A = 9801;
const B = 9802;
run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded) VALUES (?, 'Лёва', 'Лёва', 1), (?, 'Нина', 'Нина', 1)", A, B);
const pairId = ensurePair(A).id;
assert.ok(joinPair(B, ensurePair(A).invite_code).ok);
// Механика раундов — со «Вдвоём+»: тесты сервера идут с PLUS=1, а без него второй раунд
// закрыт (08.10.2026). Граница бесплатного — в limits.test.ts
run("UPDATE pairs SET plus_until = '2099-12-31' WHERE id = ?", pairId);

/** Ответить на все вопросы раунда: про себя — первый вариант, догадка — как скажут. */
function answersFor(qs: { id: string; options: { id: string }[] }[], pick: (i: number) => number, guess?: (i: number) => number) {
  return Object.fromEntries(qs.map((q, i) => [q.id, { self: q.options[pick(i)].id, ...(guess ? { guess: q.options[guess(i)].id } : {}) }]));
}

test("тесты формата 2: 8 тестов, пулы 40–60, раунд 10–12, id вариантов уникальны", () => {
  const list = tests();
  assert.equal(list.length, 8);
  const seen = new Set<string>();
  for (const t of list) {
    assert.ok(t.pool.length >= 40 && t.pool.length <= 60, `${t.id}: ${t.pool.length}`);
    assert.ok(t.perRound >= 10 && t.perRound <= 12);
    for (const q of t.pool) {
      assert.ok(!seen.has(q.id), `повтор ${q.id}`);
      seen.add(q.id);
      assert.ok(q.talk.length >= 2 && q.talk.length <= 3, `${q.id}: talk`);
      const ids = q.options.map((o) => o.id);
      assert.equal(new Set(ids).size, ids.length, `${q.id}: варианты`);
      assert.ok(!ids.includes("none") && !ids.includes("any"));
      // Без рода и без города
      for (const s of [q.self, ...q.options.map((o) => o.text), ...q.talk]) {
        assert.doesNotMatch(s, /\([а-яё]{1,3}\)|\bМоскв|\bПитер/, `${q.id}: ${s}`);
      }
    }
  }
});

test("раунд: черновик, назад, ответы партнёра только когда закончили оба, сообщение — после отправки", async () => {
  const start = await call(A, "POST", "/tests/ugaday/round");
  assert.equal(start.status, 200);
  assert.equal(start.data.round, 1);
  // Партнёр попадает в тот же раунд
  assert.equal((await call(B, "POST", "/tests/ugaday/round")).data.round, 1);
  const view = (await call(A, "GET", "/tests/ugaday")).data;
  const qs = view.round.questions;
  assert.equal(qs.length, 10);
  assert.equal(qs[0].options.at(-1).text, "Ни один не подходит");
  assert.match(qs[0].about, /Нина/);

  // Черновик: три ответа, позиция 3
  const part = Object.fromEntries(Object.entries(answersFor(qs, () => 0, () => 0)).slice(0, 3));
  assert.equal((await call(A, "PUT", "/tests/ugaday/draft", { round: 1, answers: part, pos: 3 })).status, 200);
  const again = (await call(A, "GET", "/tests/ugaday")).data.round;
  assert.equal(Object.keys(again.mine.answers).length, 3);
  assert.equal(again.mine.pos, 3);
  assert.equal(again.mine.finished, false);

  // Три пропуска — нельзя
  const skips = Object.fromEntries(qs.slice(0, 3).map((q: { id: string }) => [q.id, { skip: true }]));
  assert.equal((await call(A, "PUT", "/tests/ugaday/draft", { round: 1, answers: skips, pos: 3 })).status, 400);
  // Неполный раунд не отправляется
  assert.equal((await call(A, "POST", "/tests/ugaday/finish", { round: 1, answers: part })).status, 400);

  // Лёва: всё первым вариантом, догадки — первый вариант; два пропуска
  const mine = answersFor(qs, () => 0, () => 0);
  mine[qs[8].id] = { skip: true } as never;
  mine[qs[9].id] = { skip: true } as never;
  const fin = await call(A, "POST", "/tests/ugaday/finish", { round: 1, answers: mine });
  assert.equal(fin.status, 200);
  assert.equal(fin.data.closed, false);
  // Поменять отправленное нельзя
  assert.equal((await call(A, "PUT", "/tests/ugaday/draft", { round: 1, answers: mine, pos: 1 })).status, 409);
  // Партнёру ответы Лёвы не видны
  const nina = (await call(B, "GET", "/tests/ugaday")).data.round;
  assert.equal(nina.partner, null);
  assert.equal(nina.partnerFinished, true);
  assert.equal(nina.summary, null);
  // На главной у Нины — «Лёва ждёт тебя»
  const nRow = get<UserRow>("SELECT * FROM users WHERE id = ?", B)!;
  assert.equal(waitingFor(nRow, get<UserRow>("SELECT * FROM users WHERE id = ?", A))?.id, "ugaday");

  // Нина: первые 4 как Лёва (совпали), 5–6 другой вариант и угадала Лёву, Лёва её — нет (сюрприз),
  // 7–8 — «ни один не подходит»
  const hers = answersFor(qs, (i) => (i < 4 ? 0 : 1), () => 0);
  hers[qs[6].id] = { self: "none", guess: qs[6].options[0].id };
  hers[qs[7].id] = { self: "none", guess: qs[7].options[0].id };
  const fin2 = await call(B, "POST", "/tests/ugaday/finish", { round: 1, answers: hers });
  assert.equal(fin2.data.closed, true);
  const res = (await call(A, "GET", "/tests/ugaday")).data.round;
  assert.ok(res.closedAt);
  assert.deepEqual(res.summary.counts, { same: 4, known: 0, surprise: 2, own: 2, diff: 0 });
  assert.equal(res.summary.hits.total, 8);
  assert.equal(res.summary.hits.me, 4, "Лёва угадал только совпавшие");
  assert.equal(res.summary.hits.them, 8, "Нина всегда угадывала первый вариант");
});

test("действие создаёт сущность один раз, «Обсудили» видят оба, шпаргалка из промахов", async () => {
  const r = (await call(A, "GET", "/tests/ugaday")).data.round;
  const surprise = r.summary.items.find((i: { outcome: string }) => i.outcome === "surprise");
  const q = r.questions.find((x: { id: string }) => x.id === surprise.id);
  const act = await call(A, "POST", "/tests/ugaday/act", { round: 1, q: q.id });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  const [kind, id] = String(act.data.ref).split(":");
  const tables: Record<string, string> = { task: "tasks", event: "events", wish: "wishes", goal: "goals", plan: "plans", capsule: "capsules", note: "notes" };
  if (tables[kind]) assert.ok(get(`SELECT 1 FROM ${tables[kind]} WHERE id = ? AND pair_id = ?`, Number(id), pairId), "сущность создана");
  const twice = await call(A, "POST", "/tests/ugaday/act", { round: 1, q: q.id });
  assert.equal(twice.data.again, true);

  await call(A, "POST", "/tests/ugaday/talked", { round: 1, q: q.id });
  assert.deepEqual((await call(B, "GET", "/tests/ugaday")).data.round.marks.talked, [q.id]);

  // Лёва не угадал Нину в двух сюрпризах — они в его шпаргалке
  const sheet = (await call(A, "GET", "/cheatsheet")).data;
  assert.equal(sheet.name, "Нина");
  assert.ok(sheet.entries.length >= 2);
  assert.ok(sheet.entries.some((e: { questionId: string }) => e.questionId === surprise.id));

  // Промахи уже в шпаргалке: кнопка «Запомнить в шпаргалке» у них сразу «В шпаргалке» (проверка 08.10)
  const after = (await call(A, "GET", "/tests/ugaday")).data.round;
  const inSheet = new Set(sheet.entries.map((e: { questionId: string }) => e.questionId));
  const cheatQs = (after.questions as { id: string; act: { type: string } | null }[]).filter((x) => x.act?.type === "cheat" && inSheet.has(x.id));
  for (const x of cheatQs) assert.equal(after.marks.acts[x.id], "cheat", `промах ${x.id} — уже в шпаргалке`);
});

test("второй раунд — новые вопросы и не переписывает первый", async () => {
  const first = (await call(A, "GET", "/tests/ugaday")).data.round;
  const n = (await call(A, "POST", "/tests/ugaday/round")).data.round;
  assert.equal(n, 2);
  const second = (await call(A, "GET", "/tests/ugaday")).data;
  const ids1 = new Set(first.questions.map((q: { id: string }) => q.id));
  assert.ok(second.round.questions.every((q: { id: string }) => !ids1.has(q.id)), "без повторов");
  assert.equal(second.history.length, 1);
  assert.equal(second.history[0].n, 1);
  const old = (await call(A, "GET", "/tests/ugaday/rounds/1")).data.round;
  assert.deepEqual(old.summary.counts, first.summary.counts, "первый раунд на месте");
});

test("пул кончился — вопросы по второму кругу, без падения", async () => {
  const t = tests().find((x) => x.id === "svidanie")!;
  const rounds = Math.ceil(t.pool.length / t.perRound);
  for (let i = 0; i < rounds; i++) {
    const n = (await call(A, "POST", "/tests/svidanie/round")).data.round;
    const qs = (await call(A, "GET", "/tests/svidanie")).data.round.questions;
    const answers = Object.fromEntries(qs.map((q: { id: string; options: { id: string }[] }) => [q.id, { self: q.options[0].id }]));
    await call(A, "POST", "/tests/svidanie/finish", { round: n, answers });
    const fin = await call(B, "POST", "/tests/svidanie/finish", { round: n, answers });
    assert.equal(fin.data.closed, true);
  }
  const last = (await call(A, "GET", "/tests/svidanie")).data;
  assert.ok(last.round.profile.ideas.length === 3, "три идеи свидания");
  assert.equal(last.unseen, 0);
  const n = (await call(A, "POST", "/tests/svidanie/round")).data.round;
  const again = (await call(A, "GET", "/tests/svidanie")).data.round;
  assert.equal(again.n, n);
  assert.equal(again.again, true);
  assert.equal(again.questions.length, t.perRound);
  // «Запланировать» идею: свидание-приглашение на ближайшую субботу
  const idea = last.round.profile.ideas[0];
  const plan = await call(A, "POST", "/tests/svidanie/act", { round: last.round.n, idea: idea.id });
  const ev = get<{ kind: string; status: string; date: string }>("SELECT kind, status, date FROM events WHERE id = ?", Number(String(plan.data.ref).split(":")[1]))!;
  assert.deepEqual([ev.kind, ev.status, ev.date], ["date", "proposed", nextSaturday()]);
});

test("старые ответы (test_answers) остаются в базе и ничего не роняют; старый id теста — 404", async () => {
  run("INSERT OR REPLACE INTO test_answers (pair_id, test_id, user_id, answers) VALUES (?, 'love', ?, '{\"l1\":\"a\"}')", pairId, A);
  assert.equal((await call(A, "GET", "/tests")).status, 200);
  assert.equal((await call(A, "GET", "/tests/love")).status, 404);
  assert.ok(get("SELECT 1 FROM test_answers WHERE pair_id = ? AND test_id = 'love'", pairId));
});

test("бот: о тестах не чаще раза в сутки, выключается отдельным пунктом, напоминание через 48 часов — один раз", async () => {
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded) VALUES (9811, 'Ира', 'Ира', 1), (9812, 'Кира', 'Кира', 1)");
  const p = ensurePair(9811);
  assert.ok(joinPair(9812, p.invite_code).ok);
  run("UPDATE pairs SET plus_until = '2099-12-31' WHERE id = ?", p.id); // «Деньги» во «Вдвоём+», а тесты сервера идут с PLUS=1
  const u = () => get<UserRow>("SELECT * FROM users WHERE id = 9812")!;
  run("DELETE FROM sent WHERE key LIKE 'tests:9812:%'");
  assert.equal(await testMessage(u(), "раз", "tests", "Открыть"), "sent");
  assert.equal(await testMessage(u(), "два", "tests", "Открыть"), "capped");
  run("DELETE FROM sent WHERE key LIKE 'tests:9812:%'");
  run("UPDATE users SET muted = '[\"tests\"]' WHERE id = 9812");
  assert.equal(await testMessage(u(), "три", "tests", "Открыть"), "off");
  run("UPDATE users SET muted = '[]' WHERE id = 9812");

  // Ира закончила раунд 3 дня назад, Кира — нет: одно напоминание
  await call(9811, "POST", "/tests/dengi/round");
  const qs = (await call(9811, "GET", "/tests/dengi")).data.round.questions;
  await call(9811, "POST", "/tests/dengi/finish", { round: 1, answers: answersFor(qs, () => 0, () => 0) });
  run("UPDATE test_round_answers SET finished_at = datetime('now', '-3 days') WHERE pair_id = ? AND user_id = 9811", p.id);
  run("DELETE FROM sent WHERE key LIKE 'tests:9812:%'");
  await remindStale();
  const r = get<{ reminded_at: string | null }>("SELECT reminded_at FROM test_rounds WHERE pair_id = ? AND test_id = 'dengi'", p.id)!;
  assert.ok(r.reminded_at, "напомнили");
  assert.ok(get("SELECT 1 FROM sent WHERE key LIKE 'tests:9812:%'"));
  run("DELETE FROM sent WHERE key LIKE 'tests:9812:%'");
  await remindStale();
  assert.equal(all("SELECT key FROM sent WHERE key LIKE 'tests:9812:%'").length, 0, "второй раз не напоминаем");

  // «Напомнить» вручную — раз в сутки
  assert.equal((await call(9811, "POST", "/tests/dengi/nudge")).status, 200);
  assert.equal((await call(9811, "POST", "/tests/dengi/nudge")).status, 429);
});

test("разбор: «знали, что разные» — оба угадали чужой ответ", () => {
  const t = tests().find((x) => x.id === "dengi")!;
  const q = t.pool[0];
  const [o1, o2] = q.options;
  const s = summarize(t, [q], { [q.id]: { self: o1.id, guess: o2.id } }, { [q.id]: { self: o2.id, guess: o1.id } });
  assert.equal(s.items[0].outcome, "known");
});
