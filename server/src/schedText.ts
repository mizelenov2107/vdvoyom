// Расписание одним текстом. Человек отправляет свою сетку (скриншот, фото,
// таблицу с сайта вуза) в любой чат с ИИ вместе с нашей подсказкой, а ответ
// вставляет в приложение. Своей модели на сервере нет — с российского адреса
// к Anthropic не пройти, — поэтому распознаёт чат человека, а мы разбираем
// строгий формат, по строке на занятие:
//
//   ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ
//   пн | 09:30-10:50 | Матанализ, лекция | пара | R405
//   пн-пт | 10:00-19:00 | Работа | работа | офис
//   2026-10-06 | 13:00-14:20 | Семинар по линалу | пара онлайн |
//
// Разбор прощает то, что чаты любят добавлять: пояснения до и после,
// заголовок, ``` и markdown-таблицы. Строка без дня и времени пропускается
// молча, строка с днём, но без понятного времени, попадает в ошибки.
import { addDays } from "./time.ts";

export type Category = "class" | "work" | "tutoring" | "sport" | "other";

export interface Entry {
  kind: "weekly" | "once";
  weekday: number | null;
  date: string | null;
  start: number;
  end: number;
  title: string;
  category: Category;
  online: boolean;
  place: string | null;
}

export interface ParseResult {
  entries: Entry[];
  errors: { line: number; text: string; reason: string }[];
}

const MAX_ENTRIES = 400;

/** Сколько вперёд принимаем разовые даты: семестр с запасом. */
const HORIZON_DAYS = 200;

