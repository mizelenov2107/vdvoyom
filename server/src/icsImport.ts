// Расписание из календаря по ссылке (04.10.2026): HSE App X и SmartLMS умеют
// выгружать пары календарём iCal, так же — Google, Яндекс, Outlook и РУЗ других
// вузов. Человек вставляет ссылку, сервер раз в сутки забирает её и кладёт
// занятия на месяц вперёд по датам (kind = 'once', source = 'ics'), как РЭУ.
//
// Ссылку приносит пользователь, а забирает сервер — поэтому только https и
// только внешние адреса: внутренние (127.*, 10.*, 192.168.*, docker-имена без
// точки) запрещены, иначе ссылкой можно было бы постучаться во внутреннюю сеть.
import { lookup } from "node:dns/promises";
import net from "node:net";
import { all, run, tx } from "./db.ts";
import { addDays, today } from "./time.ts";
import { categoryOf } from "./schedText.ts";

export interface IcsLesson {
  date: string;
  start: number;
  end: number;
  title: string;
  place: string;
  online: boolean;
  /** Категории и описание события: по ним видно «лекция», «семинар», «работа» */
  hint: string;
}

const HORIZON_DAYS = 31;
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:") && privateIp(v.slice(7));
}

/** webcal:// → https://; только внешний https. Возвращает нормальную ссылку или текст ошибки. */
export async function checkUrl(raw: string): Promise<{ url: string } | { error: string }> {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    return { error: "Это не похоже на ссылку" };
  }
  if (u.protocol !== "https:") return { error: "Нужна ссылка https:// или webcal://" };
  if (!u.hostname.includes(".") || net.isIP(u.hostname)) return { error: "Нужна обычная ссылка с адресом сайта" };
  try {
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return { error: "Этот адрес недоступен" };
  } catch {
    return { error: "Такого сайта не нашлось" };
  }
  return { url: u.toString() };
}

export async function fetchIcs(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(url, { redirect: "error", headers: { "User-Agent": "vdvoyom calendar sync", Accept: "text/calendar, */*" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`календарь ответил ${res.status}`);
  const text = await res.text();
  if (text.length > 5_000_000) throw new Error("календарь слишком большой");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("по ссылке не календарь");
  return text;
}

/** Строки iCal: склеить переносы (строка, начатая пробелом, — продолжение предыдущей). */
function lines(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}
const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Дата-время iCal → дата и минуты по Москве. Z — UTC, TZID и «плавающее» время считаем московским. */
function moment(value: string, params: string): { date: string; min: number; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return { date: `${y}-${mo}-${d}`, min: 0, allDay: true };
  if (z) {
    const t = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi) + 3 * 3600_000);
    return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes(), allDay: false };
  }
  // TZID другой зоны встречается редко; Москва — по умолчанию для вузов РФ
  return { date: `${y}-${mo}-${d}`, min: +h * 60 + +mi, allDay: false };
}

const weekday = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();

