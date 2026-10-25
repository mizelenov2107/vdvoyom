import { test } from "node:test";
import assert from "node:assert/strict";
import { HTTPException } from "hono/http-exception";
import { run } from "../src/db.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { FREE, needPlus, testLocked } from "../src/limits.ts";
import { benefitAt, offerOf, plusOf, OFFER_HOURS } from "../src/plus.ts";
import { addDays, today } from "../src/time.ts";

run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9401, 'Бесплатный', 1)");
const pairId = ensurePair(9401).id;

const code = (fn: () => void): number | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as HTTPException).status;
  }
};

test("лимиты: до порога можно, сверх — 402, со «Вдвоём+» — без ограничений", () => {
  assert.equal(code(() => needPlus(pairId, "films", FREE.films - 1)), null, "пятый фильм ещё бесплатно");
  assert.equal(code(() => needPlus(pairId, "films", FREE.films)), 402, "шестой — во «Вдвоём+»");
  assert.equal(code(() => needPlus(pairId, "tests")), 402);
  assert.equal(testLocked(pairId, "ugaday"), false, "«Угадай меня» открыт всем");
  assert.equal(testLocked(pairId, "dengi"), true);

  run("UPDATE pairs SET plus_until = ? WHERE id = ?", addDays(today(), 30), pairId);
  assert.equal(plusOf(pairId).active, true);
  assert.equal(code(() => needPlus(pairId, "films", 500)), null);
  assert.equal(testLocked(pairId, "dengi"), false);
  run("UPDATE pairs SET plus_until = NULL, offer_until = NULL WHERE id = ?", pairId);
});

test("акция: только после общей пользы и по явному старту, 72 часа, не сбрасывается и заканчивается", () => {
  assert.equal(offerOf(pairId, true), null, "пока половинки нет, таймер не заводится");
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9402, 'Половинка', 1)");
  assert.ok(joinPair(9402, ensurePair(9401).invite_code).ok);
  assert.equal(offerOf(pairId, true), null, "пара пришла, но общей пользы ещё нет — не продаём");
  assert.equal(benefitAt(pairId), null);

  // Ответил на вопрос дня один — это ещё не польза; ответили оба — польза
  run("INSERT INTO daily_answers (pair_id, date, user_id, text, created_at) VALUES (?, '2026-10-01', 9401, 'а', '2026-10-01 17:00:00')", pairId);
  assert.equal(benefitAt(pairId), null, "ответ одного — не общая польза");
  run("INSERT INTO daily_answers (pair_id, date, user_id, text, created_at) VALUES (?, '2026-10-01', 9402, 'б', '2026-10-01 18:00:00')", pairId);
  assert.equal(benefitAt(pairId), "2026-10-01T18:00:00Z", "польза — когда ответил второй");
  // Мэтч раньше — польза с него
  run("INSERT INTO matches (pair_id, deck, item, created_at) VALUES (?, 'movie', 'tt1', '2026-09-30 10:00:00')", pairId);
  assert.equal(benefitAt(pairId), "2026-09-30T10:00:00Z", "самое раннее из всех");

  assert.equal(offerOf(pairId), null, "просто заход (GET /me, /plus) таймер не заводит");
  const first = offerOf(pairId, true)!;
  assert.equal(first.active, true);
  const hours = (Date.parse(first.until) - Date.now()) / 3_600_000;
  assert.ok(hours > OFFER_HOURS - 0.1 && hours <= OFFER_HOURS, `осталось ${hours} ч`);
  assert.equal(offerOf(pairId)!.until, first.until, "дальше акция видна и без старта");
  assert.equal(offerOf(pairId, true)!.until, first.until, "повторный старт не продлевает таймер");

  run("UPDATE pairs SET offer_until = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), pairId);
  assert.equal(offerOf(pairId)!.active, false, "время вышло — акции нет");
  assert.equal(offerOf(pairId, true)!.until < new Date().toISOString(), true, "и новый таймер не заводится");
});

