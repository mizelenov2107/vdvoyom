// Расписание РЭУ им. Плеханова с rasp.rea.ru. Оно публичное и отдаётся по
// номеру группы и номеру недели, но меняется от недели к неделе, поэтому
// храним его по датам (kind = 'once', source = 'rea') на месяц вперёд.
import { all, run, tx } from "./db.ts";
import { today } from "./time.ts";

const BASE = "https://rasp.rea.ru";
const HEADERS = { "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0 (vdvoyom schedule sync)" };

export interface ReaLesson {
  date: string;
  start_min: number;
  end_min: number;
  title: string;
  kind: string;
  place: string;
  online: boolean;
}

export async function searchGroups(term: string): Promise<{ key: string; name: string; meta: string }[]> {
  const url = `${BASE}/Schedule/SearchBarSuggestions?searchFor=${encodeURIComponent(term)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { name: string; key: string; metadata: string }[] | 0;
  if (!Array.isArray(data)) return [];
  // Преподаватели в выдаче тоже есть; группа узнаётся по слешу в ключе.
  return data.filter((d) => d.key.includes("/")).map((d) => ({ key: d.key, name: d.name, meta: d.metadata }));
}

async function fetchWeek(group: string, weekNum: number): Promise<string> {
  const q = new URLSearchParams({ selection: group, weekNum: String(weekNum), catfilter: "0" });
  const res = await fetch(`${BASE}/Schedule/ScheduleCard?${q}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`rasp.rea.ru ответил ${res.status}`);
  return res.text();
}

const decode = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

export function parseWeek(html: string): { weekNum: number | null; lessons: ReaLesson[] } {
  const wk = /id="weekNum"[^>]*value="(\d+)"/.exec(html);
  const lessons: ReaLesson[] = [];
  for (const day of html.split('<th class="dayh"').slice(1)) {
    const h = /(\d{2})\.(\d{2})\.(\d{4})/.exec(day);
    if (!h) continue;
    const date = `${h[3]}-${h[2]}-${h[1]}`;
    for (const tr of day.matchAll(/<tr class="slot (load-[\w-]+)">([\s\S]*?)<\/tr>/g)) {
      if (tr[1] === "load-empty") continue;
      const times = [...tr[2].slice(0, 500).matchAll(/(\d{2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
      const a = /<a [^>]*class='task'[^>]*>([\s\S]*?)<\/a>/.exec(tr[2]);
      if (!a || times.length < 2) continue;
      const parts = a[1].split(/<br\s*\/?>/).map(clean).filter(Boolean);
      const place = parts.slice(2).join(" ").replace(/\s+,/g, ",").replace(/, пл\. Основная/, "");
      lessons.push({
        date,
        start_min: times[0],
        end_min: times[1],
        title: parts[0] ?? "",
        kind: parts[1] ?? "",
        place,
        online: /вебинар|cast_for_education|дистанц/i.test(tr[2]),
      });
    }
  }
  return { weekNum: wk ? Number(wk[1]) : null, lessons };
}

// Одна группа — одно скачивание на 6 часов: у многих студентов общая группа,
// и без кэша сайт РЭУ получал бы одинаковые запросы десятками.
const cache = new Map<string, { at: number; lessons: ReaLesson[] }>();

/** Текущая неделя и ещё четыре вперёд. */
export async function fetchUpcoming(group: string, weeksAhead = 4): Promise<ReaLesson[]> {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.lessons;
  const lessons = await fetchUpcomingFresh(group, weeksAhead);
  cache.set(group, { at: Date.now(), lessons });
  return lessons;
}

async function fetchUpcomingFresh(group: string, weeksAhead: number): Promise<ReaLesson[]> {
  const first = parseWeek(await fetchWeek(group, -1));
  const out = [...first.lessons];
  if (first.weekNum) {
    for (let w = first.weekNum + 1; w <= first.weekNum + weeksAhead; w++) {
      out.push(...parseWeek(await fetchWeek(group, w)).lessons);
    }
  }
  return out;
}

/**
 * Заменяет подтянутые пары с сегодняшнего дня на свежие. Пары, которые
 * пользователь пометил «не хожу», остаются пропущенными и после обновления.
 */
export async function syncUser(userId: number, group: string): Promise<number> {
  const lessons = await fetchUpcoming(group);
  const from = today();
  const skipped = new Set(
    all<{ date: string; start_min: number; title: string }>(
      "SELECT date, start_min, title FROM schedule WHERE user_id = ? AND source = 'rea' AND skip = 1",
      userId,
    ).map((r) => `${r.date}|${r.start_min}|${r.title}`),
  );
  tx(() => {
    run("DELETE FROM schedule WHERE user_id = ? AND source = 'rea' AND date >= ?", userId, from);
    for (const l of lessons) {
      if (l.date < from) continue;
      const skip = skipped.has(`${l.date}|${l.start_min}|${l.title}`) ? 1 : 0;
      run(
        `INSERT INTO schedule (user_id, kind, date, start_min, end_min, title, place, online, skip, source)
         VALUES (?, 'once', ?, ?, ?, ?, ?, ?, ?, 'rea')`,
        userId,
        l.date,
        l.start_min,
        l.end_min,
        l.kind ? `${l.title} · ${l.kind.toLowerCase()}` : l.title,
        l.place,
        l.online ? 1 : 0,
        skip,
      );
    }
    run("UPDATE users SET rea_group = ?, rea_synced_at = datetime('now') WHERE id = ?", group, userId);
  });
  return lessons.length;
}
