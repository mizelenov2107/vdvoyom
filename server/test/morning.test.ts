import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { homeSummary } from "../src/home.ts";
import { tick } from "../src/cron.ts";
import type { UserRow } from "../src/model.ts";
import { addDays, today } from "../src/time.ts";
import { SHOWN_WINDOW_MIN } from "../src/windows.ts";

// Жалоба 04.10.2026: «в боте неправильное расписание, не как в приложении».
// Бот брал окна от часа, главная — от полутора: окно 80 минут между парами
// было только в боте. Теперь утренняя сводка и главная обязаны совпадать.
test("утренняя сводка бота: «вместе можно» — ровно окна с главной", async () => {
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded, chat_ok) VALUES (9931, 'Утро', 'Утро', 1, 1), (9932, 'Вечер', 'Вечер', 1, 1)");
  assert.ok(joinPair(9932, ensurePair(9931).invite_code).ok);
  // Завтра: сегодняшние окна обрезаны текущим временем, и тест зависел бы от часа запуска
  const day = addDays(today(), 1);
  const wd = ((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  // У одного пары 9:30–12:30 и 13:50–15:10 (перерыв 80 минут), у другого — 16:00–18:00
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (9931, 'weekly', ?, 570, 750, 'Пара'), (9931, 'weekly', ?, 830, 910, 'Пара'), (9932, 'weekly', ?, 960, 1080, 'Работа')", wd, wd, wd);
  const me = get<UserRow>("SELECT * FROM users WHERE id = 9931")!;
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const homeToday = homeSummary(me).windows.filter((w: { date: string }) => w.date === day).map((w: { start: number; end: number }) => `${hh(w.start)}–${hh(w.end)}`);
  assert.ok(!homeToday.includes("12:30–13:50"), `на главной окна меньше ${SHOWN_WINDOW_MIN} минут нет`);

  const said: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void said.push(a.join(" "));
  try {
    const [y, m, d] = day.split("-").map(Number);
    await tick(Date.UTC(y, m - 1, d, 5, 35)); // 8:35 по Москве
  } finally {
    console.log = log;
  }
  const morning = said.find((s) => s.includes("[бот → 9931]") && s.includes("Доброе утро"));
  assert.ok(morning, "сводка ушла");
  const line = morning!.split("\n").find((l) => l.includes("Вместе можно")) ?? "";
  const botToday = line ? line.replace(/^.*Вместе можно: /, "").split(", ") : [];
  assert.ok(homeToday.length > 0, "на главной есть окна на этот день");
  assert.deepEqual(botToday, homeToday, "окна в боте = окна на главной");
  assert.ok(!line.includes("12:30–13:50"), "перерыв 80 минут бот больше не предлагает");
});
