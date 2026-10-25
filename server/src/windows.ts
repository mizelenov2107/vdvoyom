import { all } from "./db.ts";
import type { UserRow } from "./model.ts";
import { findWindows, subtract, type Block, type Interval, type Window } from "./slots.ts";
import { addDays, mskNow, today, weekdayOf } from "./time.ts";

export function blocksOf(userId: number): Block[] {
  // Разовые записи раньше вчерашнего дня окнам не нужны
  return all<Block>(
    `SELECT kind, weekday, date, start_min, end_min, skip, online FROM schedule
     WHERE user_id = ? AND (kind = 'weekly' OR date >= ?)`,
    userId,
    addDays(today(), -1),
  );
}

/** Общие окна пары. Пока половинки нет, считаются окна одного человека. */
/**
 * Окно «вместе», которое показываем людям: от полутора часов. Одно число для
 * главной и для утренней сводки бота — раньше бот брал от часа, а главная от
 * полутора, и бот писал окна, которых в приложении нет (жалоба 04.10.2026).
 */
export const SHOWN_WINDOW_MIN = 90;

/** Общие окна на дату — ровно те, что видит главная. */
export function windowsOn(a: UserRow, b: UserRow, date: string): Window[] {
  return pairWindows(a, b, 14, SHOWN_WINDOW_MIN).filter((w) => w.date === date);
}

export function pairWindows(me: UserRow, partner: UserRow | undefined, days = 14, minMinutes = SHOWN_WINDOW_MIN): Window[] {
  const a = me;
  const b = partner ?? me;
  return findWindows({ a, aBlocks: blocksOf(a.id), b, bBlocks: blocksOf(b.id), days, minMinutes }).sort((x, y) =>
    x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1,
  );
}

export interface NowStatus {
  /** road — до очного занятия меньше, чем занимает дорога: человек уже едет */
  state: "busy" | "free" | "road" | "rest";
  title: string | null;
  category: string | null;
  online: boolean;
  /** Во сколько освободится (busy) или во сколько снова занят (free); null — до конца дня */
  until: number | null;
  /** Следующее занятие сегодня */
  next: { title: string; start: number } | null;
}

/** Перемена короче часа — ещё учёба: в РЭУ большая перемена 40 минут, в Вышке 30. */
const BREAK_MAX = 60;

type ClassRow = { start_min: number; end_min: number; title: string; online: number; category: string; source: string };

/**
 * Личные дела (08.10.2026): маникюр, зал, врач, встреча с друзьями — то, что
 * человек сам внёс в календаре кнопкой «Только я» или «Занятостью». Окна их и
 * так обходят; бот называет их по имени, а не «занятиями».
 */
export const PERSONAL_CATEGORIES = ["sport", "beauty", "health", "errands", "friends", "other"];
export const isPersonal = (r: { category: string; source: string }): boolean => r.source === "manual" && PERSONAL_CATEGORIES.includes(r.category);

/** Занятия человека на дату без пропускаемых и отменённых, по времени начала. */
function classesOn(p: UserRow, date: string): ClassRow[] {
  const rows = all<ClassRow & { kind: string; skip: number }>(
    `SELECT kind, start_min, end_min, title, skip, online, category, source FROM schedule
     WHERE user_id = ? AND ((kind = 'weekly' AND weekday = ?) OR date = ?)`,
    p.id, weekdayOf(date), date,
  );
  const freed = rows.filter((r) => r.kind === "free");
  return rows
    .filter((r) => r.kind !== "free" && !r.skip && !freed.some((f) => f.start_min <= r.start_min && f.end_min >= r.end_min))
    .sort((a, b) => a.start_min - b.start_min);
}

/** Личные дела человека на дату по времени: «Маникюр 15:00–16:00». */
export function personalOn(p: UserRow, date: string): { title: string; start: number; end: number; category: string }[] {
  return classesOn(p, date).filter(isPersonal).map((r) => ({ title: r.title, start: r.start_min, end: r.end_min, category: r.category }));
}

/**
 * Учебный день кусками: пары с переменой короче часа склеены, «8:30–15:30» вместо «до 13:20».
 * withPersonal = false — без личных дел: их сводка бота называет отдельно.
 */
