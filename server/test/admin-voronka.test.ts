// Воронка в админке (11.10.2026): старты → пара → живы D7/D14 → замок → «Вдвоём+» →
// оплата начата → оплатили; по источникам и по неделям прихода. Блогеры — справочник.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/db.ts";
import { deletePartner, funnel, partnerList, savePartner, sourceLabel, weekLabel, weekOf } from "../src/adminData.ts";

// Своё «сейчас», чтобы D7 и D14 не зависели от дня прогона. Все даты — в 2025 году,
// другие тесты пишут в ту же базу текущим временем и сюда не попадут.
const NOW = Date.parse("2025-03-31T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

function person(id: number, source: string | null, createdDaysAgo: number, pairId: number | null, seenDaysAgo: number | null) {
  run(
    "INSERT INTO users (id, first_name, source, created_at, pair_id, seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, `В${id}`, source, ago(createdDaysAgo), pairId, seenDaysAgo === null ? null : ago(seenDaysAgo),
  );
}
function pair(id: number, source: string | null, createdDaysAgo: number, pairedDaysAgo: number | null) {
  run("INSERT INTO pairs (id, invite_code, source, created_at, paired_at) VALUES (?, ?, ?, ?, ?)", id, `v${id}`, source, ago(createdDaysAgo), pairedDaysAgo === null ? null : ago(pairedDaysAgo));
}
const act = (userId: number, action: string, daysAgo: number) => run("INSERT INTO activity (user_id, action, at) VALUES (?, ?, ?)", userId, action, ago(daysAgo));

test("справочник блогеров: завести, поправить, неверный код, дубль, удалить", () => {
  assert.equal(savePartner({ code: "b_Anya", name: "Аня и Дима", platform: "инстаграм", url: "https://instagram.com/anya" }).code, "anya");
  assert.throws(() => savePartner({ code: "a", name: "Коротко" }), /Код/);
  assert.throws(() => savePartner({ code: "кириллица", name: "Нет" }), /Код/);
  assert.throws(() => savePartner({ code: "anya", name: "Дубль" }), /уже есть/);
  assert.throws(() => savePartner({ code: "x1", name: "" }), /имя/);
  assert.throws(() => savePartner({ code: "x2", name: "Ссылка", url: "javascript:alert(1)" }), /https/);
  assert.equal(savePartner({ name: "Аня", note: "пилот, волна 1" }, "anya").note, "пилот, волна 1");
  savePartner({ code: "gone", name: "Временный" });
  assert.equal(deletePartner("gone"), true);
  assert.equal(deletePartner("gone"), false);
  assert.deepEqual(partnerList().map((p) => p.code).filter((c) => c === "anya" || c === "gone"), ["anya"]);
  assert.equal(sourceLabel("b_anya"), "Аня");
  assert.equal(sourceLabel("b_nobody"), "b_nobody");
  assert.equal(sourceLabel("reels"), "reels");
});

test("неделя прихода — по Москве, с понедельника", () => {
  assert.equal(weekOf("2025-03-23 20:59:00"), "2025-03-17", "23:59 воскресенья по Москве — ещё прошлая неделя");
  assert.equal(weekOf("2025-03-23 21:00:00"), "2025-03-24", "00:00 понедельника по Москве — новая");
  assert.equal(weekLabel("2025-03-24"), "24–30 мар");
  assert.equal(weekLabel("2025-03-31"), "31 мар – 6 апр");
});

test("воронка по источникам и неделям", () => {
  // Пара 1 от блогера anya, сложилась 20 дней назад, оба заходят — жива D7 и D14,
  // упёрлась в замок, видела «Вдвоём+», оплатила 199 ₽
  pair(8801, "b_anya", 21, 20);
  person(98011, "b_anya", 21, 8801, 1);
  person(98012, null, 20, 8801, 2);
  act(98011, "LOCK:tests", 5);
  act(98012, "PLUS_VIEW:lock", 5);
  act(98012, "POST /plus/checkout", 5);
  run("INSERT INTO payments (id, pair_id, user_id, plan, amount, status, paid_at) VALUES ('v-1', 8801, 98012, 'month', 199, 'succeeded', ?)", ago(5));
  // Пара 2 от anya: сложилась 10 дней назад, второй пропал на 3-й день — D7 нет, D14 ещё рано
  pair(8802, "b_anya", 10, 10);
  person(98021, "b_anya", 10, 8802, 0);
  person(98022, "b_anya", 10, 8802, 7);
  act(98021, "LOCK_VIEW:goals", 1);
  // Пара 3 без метки: пространство есть, половинка не пришла — в «пары» не идёт
  pair(8803, null, 4, null);
  person(98031, null, 4, 8803, 0);
  // Пара 4 с меткой reels: сложилась 15 дней назад, жива D7, но не D14; подарок — не оплата
  pair(8804, "reels", 16, 15);
  person(98041, "reels", 16, 8804, 3);
  person(98042, null, 15, 8804, 3);
  run("INSERT INTO payments (id, pair_id, user_id, plan, amount, status, method, paid_at) VALUES ('v-gift', 8804, 98041, 'forever', 0, 'succeeded', 'gift', ?)", ago(2));
  // Звёзды и пропавший счёт: пара 5 без метки, оплата звёздами 150, ещё один счёт не оплачен
  pair(8805, null, 3, 3);
  person(98051, null, 3, 8805, 0);
  person(98052, null, 3, 8805, 0);
  run("INSERT INTO payments (id, pair_id, user_id, plan, amount, status, method, paid_at) VALUES ('v-st', 8805, 98051, 'month', 150, 'succeeded', 'stars', ?)", ago(1));
  // Вне периода: пришли 100 дней назад
  pair(8806, "b_anya", 100, 99);
  person(98061, "b_anya", 100, 8806, 0);
  person(98062, "b_anya", 99, 8806, 0);

  const f = funnel({ from: ago(30).slice(0, 10), to: ago(0).slice(0, 10), now: NOW });
  const t = f.total;
  assert.equal(t.starts, 9, "люди за период: 2+2+1+2+2");
  assert.equal(t.pairs, 4, "пара без половинки не считается");
  assert.deepEqual([t.d7, t.d7of], [2, 3], "D7: пары 1 и 4 живы из 1, 2, 4");
  assert.deepEqual([t.d14, t.d14of], [1, 2], "D14: пара 1 из 1 и 4");
  assert.equal(t.lock, 2);
  assert.equal(t.plusView, 1);
  assert.equal(t.checkout, 2, "пара 1 по журналу, пара 5 по счёту");
  assert.equal(t.paid, 2, "подарок не оплата");
  assert.equal(t.rub, 199);
  assert.equal(t.stars, 150);

  const anya = f.bySource.find((r) => r.key === "b_anya")!;
  assert.equal(anya.label, "Аня");
  assert.deepEqual([anya.starts, anya.pairs, anya.d7, anya.d7of, anya.lock, anya.paid, anya.rub], [3, 2, 1, 2, 2, 1, 199]);
  const none = f.bySource.find((r) => r.key === "")!;
  assert.equal(none.label, "без метки");
  assert.deepEqual([none.starts, none.pairs, none.paid], [5, 1, 1]);
  const reels = f.bySource.find((r) => r.key === "reels")!;
  assert.deepEqual([reels.starts, reels.pairs, reels.d7, reels.d14, reels.d14of, reels.paid], [1, 1, 1, 0, 1, 0]);

  // Когорты: пары считаются по неделе, когда завели пространство
  const weeks = f.cohorts.map((r) => r.key);
  assert.deepEqual(weeks, [...weeks].sort().reverse(), "от новых к старым");
  assert.equal(f.cohorts.reduce((s, r) => s + r.pairs, 0), 4);
  assert.equal(f.cohorts.reduce((s, r) => s + r.starts, 0), 9);

  // Только один источник
  const only = funnel({ from: ago(30).slice(0, 10), to: ago(0).slice(0, 10), source: "b_anya", now: NOW });
  assert.equal(only.total.starts, 3);
  assert.equal(only.total.pairs, 2);
  assert.deepEqual(only.bySource.map((r) => r.key), ["b_anya"]);
  const blank = funnel({ from: ago(30).slice(0, 10), to: ago(0).slice(0, 10), source: "", now: NOW });
  assert.equal(blank.total.starts, 5);
  assert.ok(only.sources.some((s) => s.key === "b_anya" && s.label === "Аня"));
  assert.match(f.definition, /оба заходили/);
});
