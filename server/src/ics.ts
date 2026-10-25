// Календарь телефона (отзыв #4, 28.09.2026): подписка iCal на события пары —
// свидания, поездки, события календаря, дни рождения и годовщина. Телефон сам
// перечитывает ссылку и держит всё в своём календаре. Ссылка личная, по секрету
// из users.cal_token: сбросить — POST /api/calendar/link/reset.
import { randomBytes } from "node:crypto";
import { all, get, run } from "./db.ts";
import { displayName, type PairRow, type UserRow } from "./model.ts";

const ICON: Record<string, string> = { date: "💞", trip: "✈️", birthday: "🎂", anniversary: "🎉", event: "📅" };

/** Экранирование текста iCal: \\ ; , и перевод строки. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (d: string) => d.replace(/-/g, "");
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;
const nextDay = (d: string) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** Строки длиннее 75 байт переносятся с пробелом в начале — так требует RFC 5545. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) {
      out.push(cur);
      cur = " " + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function calToken(u: UserRow): string {
  const row = get<{ cal_token: string | null }>("SELECT cal_token FROM users WHERE id = ?", u.id);
  if (row?.cal_token) return row.cal_token;
  return resetCalToken(u.id);
}

export function resetCalToken(userId: number): string {
  const t = randomBytes(18).toString("base64url");
  run("UPDATE users SET cal_token = ? WHERE id = ?", t, userId);
  return t;
}

export function icsFor(token: string): string | null {
  if (!/^[\w-]{20,40}$/.test(token)) return null;
  const me = get<UserRow>("SELECT * FROM users WHERE cal_token = ?", token);
  if (!me?.pair_id) return me ? calendar([]) : null;
  const people = all<UserRow>("SELECT * FROM users WHERE pair_id = ?", me.pair_id);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev: string[][] = [];
  const events = all<{ id: number; title: string; kind: string; date: string; end_date: string | null; start_min: number | null; end_min: number | null; yearly: number; repeat: string | null; note: string | null; status: string | null }>(
    "SELECT * FROM events WHERE pair_id = ? AND COALESCE(status, 'accepted') != 'declined'",
    me.pair_id,
  );
  for (const e of events) {
    const lines = [`UID:event-${e.id}@vdvoyom`, `DTSTAMP:${stamp}`, `SUMMARY:${text(`${ICON[e.kind] ?? "📅"} ${e.title}`)}`];
    if (e.start_min !== null) {
      lines.push(`DTSTART;TZID=Europe/Moscow:${day(e.date)}T${hhmm(e.start_min)}`);
      lines.push(`DTEND;TZID=Europe/Moscow:${day(e.end_date ?? e.date)}T${hhmm(e.end_min ?? Math.min(e.start_min + 120, 1439))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(nextDay(e.end_date ?? e.date))}`);
    }
    if (e.yearly) lines.push("RRULE:FREQ=YEARLY");
    else if (e.repeat === "week") lines.push("RRULE:FREQ=WEEKLY");
    else if (e.repeat === "month") lines.push("RRULE:FREQ=MONTHLY");
    if (e.note) lines.push(`DESCRIPTION:${text(e.note)}`);
    ev.push(lines);
  }
  for (const u of people) {
    if (u.id <= 0 || !u.birthday || u.birthday.startsWith("0000")) continue;
    ev.push([`UID:birthday-${u.id}@vdvoyom`, `DTSTAMP:${stamp}`, `SUMMARY:${text(`🎂 День рождения: ${displayName(u)}`)}`, `DTSTART;VALUE=DATE:${day(u.birthday)}`, `DTEND;VALUE=DATE:${day(nextDay(u.birthday))}`, "RRULE:FREQ=YEARLY"]);
  }
  const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", me.pair_id);
  if (pair?.together_since) {
    ev.push([`UID:anniversary-${pair.id}@vdvoyom`, `DTSTAMP:${stamp}`, `SUMMARY:${text("🎉 Наша годовщина")}`, `DTSTART;VALUE=DATE:${day(pair.together_since)}`, `DTEND;VALUE=DATE:${day(nextDay(pair.together_since))}`, "RRULE:FREQ=YEARLY"]);
  }
  return calendar(ev);
}

function calendar(events: string[][]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vdvoyom//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text("Вдвоём")}`,
    "X-WR-TIMEZONE:Europe/Moscow",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