export function busyChunks(p: UserRow, date: string, withPersonal = true): Interval[] {
  const out: Interval[] = [];
  for (const r of classesOn(p, date)) {
    if (!withPersonal && isPersonal(r)) continue;
    const last = out[out.length - 1];
    if (last && r.start_min - last.end < BREAK_MAX) last.end = Math.max(last.end, r.end_min);
    else out.push({ start: r.start_min, end: r.end_min });
  }
  return out;
}

/** Что человек делает прямо сейчас по его расписанию. Считает код, как и окна. */
export function statusNow(p: UserRow, now = Date.now()): NowStatus {
  const { date, minutes } = mskNow(now);
  const today = classesOn(p, date);
  if (minutes < 7 * 60 || minutes >= p.day_end_min) {
    const first = today[0];
    return { state: "rest", title: null, category: null, online: false, until: null, next: first ? { title: first.title, start: first.start_min } : null };
  }
  const cur = today.find((r) => r.start_min <= minutes && minutes < r.end_min);
  if (cur) {
    // Пары подряд с переменой короче часа считаем одним занятым куском
    let until = cur.end_min;
    for (const r of today) if (r.start_min > cur.start_min && r.start_min - until < BREAK_MAX) until = Math.max(until, r.end_min);
    const after = today.find((r) => r.start_min >= until);
    return { state: "busy", title: cur.title, category: cur.category, online: !!cur.online, until, next: after ? { title: after.title, start: after.start_min } : null };
  }
  const nxt = today.find((r) => r.start_min > minutes);
  // Выйти надо было раньше, чем сейчас: не «свободно до» прошедшего времени, а «в дороге»
  if (nxt && !nxt.online && nxt.start_min - p.gap_min <= minutes) {
    return { state: "road", title: nxt.title, category: nxt.category, online: false, until: nxt.start_min, next: { title: nxt.title, start: nxt.start_min } };
  }
  return {
    state: "free",
    title: null,
    category: null,
    online: false,
    until: nxt ? nxt.start_min - (nxt.online ? 0 : p.gap_min) : null,
    next: nxt ? { title: nxt.title, start: nxt.start_min } : null,
  };
}

export interface DayPerson {
  /** Пары и занятость этого дня, как есть в расписании, включая пропускаемые */
  busy: { start: number; end: number; title: string; online: boolean; skip: boolean; category: string }[];
  /** Промежутки между парами без учёта дороги — время созвониться или заняться своим */
  free: { start: number; end: number }[];
}

const VIEW_FROM = 8 * 60;
const VIEW_TO = 23 * 60;

function personDay(p: UserRow, date: string): DayPerson {
  const wd = weekdayOf(date);
  const rows = all<{ kind: string; weekday: number | null; date: string | null; start_min: number; end_min: number; title: string; skip: number; online: number; category: string }>(
    `SELECT kind, weekday, date, start_min, end_min, title, skip, online, category FROM schedule
     WHERE user_id = ? AND ((kind = 'weekly' AND weekday = ?) OR date = ?)`,
    p.id, wd, date,
  );
  const freed = rows.filter((r) => r.kind === "free").map((r) => ({ start: r.start_min, end: r.end_min }));
  const busy = rows
    .filter((r) => r.kind !== "free" && !freed.some((f) => f.start <= r.start_min && f.end >= r.end_min))
    .sort((a, b) => a.start_min - b.start_min)
    .map((r) => ({ start: r.start_min, end: r.end_min, title: r.title, online: !!r.online, skip: !!r.skip, category: r.category }));
  const occupied = busy.filter((b) => !b.skip).map((b) => ({ start: b.start, end: b.end }));
  return { busy, free: subtract([{ start: VIEW_FROM, end: VIEW_TO }], occupied).filter((f) => f.end - f.start >= 15) };
}

/** Разбор дней: у каждого пары и свободные промежутки, плюс общие окна с дорогой. */
export function daysBreakdown(me: UserRow, partner: UserRow | undefined, days: number) {
  const common = pairWindows(me, partner, days, 45);
  const start = mskNow().date;
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      me: personDay(me, date),
      partner: partner ? personDay(partner, date) : null,
      common: common.filter((w) => w.date === date).map((w) => ({ start: w.start, end: w.end })),
    };
  });
}
