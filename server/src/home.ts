import { all, get } from "./db.ts";
import type { PairRow, UserRow } from "./model.ts";
import { displayName } from "./model.ts";
import { partnerOf } from "./pairs.ts";
import { addDays, daysBetween, eventOn, nextYearly, repeatDates, today } from "./time.ts";
import { pairWindows, SHOWN_WINDOW_MIN, statusNow } from "./windows.ts";
import { dailyState } from "./daily.ts";
import { goalsOf } from "./routes/goals.ts";
import { waitingFor } from "./testy.ts";
import { isBeta } from "./beta.ts";
import { benefitAt, plusOf } from "./plus.ts";
import { env } from "./env.ts";

export interface Upcoming {
  kind: string;
  title: string;
  date: string;
  daysLeft: number;
  who?: number;
}

/** Ближайшие события пары: календарь, дни рождения, годовщина — на horizon дней. */
export function upcoming(pairId: number, users: UserRow[], horizon = 45, viewerId?: number): Upcoming[] {
  const from = today();
  const to = addDays(from, horizon);
  const out: Upcoming[] = [];
  const events = all<{ title: string; kind: string; date: string; end_date: string | null; yearly: number; repeat: string | null; author_id: number }>(
    "SELECT title, kind, date, end_date, yearly, repeat, author_id FROM events WHERE pair_id = ?",
    pairId,
  );
  for (const e of events) {
    if (e.repeat) {
      // Повторяющееся — только ближайший раз, а не каждая неделя подряд
      const next = repeatDates(e.date, e.repeat, from, to)[0];
      if (next) out.push({ kind: e.kind, title: e.title, date: next, daysLeft: daysBetween(from, next), who: e.author_id });
      continue;
    }
    const d = e.yearly ? nextYearly(e.date, from) : e.date;
    const last = e.end_date && !e.yearly ? e.end_date : d;
    if (last >= from && d <= to) out.push({ kind: e.kind, title: e.title, date: d < from ? from : d, daysLeft: Math.max(0, daysBetween(from, d)), who: e.author_id });
  }
  for (const u of users) {
    if (!u.birthday) continue;
    const d = nextYearly(u.birthday, from);
    if (d <= to) out.push({ kind: "birthday", title: `День рождения ${genitive(displayName(u))}`, date: d, daysLeft: daysBetween(from, d), who: u.id });
  }
  const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", pairId);
  if (pair?.together_since) {
    const d = nextYearly(pair.together_since, addDays(from, 1));
    const years = Number(d.slice(0, 4)) - Number(pair.together_since.slice(0, 4));
    if (d <= to && years > 0) out.push({ kind: "anniversary", title: `${years}-я годовщина`, date: d, daysLeft: daysBetween(from, d) });
  }
  // Сюрприз в «Скоро» видит только автор
  const caps = all<{ title: string; open_at: string; author_id: number }>(
    "SELECT title, open_at, author_id FROM capsules WHERE pair_id = ? AND open_at > ? AND open_at <= ? AND (secret = 0 OR author_id = ?)",
    pairId,
    from,
    to,
    viewerId ?? 0,
  );
  for (const c of caps) out.push({ kind: "capsule", title: "Откроется капсула", date: c.open_at, daysLeft: daysBetween(from, c.open_at), who: c.author_id });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
}

/** Имя в родительном падеже для подписи «День рождения Алины» — только частые окончания. */
export function genitive(name: string): string {
  if (/[ая]$/.test(name) && name.length > 2) {
    const stem = name.slice(0, -1);
    return /[гкхжчшщ]$/.test(stem) || name.endsWith("я") ? stem + "и" : stem + "ы";
  }
  if (/[бвгдзклмнпрстфхцжчшщ]$/i.test(name)) return name + "а";
  if (name.endsWith("й")) return name.slice(0, -1) + "я";
  return name;
}

