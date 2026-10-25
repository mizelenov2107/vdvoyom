import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { get, run } from "../src/db.ts";
import type { AppEnv } from "../src/http.ts";
import type { UserRow } from "../src/model.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { schedule } from "../src/routes/schedule.ts";
import { tick } from "../src/cron.ts";
import { addDays, today, weekdayOf } from "../src/time.ts";
import { pairWindows, personalOn } from "../src/windows.ts";

// Личные дела «Только я» (08.10.2026): маникюр, зал, врач, друзья — новые разделы
// расписания. Сервер их принимает, окна обходят, бот называет владельцу по имени.

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("user", get<UserRow>("SELECT * FROM users WHERE id = ?", Number(c.req.header("x-user")))!);
  await next();
});
app.route("/", schedule);
const call = async (uid: number, path: string, body?: unknown, method?: string) => {
  const res = await app.request(path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "x-user": String(uid), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, any> };
};

run("INSERT OR REPLACE INTO users (id, first_name, name, onboarded, chat_ok) VALUES (9951, 'Своё', 'Своё', 1, 1), (9952, 'Пара', 'Пара', 1, 1)");
assert.ok(joinPair(9952, ensurePair(9951).invite_code).ok);
const me = () => get<UserRow>("SELECT * FROM users WHERE id = 9951")!;
const categoryOf = (id: number) => get<{ category: string }>("SELECT category FROM schedule WHERE id = ?", id)!.category;

test("новые разделы: уход, здоровье, дела, друзья сохраняются; старые как были", async () => {
  const day = addDays(today(), 20);
  for (const category of ["beauty", "health", "errands", "friends", "class", "work", "tutoring", "sport", "other"]) {
    const r = await call(9951, "/", { kind: "once", date: day, start_min: 600, end_min: 660, title: category, category });
    assert.equal(r.status, 200, category);
    assert.equal(categoryOf(r.data.id), category, `${category} сохранился как есть`);
  }
  const odd = await call(9951, "/", { kind: "once", date: day, start_min: 700, end_min: 760, title: "x", category: "nails" });
  assert.equal(categoryOf(odd.data.id), "class", "незнакомый раздел — как раньше, «пары»");
  run("DELETE FROM schedule WHERE user_id = 9951");
});

test("своё дело меняется: раздел, время и дата; у еженедельного дата не трогается", async () => {
  const day = addDays(today(), 21);
  const { data } = await call(9951, "/", { kind: "once", date: day, start_min: 900, end_min: 960, title: "Маникюр", category: "beauty" });
  const p = await call(9951, `/${data.id}`, { category: "health", start_min: 1020, end_min: 1080, date: addDays(day, 1) }, "PATCH");
  assert.equal(p.status, 200);
  const row = get<{ category: string; start_min: number; date: string }>("SELECT category, start_min, date FROM schedule WHERE id = ?", data.id)!;
  assert.deepEqual({ ...row }, { category: "health", start_min: 1020, date: addDays(day, 1) });

  const w = await call(9951, "/", { kind: "weekly", weekday: 3, start_min: 1140, end_min: 1260, title: "Зал", category: "sport" });
  await call(9951, `/${w.data.id}`, { date: day, title: "Зал и бассейн" }, "PATCH");
  const wr = get<{ date: string | null; title: string; weekday: number }>("SELECT date, title, weekday FROM schedule WHERE id = ?", w.data.id)!;
  assert.deepEqual({ ...wr }, { date: null, title: "Зал и бассейн", weekday: 3 });
  run("DELETE FROM schedule WHERE user_id = 9951");
});

test("маникюр рвёт общее окно и попадает в сводки бота только владельцу", async () => {
  const day = addDays(today(), 3);
  const { data } = await call(9951, "/", { kind: "once", date: day, start_min: 900, end_min: 960, title: "Маникюр", category: "beauty" });
  assert.ok(data.id);
  // Еженедельный зал в тот же день недели — тоже своё дело
  await call(9951, "/", { kind: "weekly", weekday: weekdayOf(day), start_min: 1140, end_min: 1200, title: "Зал", category: "sport" });
  // Пара по расписанию — не своё дело, в «Свои дела» не попадает
  await call(9951, "/", { kind: "weekly", weekday: weekdayOf(day), start_min: 600, end_min: 690, title: "Матанализ", category: "class" });

  const wins = pairWindows(me(), get<UserRow>("SELECT * FROM users WHERE id = 9952")!, 7, 30).filter((w) => w.date === day);
  assert.ok(!wins.some((w) => w.start < 960 && w.end > 900), "окна не заходят на маникюр");
  assert.ok(wins.some((w) => w.end === 900) && wins.some((w) => w.start === 960), "до и после маникюра свободно");
  assert.deepEqual(personalOn(me(), day).map((r) => r.title), ["Маникюр", "Зал"]);

  const said: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void said.push(a.join(" "));
  try {
    const [y, m, d] = addDays(day, -1).split("-").map(Number);
    await tick(Date.UTC(y, m - 1, d, 17, 5)); // 20:05 по Москве накануне
    const [y2, m2, d2] = day.split("-").map(Number);
    await tick(Date.UTC(y2, m2 - 1, d2, 5, 35)); // 8:35 по Москве в тот день
  } finally {
    console.log = log;
  }
  const evening = said.find((s) => s.includes("[бот → 9951]") && s.includes("Завтра"));
  assert.ok(evening, "вечером накануне владельцу ушло «Завтра»");
  assert.ok(evening!.includes("Свои дела") && evening!.includes("15:00 Маникюр") && evening!.includes("19:00 Зал"), evening);
  assert.ok(!evening!.includes("Матанализ"), "пары в «Свои дела» не попадают");
  assert.ok(!said.some((s) => s.includes("[бот → 9952]") && s.includes("Завтра")), "партнёру чужие дела вечером не шлём");

  const morning = said.find((s) => s.includes("[бот → 9951]") && s.includes("Доброе утро"));
  assert.ok(morning, "утренняя сводка ушла");
  const mine = morning!.split("\n").find((l) => l.includes("У тебя")) ?? "";
  assert.ok(mine.includes("занятия 10:00–11:30"), mine);
  assert.ok(mine.includes("Маникюр 15:00–16:00") && mine.includes("Зал 19:00–20:00"), "свои дела названы по имени, а не «занятия»");
  run("DELETE FROM schedule WHERE user_id = 9951");
});
