// Всё время приложения — московское. Перевода часов в России нет,
// поэтому фиксированное смещение точнее и проще, чем имена зон.
export const MSK_OFFSET_MIN = 180;

export function mskNow(now = Date.now()): { date: string; minutes: number; weekday: number } {
  const shifted = new Date(now + MSK_OFFSET_MIN * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  return { date, minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), weekday: weekdayOf(date) };
}

export function today(): string {
  return mskNow().date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Сколько дней от a до b (b позже — положительное). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/** Понедельник = 1, воскресенье = 7. */
export function weekdayOf(date: string): number {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

/** Ближайшая дата (сегодня или позже), когда повторится день и месяц из md вида YYYY-MM-DD. */
export function nextYearly(md: string, from: string): string {
  const mmdd = md.slice(5);
  const year = Number(from.slice(0, 4));
  for (const y of [year, year + 1]) {
    let candidate = `${y}-${mmdd}`;
    // 29 февраля в невисокосный год празднуем 28-го
    if (mmdd === "02-29" && !isLeap(y)) candidate = `${y}-02-28`;
    if (candidate >= from) return candidate;
  }
  return `${year + 1}-${mmdd}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WD_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function humanDate(date: string, from = today()): string {
  const diff = daysBetween(from, date);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  const [, m, d] = date.split("-").map(Number);
  return `${WD_SHORT[weekdayOf(date)]}, ${d} ${MONTHS_GEN[m - 1]}`;
}

export function dayMonth(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

/**
 * Даты повторяющегося события в промежутке [from, to]: каждую неделю или каждый
 * месяц с даты начала (07.10.2026: самая частая просьба к You&Me — «нет повторов»).
 * Каждый месяц — в то же число; в месяце без такого числа (31-е, 30 февраля)
 * событие пропускается, как в календарях Apple и Google по RRULE.
 */
export function repeatDates(start: string, repeat: string | null | undefined, from: string, to: string): string[] {
  const out: string[] = [];
  if (from < start) from = start;
  if (repeat === "week") {
    for (let d = addDays(start, Math.ceil(daysBetween(start, from) / 7) * 7); d <= to; d = addDays(d, 7)) out.push(d);
  } else if (repeat === "month") {
    const day = Number(start.slice(8));
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    for (let i = 0; i < 240; i++, m === 12 ? ((m = 1), y++) : m++) {
      const d = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (d > to) break;
      if (day <= new Date(Date.UTC(y, m, 0)).getUTCDate() && d >= from) out.push(d);
    }
  }
  return out;
}

/** Событие приходится на этот день: обычное, многодневное или повторяющееся (не ежегодное). */
export function eventOn(e: { date: string; end_date?: string | null; repeat?: string | null }, day: string): boolean {
  if (e.repeat) return repeatDates(e.date, e.repeat, day, day).length > 0;
  return e.date <= day && (e.end_date ?? e.date) >= day;
}