export function homeSummary(me: UserRow) {
  const pairId = me.pair_id!;
  const partner = partnerOf(me);
  const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", pairId)!;
  const t = today();
  const users = partner ? [me, partner] : [me];

  let together: { days: number; since: string; next: { date: string; daysLeft: number; years: number } } | null = null;
  if (pair.together_since) {
    const next = nextYearly(pair.together_since, addDays(t, 1));
    together = {
      since: pair.together_since,
      days: daysBetween(pair.together_since, t) + 1,
      next: { date: next, daysLeft: daysBetween(t, next), years: Number(next.slice(0, 4)) - Number(pair.together_since.slice(0, 4)) },
    };
  }

  const year = t.slice(0, 4);
  const count = (sql: string, ...p: (string | number)[]) => get<{ n: number }>(sql, ...p)!.n;
  const stats = {
    year,
    wishesDone: count("SELECT COUNT(*) AS n FROM wishes WHERE pair_id = ? AND done_at >= ?", pairId, `${year}-01-01`),
    movies: count("SELECT COUNT(*) AS n FROM matches WHERE pair_id = ? AND deck = 'movie' AND created_at >= ?", pairId, `${year}-01-01`),
    ideasDone: count("SELECT COUNT(*) AS n FROM matches WHERE pair_id = ? AND deck = 'idea' AND status = 'done' AND created_at >= ?", pairId, `${year}-01-01`),
    plansClosed: count("SELECT COUNT(*) AS n FROM plans WHERE pair_id = ? AND archived_at >= ?", pairId, `${year}-01-01`),
    tasksDone: count("SELECT COUNT(*) AS n FROM tasks WHERE pair_id = ? AND done_at >= ?", pairId, `${year}-01-01`),
    questions: count("SELECT COUNT(DISTINCT date) AS n FROM daily_answers WHERE pair_id = ? AND date >= ?", pairId, `${year}-01-01`),
  };

  const tasks = {
    mine: count("SELECT COUNT(*) AS n FROM tasks WHERE pair_id = ? AND done_at IS NULL AND assignee_id = ?", pairId, me.id),
    free: count("SELECT COUNT(*) AS n FROM tasks WHERE pair_id = ? AND done_at IS NULL AND assignee_id IS NULL", pairId),
  };

  const capsulesReady = all<{ id: number; title: string; author_id: number; open_at: string }>(
    "SELECT id, title, author_id, open_at FROM capsules WHERE pair_id = ? AND open_at <= ? AND author_id != ? AND read_at IS NULL",
    pairId,
    t,
    me.id,
  );

  const lastPing = partner
    ? get<{ kind: string; created_at: string }>(
        "SELECT kind, created_at FROM pings WHERE from_id = ? AND created_at > datetime('now', '-12 hours') ORDER BY id DESC LIMIT 1",
        partner.id,
      ) ?? null
    : null;

  const newMatches = count("SELECT COUNT(*) AS n FROM matches WHERE pair_id = ? AND status = 'new'", pairId);

  const todayEvents = all<{ id: number; title: string; kind: string; date: string; end_date: string | null; repeat: string | null; start_min: number | null; end_min: number | null; status: string | null; author_id: number }>(
    "SELECT id, title, kind, date, end_date, repeat, start_min, end_min, status, author_id FROM events WHERE pair_id = ? AND yearly = 0 AND date <= ? ORDER BY start_min",
    pairId, t,
  ).filter((e) => eventOn(e, t)).map(({ date: _d, end_date: _e, repeat: _r, ...e }) => e);

  return {
    together,
    now: { me: statusNow(me), partner: partner ? statusNow(partner) : null },
    goals: goalsOf(pairId).filter((g) => !g.archived_at).slice(0, 4).map((g) => ({
      id: g.id, title: g.title, emoji: g.emoji, kind: g.kind, progress: g.progress, target: g.target, unit: g.unit, streak: g.streak, byUser: g.byUser,
    })),
    todayEvents,
    windows: pairWindows(me, partner, 10, SHOWN_WINDOW_MIN).slice(0, 4),
    hasSchedule: {
      me: count("SELECT COUNT(*) AS n FROM schedule WHERE user_id = ?", me.id) > 0,
      partner: partner ? count("SELECT COUNT(*) AS n FROM schedule WHERE user_id = ?", partner.id) > 0 : false,
    },
    daily: dailyState(me, partner, t, false),
    upcoming: upcoming(pairId, users, 45, me.id),
    stats,
    tasks,
    capsulesReady,
    lastPing,
    newMatches,
    /** Партнёр закончил раунд теста и ждёт тебя — единственная карточка тестов на главной (только бета новых тестов) */
    testWaiting: isBeta(me) ? waitingFor(me, partner ?? undefined) : null,
    ...plusMoment(me, pairId, partner),
  };
}

/**
 * Когда продавать (11.10.2026): «Вдвоём+» во весь экран и акция — только после первой
 * общей пользы (plus.ts → benefitAt) и не в тот же заход. Сам момент наружу не
 * отдаём, только «была ли польза»: клиент запоминает ответ на старте захода.
 * plusGift — «Вдвоём+» оплатил партнёр: один раз показать это и второму (Home.tsx).
 */
function plusMoment(me: UserRow, pairId: number, partner: UserRow | null | undefined) {
  if (!env.plusOn) return { benefit: false, offerStarted: false, plusGift: null };
  const offerStarted = !!get<{ offer_until: string | null }>("SELECT offer_until FROM pairs WHERE id = ?", pairId)?.offer_until;
  let plusGift: { id: string; from: string } | null = null;
  if (partner && plusOf(pairId).active) {
    const last = get<{ id: string; user_id: number }>(
      "SELECT id, user_id FROM payments WHERE pair_id = ? AND status = 'succeeded' AND paid_at > datetime('now', '-14 days') ORDER BY paid_at DESC, rowid DESC LIMIT 1",
      pairId,
    );
    if (last && last.user_id === partner.id) plusGift = { id: last.id, from: displayName(partner) };
  }
  return { benefit: !!benefitAt(pairId), offerStarted, plusGift };
}
