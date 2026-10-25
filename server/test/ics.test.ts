import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { calToken, icsFor, resetCalToken } from "../src/ics.ts";
import type { UserRow } from "../src/model.ts";

run("INSERT OR REPLACE INTO users (id, first_name, onboarded, birthday) VALUES (9801, 'Календарь', 1, '2004-05-17'), (9802, 'Половинка', 1, NULL)");
const pairId = ensurePair(9801).id;
assert.ok(joinPair(9802, ensurePair(9801).invite_code).ok);
run("UPDATE pairs SET together_since = '2024-03-01' WHERE id = ?", pairId);
run("INSERT INTO events (pair_id, author_id, title, kind, date, start_min, end_min) VALUES (?, 9801, 'Кино, потом ужин; без телефонов', 'date', '2026-10-03', 1140, 1320)", pairId);
run("INSERT INTO events (pair_id, author_id, title, kind, date, end_date) VALUES (?, 9801, 'Питер', 'trip', '2026-11-01', '2026-11-03')", pairId);
run("INSERT INTO events (pair_id, author_id, title, kind, date, status) VALUES (?, 9802, 'Отменённое', 'date', '2026-10-05', 'declined')", pairId);
const me = get<UserRow>("SELECT * FROM users WHERE id = 9801")!;

test("подписка календаря: свидание со временем, поездка на дни, день рождения и годовщина каждый год", () => {
  const ics = icsFor(calToken(me))!;
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:💞 Кино\\, потом ужин\; без телефонов/, "запятая и точка с запятой экранированы");
  assert.match(ics, /DTSTART;TZID=Europe\/Moscow:20261003T190000/);
  assert.match(ics, /DTEND;VALUE=DATE:20261104/, "поездка до 3 ноября включительно");
  assert.match(ics, /UID:birthday-9801@vdvoyom[\s\S]*?RRULE:FREQ=YEARLY/);
  assert.match(ics, /🎉 Наша годовщина/);
  assert.doesNotMatch(ics, /Отменённое/, "отклонённое свидание в календарь не попадает");
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `строка длиннее 75 байт: ${line}`);
});

test("подписка календаря: чужая или сброшенная ссылка не открывается", () => {
  const old = calToken(me);
  assert.equal(calToken(me), old, "ссылка постоянная");
  resetCalToken(me.id);
  assert.equal(icsFor(old), null);
  assert.equal(icsFor("../../etc/passwd"), null);
});