test("общая польза: раунд теста у обоих", () => {
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9411, 'А', 1), (9412, 'Б', 1)");
  const p = ensurePair(9411).id;
  assert.ok(joinPair(9412, ensurePair(9411).invite_code).ok);
  assert.equal(benefitAt(p), null);
  run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids) VALUES (?, 'ugaday', 1, '[]')", p);
  assert.equal(benefitAt(p), null, "раунд открыт, но не закрыт");
  run("UPDATE test_rounds SET closed_at = '2026-10-02 12:00:00' WHERE pair_id = ?", p);
  assert.equal(benefitAt(p), "2026-10-02T12:00:00Z", "раунд закрыт");
});

test("закрытый тест (PLUS не задан): замков, лимитов и акции нет", async () => {
  const { env } = await import("../src/env.ts");
  env.plusOn = false;
  try {
    assert.equal(code(() => needPlus(pairId, "films", 500)), null, "фильмов сколько угодно");
    assert.equal(code(() => needPlus(pairId, "tests")), null);
    assert.equal(testLocked(pairId, "dengi"), false, "все тесты открыты");
    run("UPDATE pairs SET offer_until = NULL WHERE id = ?", pairId);
    assert.equal(offerOf(pairId), null, "акции нет");
    assert.equal(offerOf(pairId, true), null, "и таймер не заводится даже по старту");
  } finally {
    env.plusOn = true;
  }
});

// ——— Новые тесты: что бесплатно, что во «Вдвоём+» (08.10.2026) ———
// Пары из админов: они в бете новых тестов (beta.ts).
import { Hono } from "hono";
import { all as allRows } from "../src/db.ts";
import { env as envNow } from "../src/env.ts";
import type { AppEnv } from "../src/http.ts";
import { apiGate } from "../src/track.ts";
import { core } from "../src/routes/core.ts";
import { testy } from "../src/routes/testy.ts";
import { plus } from "../src/routes/plus.ts";
import { FREE_CHEAT } from "../src/limits.ts";