/** Занятия из календаря на [from, from + HORIZON_DAYS], повторы RRULE раскрыты (DAILY и WEEKLY). */
export function parseIcs(ics: string, from: string): IcsLesson[] {
  const to = addDays(from, HORIZON_DAYS);
  const out: IcsLesson[] = [];
  let ev: Record<string, { v: string; p: string }[]> | null = null;
  for (const line of lines(ics)) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT" && ev) {
      out.push(...expand(ev, from, to));
      ev = null;
    } else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(";");
      (ev[name.toUpperCase()] ??= []).push({ v: line.slice(i + 1), p: params.join(";") });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((l) => (seen.has(`${l.date}|${l.start}|${l.title}`) ? false : (seen.add(`${l.date}|${l.start}|${l.title}`), true)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

function expand(ev: Record<string, { v: string; p: string }[]>, from: string, to: string): IcsLesson[] {
  if (ev.STATUS?.[0]?.v.toUpperCase() === "CANCELLED") return [];
  const s = ev.DTSTART?.[0] && moment(ev.DTSTART[0].v, ev.DTSTART[0].p);
  if (!s || s.allDay) return []; // события на весь день (праздники, дедлайны) — не занятость
  const e = ev.DTEND?.[0] && moment(ev.DTEND[0].v, ev.DTEND[0].p);
  let end = e && !e.allDay ? (e.date === s.date ? e.min : 1440) : s.min + 90;
  const dur = ev.DURATION?.[0]?.v.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!e && dur) end = s.min + Number(dur[1] ?? 0) * 60 + Number(dur[2] ?? 0);
  if (end <= s.min) return [];
  const title = unescape(ev.SUMMARY?.[0]?.v ?? "Занятие").slice(0, 120);
  const place = unescape(ev.LOCATION?.[0]?.v ?? "").slice(0, 120);
  const online = /онлайн|online|zoom|teams|meet\.|телемост|webinar|вебинар/i.test(`${title} ${place} ${ev.URL?.[0]?.v ?? ""}`);
  const hint = unescape(`${ev.CATEGORIES?.[0]?.v ?? ""} ${ev.DESCRIPTION?.[0]?.v ?? ""}`).slice(0, 200);
  const base = { start: s.min, end: Math.min(end, 1440), title, place, online, hint };
  const exdates = new Set((ev.EXDATE ?? []).flatMap((x) => x.v.split(",")).map((v) => moment(v, "")?.date).filter(Boolean));

  const rule = ev.RRULE?.[0]?.v;
  if (!rule) return s.date >= from && s.date <= to ? [{ date: s.date, ...base }] : [];
  const r = Object.fromEntries(rule.split(";").map((kv) => kv.split("=") as [string, string]));
  if (r.FREQ !== "WEEKLY" && r.FREQ !== "DAILY") return s.date >= from && s.date <= to ? [{ date: s.date, ...base }] : [];
  const until = r.UNTIL ? moment(r.UNTIL, "")?.date ?? to : to;
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const days = r.BYDAY ? r.BYDAY.split(",").map((d) => WD.indexOf(d.slice(-2))) : [weekday(s.date)];
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const out: IcsLesson[] = [];
  let n = 0;
  for (let d = s.date, i = 0; d <= until && d <= to && n < count && i < 800; d = addDays(d, 1), i++) {
    const weeks = Math.floor(i / 7);
    const hit = r.FREQ === "DAILY" ? i % interval === 0 : weeks % interval === 0 && days.includes(weekday(d));
    if (!hit) continue;
    n++;
    if (d >= from && !exdates.has(d)) out.push({ date: d, ...base });
  }
  return out;
}

/** Забрать календарь и положить занятия; пропуски («не хожу») переживают обновление. */
export async function syncIcs(userId: number, url: string, fetcher: typeof fetch = fetch): Promise<number> {
  const lessons = parseIcs(await fetchIcs(url, fetcher), today());
  const from = today();
  const skipped = new Set(
    all<{ date: string; start_min: number; title: string }>("SELECT date, start_min, title FROM schedule WHERE user_id = ? AND source = 'ics' AND skip = 1", userId).map(
      (r) => `${r.date}|${r.start_min}|${r.title}`,
    ),
  );
  tx(() => {
    run("DELETE FROM schedule WHERE user_id = ? AND source = 'ics' AND date >= ?", userId, from);
    for (const l of lessons) {
      run(
        `INSERT INTO schedule (user_id, kind, date, start_min, end_min, title, place, online, skip, category, source)
         VALUES (?, 'once', ?, ?, ?, ?, ?, ?, ?, ?, 'ics')`,
        userId, l.date, l.start, l.end, l.title, l.place, l.online ? 1 : 0, skipped.has(`${l.date}|${l.start}|${l.title}`) ? 1 : 0, categoryOf(l.hint, l.title),
      );
    }
    run("UPDATE users SET ics_url = ?, ics_synced_at = datetime('now') WHERE id = ?", url, userId);
  });
  return lessons.length;
}
