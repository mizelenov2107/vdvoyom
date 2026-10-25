import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { bothAnswered, dailyState, questionFor } from "../src/daily.ts";
import type { UserRow } from "../src/model.ts";
import { today } from "../src/time.ts";

run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9501, 'Первый', 1), (9502, 'Вторая', 1)");
const pairId = ensurePair(9501).id;
assert.ok(joinPair(9502, ensurePair(9501).invite_code).ok);
const user = (id: number) => get<UserRow>("SELECT * FROM users WHERE id = ?", id)!;
const d = today();

test("вопрос дня: реакции и переписка скрыты, пока не ответили оба", () => {
  questionFor(pairId, d);
  run("INSERT INTO daily_answers (pair_id, date, user_id, text) VALUES (?, ?, 9501, 'Море')", pairId, d);
  assert.equal(bothAnswered(pairId, d), false);
  // Реакция, записанная в обход (например, до правки ответа), не утекает, пока ответ один
  run("INSERT OR REPLACE INTO daily_reactions (pair_id, date, user_id, emoji) VALUES (?, ?, 9502, '❤️')", pairId, d);
  const s = dailyState(user(9501), user(9502), d)!;
  assert.equal(s.reactions.theirs, null);
  assert.deepEqual(s.comments, []);
});

test("вопрос дня: когда ответили оба, каждый видит реакцию на свой ответ и общую переписку", () => {
  run("INSERT INTO daily_answers (pair_id, date, user_id, text) VALUES (?, ?, 9502, 'Горы')", pairId, d);
  assert.equal(bothAnswered(pairId, d), true);
  run("INSERT INTO daily_comments (pair_id, date, user_id, text) VALUES (?, ?, 9501, 'Горы? Серьёзно? 😄')", pairId, d);
  const me = dailyState(user(9501), user(9502), d)!;
  const she = dailyState(user(9502), user(9501), d)!;
  assert.equal(me.reactions.theirs, "❤️", "её реакция на мой ответ");
  assert.equal(she.reactions.mine, "❤️", "у неё — её собственная реакция");
  assert.equal(me.comments.length, 1);
  assert.equal(me.comments[0].mine, true);
  assert.equal(she.comments[0].mine, false);
});
