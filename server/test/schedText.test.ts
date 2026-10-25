import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOf, parseDays, parseScheduleText, parseTime } from "../src/schedText.ts";

const TODAY = "2026-09-26";

test("дни: сокращения, полные названия, диапазоны, списки, даты", () => {
  assert.deepEqual(parseDays("пн", TODAY), { weekdays: [1], dates: [] });
  assert.deepEqual(parseDays("Среда", TODAY), { weekdays: [3], dates: [] });
  assert.deepEqual(parseDays("пн-пт", TODAY), { weekdays: [1, 2, 3, 4, 5], dates: [] });
  assert.deepEqual(parseDays("пт–пн", TODAY), { weekdays: [1, 5, 6, 7], dates: [] }, "через выходные");
  assert.deepEqual(parseDays("вт, чт", TODAY), { weekdays: [2, 4], dates: [] });
  assert.deepEqual(parseDays("будни", TODAY)?.weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays("2026-10-06", TODAY), { weekdays: [], dates: ["2026-10-06"] });
  assert.deepEqual(parseDays("06.10, 20.10", TODAY)?.dates, ["2026-10-06", "2026-10-20"]);
  assert.deepEqual(parseDays("15.01", TODAY)?.dates, ["2027-01-15"], "январь без года — следующий");
  assert.equal(parseDays("ДЕНЬ", TODAY), null, "заголовок таблицы");
  assert.equal(parseDays("Вот ваше расписание:", TODAY), null);
  assert.equal(parseDays("31.02", TODAY), null, "несуществующая дата");
});

test("время и тип", () => {
  assert.deepEqual(parseTime("09:30-10:50"), { start: 570, end: 650 });
  assert.deepEqual(parseTime("9.30 – 10.50"), { start: 570, end: 650 });
  assert.deepEqual(parseTime("с 18:10 до 19:30"), { start: 1090, end: 1170 });
  assert.deepEqual(parseTime("22:00-24:00"), { start: 1320, end: 1440 });
  assert.equal(parseTime("вечером"), null);
  assert.equal(categoryOf("пара", "Матанализ"), "class");
  assert.equal(categoryOf("работа", ""), "work");
  assert.equal(categoryOf("", "Тренировка в зале"), "sport");
  assert.equal(categoryOf("пара", "Работа над курсовой"), "class", "тип важнее названия");
  assert.equal(categoryOf("", "Встреча"), "other");
});

test("ответ чата целиком: пояснения, таблица, повторы и ошибки", () => {
  const answer = `Вот ваше расписание в нужном формате:

\`\`\`
ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ
пн | 09:30-10:50 | Матанализ, лекция | пара | R405
пн | 09:30-10:50 | Матанализ, лекция | пара | R405
вт,чт | 11:10-12:30 | Английский | пара онлайн |
пн-пт | 19:00-21:00 | Работа | работа | офис
2026-10-06 | 13:00-14:20 | Семинар по линалу | пара | D501
ср | утром | Физкультура | спорт |
сб | 23:00-01:00 | Ночная смена | работа |
2027-12-01 | 10:00-11:00 | Слишком далеко | пара |
\`\`\`

| ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ |
|---|---|---|---|---|
| сб | 12:00-13:30 | Бассейн | спорт | |

пт 18:10-19:30 Консультация

Если что-то не так, напишите!`;
  const { entries, errors } = parseScheduleText(answer, TODAY);
  const weekly = entries.filter((e) => e.kind === "weekly");
  const once = entries.filter((e) => e.kind === "once");
  assert.equal(weekly.filter((e) => e.title === "Матанализ, лекция").length, 1, "повтор схлопнут");
  assert.deepEqual(weekly.filter((e) => e.title === "Английский").map((e) => e.weekday), [2, 4]);
  assert.ok(weekly.filter((e) => e.title === "Английский").every((e) => e.online && e.place === null));
  assert.equal(weekly.filter((e) => e.title === "Работа").length, 5);
  assert.equal(weekly.find((e) => e.title === "Работа")?.category, "work");
  assert.equal(weekly.find((e) => e.title === "Бассейн")?.category, "sport", "строка из markdown-таблицы");
  assert.equal(weekly.find((e) => e.title === "Консультация")?.weekday, 5, "строка без черт");
  assert.deepEqual(once.map((e) => [e.date, e.place]), [["2026-10-06", "D501"]]);
  assert.deepEqual(errors.map((e) => e.reason.split(" ")[0]), ["не", "конец", "дата"]);
  assert.equal(errors[0].line, 10, "номер строки в ответе чата");
});