function clean(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[*_`]/g, "").trim();
}

const DAY_PREFIX: [string, number][] = [
  ["пн", 1], ["пон", 1], ["mon", 1],
  ["вт", 2], ["втор", 2], ["tue", 2],
  ["ср", 3], ["сред", 3], ["wed", 3],
  ["чт", 4], ["чет", 4], ["thu", 4],
  ["пт", 5], ["пят", 5], ["fri", 5],
  ["сб", 6], ["суб", 6], ["sat", 6],
  ["вс", 7], ["вос", 7], ["sun", 7],
];

function weekday(token: string): number | null {
  const t = clean(token).replace(/\.$/, "");
  if (!t) return null;
  // Сначала длинные приставки: «среда» — это «сред», а не «ср» + мусор
  for (const [p, n] of [...DAY_PREFIX].sort((a, b) => b[0].length - a[0].length)) {
    if (t === p || (p.length >= 3 && t.startsWith(p))) return n;
  }
  return null;
}

function isoDate(token: string, today: string): string | null {
  const t = clean(token);
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(t);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  if (m[3]) return valid(`${m[3].length === 2 ? "20" + m[3] : m[3]}-${mm}-${dd}`);
  // Год не указан: ближайшая такая дата, прошедшая не больше месяца назад
  const year = Number(today.slice(0, 4));
  const thisYear = valid(`${year}-${mm}-${dd}`);
  if (thisYear && thisYear >= addDays(today, -31)) return thisYear;
  return valid(`${year + 1}-${mm}-${dd}`);
}

function valid(d: string): string | null {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? null : d;
}

/** Поле «ДЕНЬ» → дни недели или даты. null — это не день, а, например, заголовок. */
export function parseDays(field: string, today: string): { weekdays: number[]; dates: string[] } | null {
  const t = clean(field);
  if (/^(будни|по будням|рабочие дни)$/.test(t)) return { weekdays: [1, 2, 3, 4, 5], dates: [] };
  if (/^(выходные|по выходным)$/.test(t)) return { weekdays: [6, 7], dates: [] };
  if (/^(ежедневно|каждый день|все дни)$/.test(t)) return { weekdays: [1, 2, 3, 4, 5, 6, 7], dates: [] };
  const weekdays = new Set<number>();
  const dates: string[] = [];
  for (const part of t.split(/\s*(?:,|;|\s\+\s|\sи\s)\s*/)) {
    if (!part) continue;
    const range = /^(\S+?)\s*[-–—]\s*(\S+)$/.exec(part);
    if (range && weekday(range[1]) && weekday(range[2])) {
      // «пт-пн» тоже можно: через выходные
      let d = weekday(range[1])!;
      const to = weekday(range[2])!;
      for (let i = 0; i < 7; i++) {
        weekdays.add(d);
        if (d === to) break;
        d = (d % 7) + 1;
      }
      continue;
    }
    const wd = weekday(part);
    if (wd) {
      weekdays.add(wd);
      continue;
    }
    const iso = isoDate(part, today);
    if (iso) {
      dates.push(iso);
      continue;
    }
    return null;
  }
  return weekdays.size || dates.length ? { weekdays: [...weekdays].sort(), dates } : null;
}

/** «09:30-10:50», «9.30–10.50», «с 9:30 до 10:50». Конец 24:00 допустим. */
export function parseTime(field: string): { start: number; end: number } | null {
  const m = /(\d{1,2})[:.](\d{2})\s*(?:[-–—]|до)\s*(\d{1,2})[:.](\d{2})/.exec(clean(field));
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || start > 1439 || end > 1440) return null;
  return { start, end };
}

export function categoryOf(type: string, title: string): Category {
  const t = clean(type);
  const all = `${t} ${clean(title)}`;
  const pick = (s: string): Category | null =>
    /пара|лекц|семинар|учеб|практик|лаборатор|коллоквиум|экзамен|зачет|консультац/.test(s) ? "class" :
    /работ|смена|офис|дежурств|стажир/.test(s) ? "work" :
    /спорт|трениров|зал|бассейн|бег|йог|фитнес|футбол|танц/.test(s) ? "sport" :
    /занят|репетит|кружок|курс|урок|секци|студи/.test(s) ? "tutoring" :
    null;
  // Тип важнее названия: «Работа над курсовой | пара» — это пара
  return pick(t) ?? pick(all) ?? "other";
}

const ONLINE = /онлайн|online|дистанц|удален|zoom|вебинар|teams|mts link|мтс линк/;

/** Разобрать ответ чата. Неразобранные строки с днём возвращаются ошибками с номером. */
export function parseScheduleText(text: string, today: string): ParseResult {
  const entries: Entry[] = [];
  const errors: ParseResult["errors"] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  lines.forEach((raw, i) => {
    // markdown-таблица: крайние | и строка-разделитель |---|---|
    const line = raw.trim().replace(/^\|/, "").replace(/\|$/, "").trim();
    if (!line || /^[-:|\s]+$/.test(line) || line.startsWith("```")) return;
    let cells = line.includes("|") ? line.split("|").map((c) => c.trim()) : line.split(/\s*;\s*/);
    // Чат пренебрёг чертами: «пн 09:30-10:50 Матанализ» — день, время и остальное подряд
    const loose = /^(.+?)\s+(\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2})\s*[,—–-]?\s*(.*)$/.exec(cells[0]);
    if (cells.length === 1 && loose) cells = [loose[1], loose[2], loose[3]];
    const days = parseDays(cells[0] ?? "", today);
    if (!days) return; // пояснение, заголовок «ДЕНЬ | ВРЕМЯ…» — не наше
    const time = parseTime(cells[1] ?? "");
    const fail = (reason: string) => errors.push({ line: i + 1, text: raw.trim().slice(0, 120), reason });
    if (!time) return fail("не понял время — нужно 09:30-10:50");
    if (time.end <= time.start) return fail("конец раньше начала — ночную смену разбей на две строки");
    const title = (cells[2] ?? "").replace(/\s+/g, " ").slice(0, 120);
    const type = cells[3] ?? "";
    const place = (cells[4] ?? "").trim();
    const online = ONLINE.test(clean(`${type} ${place}`));
    const base = { start: time.start, end: time.end, title, category: categoryOf(type, title), online, place: place && !ONLINE.test(clean(place)) ? place.slice(0, 80) : null };
    for (const wd of days.weekdays) entries.push({ kind: "weekly", weekday: wd, date: null, ...base });
    for (const d of days.dates) {
      if (d < addDays(today, -7) || d > addDays(today, HORIZON_DAYS)) {
        fail(`дата ${d} далеко от сегодняшней`);
        continue;
      }
      entries.push({ kind: "once", weekday: null, date: d, ...base });
    }
  });
  // Чаты иногда повторяют строку дважды — одинаковые записи схлопываем
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const key = `${e.kind}|${e.weekday}|${e.date}|${e.start}|${e.end}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { entries: unique.slice(0, MAX_ENTRIES), errors };
}
