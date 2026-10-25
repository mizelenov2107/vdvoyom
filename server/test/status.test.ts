import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { busyChunks, statusNow } from "../src/windows.ts";
import type { UserRow } from "../src/model.ts";

// Пятница 25.09.2026, время московское: 10:06 = 07:06 UTC
const at = (hh: number, mm: number) => Date.UTC(2026, 8, 25, hh - 3, mm);

test("до пары меньше, чем ехать: «в дороге», а не «свободно до» прошедшего времени", () => {
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded, gap_min) VALUES (9101, 'Алина', 1, 45)");
  run("DELETE FROM schedule WHERE user_id = 9101");
  // Пятница — weekday 5 (пн = 1); пара 10:10–11:40
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (9101, 'weekly', 5, 610, 700, 'История гостеприимства')");
  const u = get<UserRow>("SELECT * FROM users WHERE id = 9101")!;

  const early = statusNow(u, at(9, 0));
  assert.equal(early.state, "free");
  assert.equal(early.until, 610 - 45, "свободна до выхода из дома в 9:25");

  const late = statusNow(u, at(10, 6));
  assert.equal(late.state, "road");
  assert.equal(late.until, 610, "едет к началу пары в 10:10");

  assert.equal(statusNow(u, at(10, 30)).state, "busy");
});

test("большая перемена в 40 минут не обрывает учебный день: занятия до 15:30, а не до 13:20", () => {
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded, gap_min) VALUES (9102, 'Матео', 1, 60)");
  run("DELETE FROM schedule WHERE user_id = 9102");
  // Сетка РЭУ: 8:30–10:00, 10:10–11:40, 11:50–13:20, перемена 40 минут, 14:00–15:30
  for (const [s, e] of [[510, 600], [610, 700], [710, 800], [840, 930]]) {
    run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (9102, 'weekly', 5, ?, ?, 'Пара')", s, e);
  }
  // Окно в полтора часа — уже свободное время
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (9102, 'weekly', 5, 1020, 1110, 'Английский')");
  const u = get<UserRow>("SELECT * FROM users WHERE id = 9102")!;

  const morning = statusNow(u, at(8, 32));
  assert.equal(morning.state, "busy");
  assert.equal(morning.until, 930, "на парах до 15:30");

  assert.deepEqual(busyChunks(u, "2026-09-25"), [
    { start: 510, end: 930 },
    { start: 1020, end: 1110 },
  ]);
});
