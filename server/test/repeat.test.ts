import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { homeSummary, upcoming } from "../src/home.ts";
import { tick } from "../src/cron.ts";
import type { UserRow } from "../src/model.ts";
import { addDays, eventOn, repeatDates, today } from "../src/time.ts";

// 07.10.2026, разбор отзывов на You&Me: «нет повторяющихся событий» — самая частая просьба.
test("повтор каждую неделю: даты в промежутке, начало не раньше даты события", () => {
  assert.deepEqual(repeatDates("2026-10-01", "week", "2026-10-01", "2026-10-22"), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
  assert.deepEqual(repeatDates("2026-10-01", "week", "2026-10-09", "2026-10-20"), ["2026-10-15"]);
  assert.deepEqual(repeatDates("2026-10-01", "week", "2026-09-01", "2026-09-30"), [], "до начала повторов нет");
});

test("повтор каждый месяц: то же число, месяц без него пропускается", () => {
  assert.deepEqual(repeatDates("2026-01-31", "month", "2026-01-01", "2026-05-31"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  assert.deepEqual(repeatDates("2026-10-07", "month", "2027-02-01", "2027-03-31"), ["2027-02-07", "2027-03-07"]);
  assert.equal(eventOn({ date: "2026-10-07", repeat: "month" }, "2026-11-07"), true);
  assert.equal(eventOn({ date: "2026-10-07", repeat: "month" }, "2026-11-08"), false);
  assert.equal(eventOn({ date: "2026-10-07", end_date: "2026-10-09" }, "2026-10-08"), true, "многодневное как раньше");
});

test("еженедельное событие: на главной сегодня, в «Скоро» один раз, в утренней сводке", async () => {
  run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded, chat_ok) VALUES (9941, 'Повтор', 'Повтор', 1, 1), (9942, 'Пара', 'Пара', 1, 1)");
  const pair = ensurePair(9941);
  assert.ok(joinPair(9942, pair.invite_code).ok);
  const t = today();
  run(
    "INSERT INTO events (pair_id, author_id, title, kind, date, start_min, repeat) VALUES (?, 9941, 'Тренировка вместе', 'event', ?, 1140, 'week')",
    pair.id, addDays(t, -14),
  );
  const me = get<UserRow>("SELECT * FROM users WHERE id = 9941")!;
  assert.ok(homeSummary(me).todayEvents.some((e: { title: string }) => e.title === "Тренировка вместе"), "сегодня — третий раз по счёту");
  const soon = upcoming(pair.id, [me], 45).filter((u) => u.title === "Тренировка вместе");
  assert.equal(soon.length, 1, "в «Скоро» только ближайший раз");
  assert.equal(soon[0].date, t);

  const said: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void said.push(a.join(" "));
  try {
    const day = addDays(t, 7);
    const [y, m, d] = day.split("-").map(Number);
    await tick(Date.UTC(y, m - 1, d, 5, 35)); // 8:35 по Москве через неделю
  } finally {
    console.log = log;
  }
  const morning = said.find((s) => s.includes("[бот → 9941]") && s.includes("Доброе утро"));
  assert.ok(morning?.includes("Тренировка вместе"), "через неделю событие снова в сводке");
});