envNow.devAuth = true;
for (let id = 9411; id <= 9420; id++) if (!envNow.adminIds.includes(id)) envNow.adminIds.push(id);
const api = new Hono<AppEnv>();
api.use("*", apiGate);
for (const r of [core, testy, plus]) api.route("/", r);
const app = new Hono();
app.route("/api", api);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (id: number, method: string, url: string, body?: unknown): Promise<{ status: number; data: any; text: string }> => {
  const res = await app.request(`/api${url}`, {
    method,
    headers: { authorization: `dev ${id}:${encodeURIComponent(`Тест${id}`)}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
};

/**
 * Пара без «Вдвоём+», которая уже прошла первый раунд «Угадай меня» (догадки мимо —
 * шпаргалка длиннее FREE_CHEAT).
 */
async function freshPair(a: number, b: number): Promise<number> {
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded) VALUES (?, 'Лёва', 'Лёва', 1), (?, 'Нина', 'Нина', 1)", a, b);
  const pid = ensurePair(a).id;
  assert.ok(joinPair(b, ensurePair(a).invite_code).ok);
  assert.equal((await call(a, "POST", "/tests/ugaday/round")).status, 200, "первый раунд бесплатный");
  const qs = (await call(a, "GET", "/tests/ugaday")).data.round.questions as { id: string; options: { id: string }[] }[];
  const ans = Object.fromEntries(qs.map((q) => [q.id, { self: q.options[0].id, guess: q.options[1].id }]));
  for (const who of [a, b]) assert.equal((await call(who, "POST", "/tests/ugaday/finish", { round: 1, answers: ans })).status, 200);
  return pid;
}

/** Какой замок ответил 402: сообщение «PLUS:<что>:<текст>» в JSON превращает app.onError (index.ts), здесь — как есть. */
const feat = (r: { text: string }) => /^PLUS:(\w+):/.exec(r.text)?.[1];


test("PLUS=1, новые тесты без «Вдвоём+»: три теста и их первый раунд, шпаргалка — первые строки", async () => {
  const [A, B] = [9411, 9412];
  const pid = await freshPair(A, B);
  const list = (await call(A, "GET", "/tests")).data.tests as { id: string; locked: boolean }[];
  assert.deepEqual(list.filter((t) => !t.locked).map((t) => t.id).sort(), ["priyatno", "svidanie", "ugaday"]);
  assert.equal(list.filter((t) => t.locked).length, 5, "остальные пять — с замком");
  const dengi = await call(A, "POST", "/tests/dengi/round");
  assert.equal(dengi.status, 402);
  assert.equal(feat(dengi), "tests");

  // Второй раунд — во «Вдвоём+»; прошлый результат по-прежнему виден
  const ug = (await call(A, "GET", "/tests/ugaday")).data;
  assert.equal(ug.nextLocked, true);
  assert.ok(ug.round.summary, "результат первого раунда открыт");
  const again = await call(A, "POST", "/tests/ugaday/round");
  assert.equal(again.status, 402);
  assert.equal(feat(again), "rounds");
  assert.match(again.text, /первый раунд/);
  assert.equal(allRows("SELECT round FROM test_rounds WHERE pair_id = ? AND test_id = 'ugaday'", pid).length, 1, "новый раунд не создан");
  // Свой первый раунд другого бесплатного теста — можно
  assert.equal((await call(A, "POST", "/tests/svidanie/round")).status, 200);

  // Шпаргалка: первые FREE_CHEAT строк, остальное сервер не отдаёт
  const sheet = (await call(A, "GET", "/cheatsheet")).data;
  assert.equal(sheet.entries.length, FREE_CHEAT);
  assert.ok(sheet.hidden > 0, "есть что открыть");
  run("UPDATE pairs SET plus_until = ? WHERE id = ?", addDays(today(), 30), pid);
  const full = (await call(A, "GET", "/cheatsheet")).data;
  assert.equal(full.entries.length, FREE_CHEAT + sheet.hidden);
  assert.equal(full.hidden, 0);

  // «Вдвоём+» у пары — у партнёра тоже всё открыто
  assert.equal((await call(B, "GET", "/tests/ugaday")).data.nextLocked, false);
  assert.equal((await call(B, "POST", "/tests/ugaday/round")).status, 200);
  assert.equal((await call(B, "POST", "/tests/dengi/round")).status, 200);
});

test("PLUS=1: экран «Вдвоём+» — строки про раунды и шпаргалку всем бета-парам, не бете — ничего", async () => {
  const [A, B] = [9415, 9416];
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded) VALUES (?, 'Ия', 'Ия', 1), (?, 'Ян', 'Ян', 1)", A, B);
  assert.ok(joinPair(B, ensurePair(A).invite_code).ok);
  const ids = async (who: number) => ((await call(who, "GET", "/plus")).data.extras as { id: string }[]).map((x) => x.id);
  assert.deepEqual(await ids(A), ["rounds", "cheat"]);
  assert.deepEqual(await ids(B), ["rounds", "cheat"]);
  // Не бета (обычная пара, старые тесты): строк про новые тесты нет
  assert.deepEqual(((await call(9401, "GET", "/plus")).data.extras as unknown[]), []);
});

test("PLUS не задан (бой сейчас): ни раундов, ни шпаргалки не закрыто", async () => {
  envNow.plusOn = false;
  try {
    const [A, B] = [9417, 9418];
    const pid = await freshPair(A, B);
    assert.equal(plusOf(pid).active, false);
    const list = (await call(A, "GET", "/tests")).data.tests as { locked: boolean }[];
    assert.equal(list.filter((t) => t.locked).length, 0, "замков нет");
    assert.equal((await call(A, "POST", "/tests/dengi/round")).status, 200);
    assert.equal((await call(A, "GET", "/tests/ugaday")).data.nextLocked, false);
    assert.equal((await call(A, "POST", "/tests/ugaday/round")).status, 200, "второй раунд открыт");
    const sheet = (await call(A, "GET", "/cheatsheet")).data;
    assert.equal(sheet.hidden, 0);
    assert.ok(sheet.entries.length > FREE_CHEAT, "шпаргалка целиком");
    for (const f of ["rounds", "cheat"] as const) assert.equal(code(() => needPlus(pid, f)), null, f);
  } finally {
    envNow.plusOn = true;
  }
});
