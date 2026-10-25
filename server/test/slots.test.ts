import { test } from "node:test";
import assert from "node:assert/strict";
import { busyOn, findWindows, intersect, subtract, type Block } from "../src/slots.ts";

const person = { gap_min: 45, day_start_min: 600, day_end_min: 1380 };
const weekly = (weekday: number, a: number, b: number, extra: Partial<Block> = {}): Block => ({
  kind: "weekly", weekday, date: null, start_min: a, end_min: b, skip: 0, online: 0, ...extra,
});
const once = (date: string, a: number, b: number, extra: Partial<Block> = {}): Block => ({
  kind: "once", weekday: null, date, start_min: a, end_min: b, skip: 0, online: 0, ...extra,
});

test("вычитание и пересечение интервалов", () => {
  assert.deepEqual(subtract([{ start: 0, end: 100 }], [{ start: 20, end: 30 }]), [{ start: 0, end: 20 }, { start: 30, end: 100 }]);
  assert.deepEqual(intersect([{ start: 0, end: 50 }], [{ start: 40, end: 90 }]), [{ start: 40, end: 50 }]);
});

test("пропускаемая пара не занимает время", () => {
  // суббота 26.09.2026, лекция 18:10–19:30 помечена «не хожу»
  const busy = busyOn(person, [weekly(6, 1090, 1170, { skip: 1 })], "2026-09-26");
  assert.deepEqual(busy, []);
});

test("вебинар без дороги, очная пара с дорогой", () => {
  const b = busyOn(person, [once("2026-09-26", 610, 700, { online: 1 }), once("2026-09-26", 900, 990)], "2026-09-26");
  assert.deepEqual(b, [{ start: 610, end: 700 }, { start: 855, end: 1035 }]);
});

test("отменённая пара освобождает время вместе с дорогой", () => {
  const blocks: Block[] = [weekly(1, 780, 860), { kind: "free", weekday: null, date: "2026-09-28", start_min: 780, end_min: 860, skip: 0, online: 0 }];
  assert.deepEqual(busyOn(person, blocks, "2026-09-28"), []);
});

test("суббота Миши и Алины: окно 13:20–15:35", () => {
  // Миша: Python 09:30–10:50, правовая 16:20–17:40, лекция 18:10 пропускается.
  // Алина: история России вебинаром 10:10–13:20.
  const misha = [weekly(6, 570, 650), weekly(6, 980, 1060), weekly(6, 1090, 1170, { skip: 1 })];
  const alina = [once("2026-09-26", 610, 700, { online: 1 }), once("2026-09-26", 710, 800, { online: 1 })];
  // «сейчас» — 25 сентября, 09:00 по Москве
  const now = Date.parse("2026-09-25T06:00:00Z");
  const w = findWindows({ a: person, aBlocks: misha, b: person, bBlocks: alina, days: 3, minMinutes: 60, now }).filter((x) => x.date === "2026-09-26");
  assert.deepEqual(w.map((x) => [x.start, x.end]), [[800, 935], [1105, 1380]]);
});
