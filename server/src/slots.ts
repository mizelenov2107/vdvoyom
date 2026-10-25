import { addDays, mskNow, weekdayOf } from "./time.ts";

export interface Interval {
  start: number;
  end: number;
}

export interface Person {
  /** Запас до встречи: дорога и сборы до и после очных дел */
  gap_min: number;
  day_start_min: number;
  day_end_min: number;
}

export interface Block {
  kind: "weekly" | "once" | "free";
  weekday: number | null;
  date: string | null;
  start_min: number;
  end_min: number;
  skip: number;
  online: number;
}

export interface Window {
  date: string;
  start: number;
  end: number;
  score: number;
}

/** Сортирует и склеивает пересекающиеся интервалы. */
export function normalize(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Вычитает из base всё, что покрыто cuts. */
export function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let acc = normalize(base);
  for (const hole of normalize(cuts)) {
    const next: Interval[] = [];
    for (const piece of acc) {
      if (hole.end <= piece.start || hole.start >= piece.end) {
        next.push(piece);
        continue;
      }
      if (hole.start > piece.start) next.push({ start: piece.start, end: hole.start });
      if (hole.end < piece.end) next.push({ start: hole.end, end: piece.end });
    }
    acc = next;
  }
  return acc;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) out.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return out;
}

/** Пары человека на дату, без пропускаемых и отменённых, с буфером на дорогу. */
export function busyOn(p: Person, blocks: Block[], date: string): Interval[] {
  const wd = weekdayOf(date);
  const hits = blocks.filter(
    (b) => (b.kind === "weekly" && b.weekday === wd) || (b.kind !== "weekly" && b.date === date),
  );
  const freed = hits.filter((b) => b.kind === "free").map((b) => ({ start: b.start_min, end: b.end_min }));
  const out: Interval[] = [];
  for (const b of hits) {
    if (b.kind === "free" || b.skip) continue;
    // Отмену вычитаем до того, как накинуть запас: иначе буфер вокруг
    // отменённой пары остался бы висеть. Вебинар дороги не требует.
    const road = b.online ? 0 : p.gap_min;
    for (const piece of subtract([{ start: b.start_min, end: b.end_min }], freed)) {
      out.push({ start: piece.start - road, end: piece.end + road });
    }
  }
  return normalize(out);
}

export function freeOn(p: Person, blocks: Block[], date: string): Interval[] {
  return subtract([{ start: p.day_start_min, end: p.day_end_min }], busyOn(p, blocks, date));
}

/** Общие свободные окна пары на horizon дней вперёд. Считает код, не модель. */
export function findWindows(opts: {
  a: Person;
  aBlocks: Block[];
  b: Person;
  bBlocks: Block[];
  days: number;
  minMinutes?: number;
  now?: number;
}): Window[] {
  const minLen = opts.minMinutes ?? 90;
  const now = mskNow(opts.now);
  const out: Window[] = [];
  for (let d = 0; d < opts.days; d++) {
    const date = addDays(now.date, d);
    let common = intersect(freeOn(opts.a, opts.aBlocks, date), freeOn(opts.b, opts.bBlocks, date));
    // Сегодня окно начинается не раньше, чем через полчаса.
    if (d === 0) common = subtract(common, [{ start: 0, end: now.minutes + 30 }]);
    for (const i of common) {
      if (i.end - i.start < minLen) continue;
      out.push({ date, start: i.start, end: i.end, score: scoreWindow(date, i, d) });
    }
  }
  return out;
}

function scoreWindow(date: string, i: Interval, daysAhead: number): number {
  const wd = weekdayOf(date);
  let score = 0;
  if (wd >= 6) score += 30;
  if (wd < 6 && i.start >= 17 * 60) score += 15;
  score += Math.min((i.end - i.start) / 60, 6) * 3;
  score -= daysAhead * 0.7;
  return score;
}
