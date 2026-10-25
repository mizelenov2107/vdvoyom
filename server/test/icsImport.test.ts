import { test } from "node:test";
import assert from "node:assert/strict";
import { all, run } from "../src/db.ts";
import { checkUrl, parseIcs, syncIcs } from "../src/icsImport.ts";
import { today, addDays } from "../src/time.ts";

const F = "2026-10-05"; // понедельник
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  // Матанализ по понедельникам и средам до 21 октября, 21-го пары нет (EXDATE)
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Moscow:20260907T093000",
  "DTEND;TZID=Europe/Moscow:20260907T105000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021T235959Z",
  "EXDATE;TZID=Europe/Moscow:20261021T093000",
  "SUMMARY:Математический анализ\\, лекция",
  "LOCATION:Покровский бульвар\\, R405",
  "CATEGORIES:Лекция",
  "END:VEVENT",
  // Разовый семинар, время в UTC: 10:00Z = 13:00 по Москве; длинная строка перенесена
  "BEGIN:VEVENT",
  "DTSTART:20261007T100000Z",
  "DTEND:20261007T112000Z",
  "SUMMARY:Линейная алгебра\\, семинар в Zoom — очень длинное название, которое ",
  " календарь перенёс на следующую строку",
  "END:VEVENT",
  // Английский по четвергам два раза
  "BEGIN:VEVENT",
  "DTSTART:20261008T181000",
  "DTEND:20261008T193000",
  "RRULE:FREQ=WEEKLY;COUNT=2",
  "SUMMARY:Английский",
  "END:VEVENT",
  // Весь день и отменённое — не занятость
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261009",
  "SUMMARY:День первокурсника",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261009T120000",
  "DTEND:20261009T130000",
  "STATUS:CANCELLED",
  "SUMMARY:Отменили",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("календарь: повторы, исключения, UTC, перенос строк; весь день и отменённое не занятость", () => {
  const l = parseIcs(ICS, F);
  const mat = l.filter((x) => x.title.startsWith("Математический"));
  assert.deepEqual(mat.map((x) => x.date), ["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19"], "пн и ср до 21-го, 21-е исключено");
  assert.deepEqual([mat[0].start, mat[0].end, mat[0].place, mat[0].hint], [570, 650, "Покровский бульвар, R405", "Лекция"]);
  const lin = l.find((x) => x.title.startsWith("Линейная"))!;
  assert.equal(lin.start, 13 * 60, "10:00Z — это 13:00 по Москве");
  assert.match(lin.title, /перенёс на следующую строку$/);
  assert.equal(lin.online, true, "Zoom — онлайн");
  assert.deepEqual(l.filter((x) => x.title === "Английский").map((x) => x.date), ["2026-10-08", "2026-10-15"], "COUNT=2");
  assert.equal(l.some((x) => /первокурсника|Отменили/.test(x.title)), false);
});

test("ссылка на календарь: только внешний https, webcal превращается в https", async () => {
  assert.deepEqual(await checkUrl("http://example.com/a.ics"), { error: "Нужна ссылка https:// или webcal://" });
  assert.ok("error" in (await checkUrl("https://127.0.0.1/a.ics")));
  assert.ok("error" in (await checkUrl("https://vdvoyom-app:3000/admin")), "docker-имя без точки");
  assert.ok("error" in (await checkUrl("https://localhost/a.ics")));
  assert.ok("error" in (await checkUrl("не ссылка")));
});

test("подтяжка: занятия по датам, «не хожу» переживает обновление", async () => {
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9911, 'Календарный', 1)");
  const t = today();
  const day = (n: number) => addDays(t, n).replace(/-/g, "");
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:${day(1)}T093000\r\nDTEND:${day(1)}T105000\r\nSUMMARY:Пара\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:${day(2)}T110000\r\nDTEND:${day(2)}T123000\r\nSUMMARY:Работа\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const fetcher = (async () => new Response(ics)) as unknown as typeof fetch;
  assert.equal(await syncIcs(9911, "https://example.com/c.ics", fetcher), 2);
  run("UPDATE schedule SET skip = 1 WHERE user_id = 9911 AND title = 'Пара'");
  await syncIcs(9911, "https://example.com/c.ics", fetcher);
  const rows = all<{ title: string; skip: number; source: string; category: string }>("SELECT title, skip, source, category FROM schedule WHERE user_id = 9911 ORDER BY date");
  assert.deepEqual(rows.map((r) => [r.title, r.skip, r.source]), [["Пара", 1, "ics"], ["Работа", 0, "ics"]]);
  assert.equal(rows[1].category, "work");
});
