// Данные админки (28.09.2026): новые люди, кто что делает, подозрительная
// активность, блокировка. Отдаётся и в приложение владельцу (/api/admin), и боту
// «Ассистент» (/admin по ключу). Содержимое пар (тексты, фото, письма) сюда не
// попадает — только имена, даты и виды действий из журнала activity.
import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { all, get, run, tx } from "./db.ts";
import { env } from "./env.ts";
import { displayName, type UserRow } from "./model.ts";
import { FEEDBACK_KINDS, type FeedbackRow } from "./feedback.ts";
import { spentThisMonth } from "./scheduleAi.ts";
import { FOREVER } from "./plus.ts";
import { addDays, today } from "./time.ts";
import { changed } from "./realtime.ts";

export const isAdmin = (u: { id: number }) => env.adminIds.includes(u.id);

/** Человеческое название действия по методу и маршруту. Чего нет в списке — «добавление: /cards». */
const LABELS: Record<string, string> = {
  JOIN: "🆕 первый вход",
  "POST /pair/join": "🔗 вошёл в пару по приглашению",
  "POST /pair/leave": "💔 вышел из пары",
  "POST /pair": "💞 дата «вместе с»",
  "POST /pair/partner": "👻 внёс половинку заранее",
  "DELETE /me": "🗑 удалил аккаунт",
  "POST /me": "⚙️ настройки профиля",
  "POST /mood": "😊 настроение",
  "POST /ping": "💭 «скучаю»",
  "POST /swipe": "👆 свайп",
  "POST /swipe/undo": "↩️ отмена свайпа",
  "POST /movies": "🎬 свой фильм",
  "POST /movies/invite": "🍿 позвал смотреть",
  "POST /ideas": "💡 своё место или идея",
  "POST /daily": "💬 ответ на вопрос дня",
  "POST /daily/react": "❤️ реакция на ответ",
  "POST /daily/comment": "💬 ответ на ответ",
  "POST /tests/:id": "🧪 тест",
  "POST /tests/:id/round": "🧪 новый раунд теста",
  "POST /tests/:id/finish": "🧪 тест",
  "POST /tests/:id/nudge": "🧪 «Напомнить» про тест",
  "POST /tests/:id/talked": "🧪 «обсудили»",
  "POST /tests/:id/act": "🧪 действие из теста",
  "POST /wishes": "🎁 хотелка",
  "POST /wardrobe": "👕 вещь в гардероб",
  "POST /looks": "👗 лук",
  "POST /goals": "🎯 цель",
  "POST /goals/:id/marks": "✔️ отметка в цели",
  "POST /capsules": "⏳ капсула времени",
  "POST /notes": "📝 записка",
  "POST /events": "📅 событие",
  "POST /events/:id/rsvp": "📅 ответ на приглашение",
  "POST /tasks": "✅ дело",
  "POST /plans": "🗺 план",
  "POST /votes": "🗳 голосование",
  "POST /cards": "💌 открытка",
  "POST /schedule": "🗓 пара в расписание",
  "POST /schedule/import": "🗓 импорт расписания",
  "POST /schedule/rea": "🗓 расписание РЭУ",
  "POST /feedback": "📝 отзыв",
  "POST /plus/checkout": "💳 открыл оплату",
  OPEN: "📱 открытие приложения",
  PAIR: "💞 пара сложилась",
};

/** Разделы «Вдвоём+» по-русски — для замков в журнале и воронке. */
export const FEATURE_LABELS: Record<string, string> = {
  films: "свои фильмы",
  capsules: "капсулы",
  goals: "цели",
  wardrobe: "гардероб",
  tests: "тесты",
  rounds: "новые раунды",
  cheat: "шпаргалка",
};
const FROM_LABELS: Record<string, string> = {
  lock: "из замка",
  menu: "из меню",
  home: "с главной",
  promo: "показ при входе",
  link: "по ссылке",
  other: "",
};
const GIFT_LABELS: Record<string, string> = { month: "на месяц", year: "на год", forever: "навсегда", date: "до даты" };

export function label(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const [kind, arg = ""] = action.split(":");
  if (kind === "LOCK") return `🔒 упор в замок: ${FEATURE_LABELS[arg] ?? arg}`;
  if (kind === "LOCK_VIEW") return `🔒 шторка замка: ${FEATURE_LABELS[arg] ?? arg}`;
  if (kind === "PLUS_VIEW") return `💎 экран «Вдвоём+»${FROM_LABELS[arg] ? ` ${FROM_LABELS[arg]}` : ""}`;
  if (kind === "GIFT_PLUS") return `🎁 выдан «Вдвоём+» ${GIFT_LABELS[arg] ?? arg}`;
  const [method, route] = action.split(" ");
  const verb = { POST: "добавление", PATCH: "правка", DELETE: "удаление" }[method] ?? method;
  return `${verb}: ${route ?? ""}`;
}

/** Порог подозрительного: столько действий за час или столько загрузок файлов за час. */
export const ALERT_ACTIONS_PER_HOUR = 200;
export const ALERT_UPLOADS_PER_HOUR = 30;
const UPLOADS = ["POST /wardrobe", "POST /feedback", "POST /ideas"];

const nameOf = (u: UserRow | undefined, id: number) => (u ? displayName(u) : id === 0 ? "Ассистент" : `id ${id}`);

export function overview() {
  const n = (sql: string, ...p: (string | number)[]) => get<{ n: number }>(sql, ...p)?.n ?? 0;
  return {
    users: n("SELECT COUNT(*) n FROM users WHERE id > 0"),
    new24h: n("SELECT COUNT(*) n FROM users WHERE id > 0 AND created_at > datetime('now', '-1 day')"),
    new7d: n("SELECT COUNT(*) n FROM users WHERE id > 0 AND created_at > datetime('now', '-7 day')"),
    pairs: n("SELECT COUNT(*) n FROM (SELECT pair_id FROM users WHERE id > 0 AND pair_id IS NOT NULL GROUP BY pair_id HAVING COUNT(*) >= 2)"),
    active24h: n("SELECT COUNT(*) n FROM users WHERE id > 0 AND seen_at > datetime('now', '-1 day')"),
    actions24h: n("SELECT COUNT(*) n FROM activity WHERE at > datetime('now', '-1 day')"),
    feedbackNew: n("SELECT COUNT(*) n FROM feedback WHERE done_at IS NULL"),
    blocked: n("SELECT COUNT(*) n FROM users WHERE blocked_at IS NOT NULL"),
    // Расходы на ИИ за месяц и потолок — «про бабки не забывать»
    aiRub: Math.round(spentThisMonth()),
    aiLimitRub: env.aiMonthLimitRub,
    aiCalls: n("SELECT COUNT(*) n FROM ai_usage WHERE at >= datetime('now', 'start of month')"),
    alerts: alerts(),
  };
}

/** Люди от новых к старым: с кем в паре, когда заходили, сколько действий за сутки. */
export function users(since?: string) {
  const rows = all<UserRow & { actions: number; source: string | null }>(
    `SELECT u.*, (SELECT COUNT(*) FROM activity a WHERE a.user_id = u.id AND a.at > datetime('now', '-1 day')) AS actions
     FROM users u WHERE u.id > 0 ${since ? "AND u.created_at > ?" : ""} ORDER BY u.created_at DESC LIMIT 200`,
    ...(since ? [since] : []),
  );
  return rows.map((u) => {
    const partner = u.pair_id ? get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ? ORDER BY id > 0 DESC LIMIT 1", u.pair_id, u.id) : undefined;
    return {
      id: u.id,
      name: displayName(u),
      username: u.username,
      createdAt: u.created_at,
      seenAt: u.seen_at ?? null,
      onboarded: !!u.onboarded,
      partner: partner ? { id: partner.id, name: displayName(partner), ghost: partner.id <= 0 } : null,
      actions24h: u.actions,
      blocked: !!u.blocked_at,
      source: u.source ?? null,
      pairId: u.pair_id,
    };
  });
}

/** Карточка человека: что делал за неделю по видам, последние действия, его отзывы. */
export function userCard(id: number) {
  const u = get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  if (!u) return null;
  const base = users().find((x) => x.id === id) ?? null;
  const byKind = all<{ action: string; n: number }>(
    "SELECT action, COUNT(*) n FROM activity WHERE user_id = ? AND at > datetime('now', '-7 day') GROUP BY action ORDER BY n DESC LIMIT 12",
    id,
  ).map((r) => ({ label: label(r.action), n: r.n }));
  const recent = all<{ action: string; at: string }>("SELECT action, at FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 40", id).map((r) => ({
    label: label(r.action),
    at: r.at,
  }));
  const fb = all<FeedbackRow>("SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 10", id).map((f) => ({
    id: f.id,
    kind: FEEDBACK_KINDS[f.kind] ?? f.kind,
    text: f.text,
    at: f.created_at,
  }));
  return { ...base, byKind, recent, feedback: fb, pair: u.pair_id ? pairInfo(u.pair_id) : null };
}

/** Лента: последние действия всех людей. */
export function feed(limit = 60) {
  const people = new Map<number, UserRow | undefined>();
  return all<{ user_id: number; action: string; at: string }>("SELECT user_id, action, at FROM activity ORDER BY id DESC LIMIT ?", limit).map((r) => {
    if (!people.has(r.user_id)) people.set(r.user_id, get<UserRow>("SELECT * FROM users WHERE id = ?", r.user_id));
    return { userId: r.user_id, name: nameOf(people.get(r.user_id), r.user_id), label: label(r.action), at: r.at };
  });
}

/** Подозрительное за последний час: слишком много действий или загрузок файлов. */
export function alerts() {
  const q = (where: string, limit: number, why: (n: number) => string) =>
    all<{ user_id: number; n: number }>(
      `SELECT user_id, COUNT(*) n FROM activity WHERE at > datetime('now', '-1 hour') ${where} GROUP BY user_id HAVING n >= ?`,
      limit,
    ).map((r) => {
      const u = get<UserRow>("SELECT * FROM users WHERE id = ?", r.user_id);
      return { userId: r.user_id, name: nameOf(u, r.user_id), username: u?.username ?? null, why: why(r.n), blocked: !!u?.blocked_at };
    });
  return [
    ...q("", ALERT_ACTIONS_PER_HOUR, (n) => `${n} действий за час`),
    ...q(`AND action IN (${UPLOADS.map((a) => `'${a}'`).join(", ")})`, ALERT_UPLOADS_PER_HOUR, (n) => `${n} загрузок файлов за час`),
  ];
}

export function setBlocked(id: number, blocked: boolean): void {
  run("UPDATE users SET blocked_at = ? WHERE id = ?", blocked ? new Date().toISOString() : null, id);
}

/** Запись в журнал: только вид действия, без содержимого. */
export function track(userId: number, pairId: number | null, action: string): void {
  run("INSERT INTO activity (user_id, pair_id, action) VALUES (?, ?, ?)", userId, pairId, action);
}

// ——— пара: «Вдвоём+» и подарки ———

interface PairFull {
  id: number;
  source: string | null;
  created_at: string;
  paired_at: string | null;
  plus_until: string | null;
}

/** Пара в карточке человека: с какого дня вдвоём, откуда, «Вдвоём+» и оплаты (без сумм чужих тарифов, только факты). */
export function pairInfo(pairId: number) {
  const p = get<PairFull>("SELECT id, source, created_at, paired_at, plus_until FROM pairs WHERE id = ?", pairId);
  if (!p) return null;
  const members = all<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id > 0 ORDER BY created_at, id", pairId);
  const payments = all<{ plan: string; amount: number; method: string; paid_at: string | null; created_at: string }>(
    "SELECT plan, amount, method, paid_at, created_at FROM payments WHERE pair_id = ? AND status = 'succeeded' ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 10",
    pairId,
  );
  return {
    id: p.id,
    source: p.source,
    sourceLabel: p.source ? sourceLabel(p.source) : null,
    createdAt: p.created_at,
    pairedAt: p.paired_at,
    members: members.map((m) => ({ id: m.id, name: displayName(m) })),
    plusUntil: p.plus_until,
    plusActive: !!p.plus_until && p.plus_until >= today(),
    forever: p.plus_until === FOREVER,
    payments: payments.map((x) => ({ plan: x.plan, amount: x.amount, method: x.method, at: x.paid_at ?? x.created_at })),
  };
}

export const GIFT_TERMS = ["month", "year", "forever", "date"] as const;
export type GiftTerm = (typeof GIFT_TERMS)[number];
const GIFT_DAYS: Record<string, number> = { month: 30, year: 365 };

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

/**
 * «Вдвоём+» в подарок от владельца (блогеру, тестировщику, в извинение за сбой).
 * Месяц и год прибавляются к уже оплаченному сроку, «навсегда» — FOREVER, «до даты» —
 * ровно до неё (если уже открыто дольше — 409). В payments строка method='gift',
 * amount=0: видно, кому и когда выдано (акт, ЕРИР). В журнал — GIFT_PLUS:<срок> от
 * того, кто выдал (0 — «Ассистент» по ключу).
 */
export function grantPlus(pairId: number, term: GiftTerm, byId: number, until?: string | null): { until: string; forever: boolean } {
  if (!(GIFT_TERMS as readonly string[]).includes(term)) fail(400, "Срок: month, year, forever или date");
  const p = get<PairFull>("SELECT id, plus_until FROM pairs WHERE id = ?", pairId);
  if (!p) fail(404, "Нет такой пары");
  const member = get<{ id: number }>("SELECT id FROM users WHERE pair_id = ? AND id > 0 ORDER BY created_at, id LIMIT 1", pairId);
  if (!member) fail(404, "В паре никого нет");
  const cur = p!.plus_until;
  if (cur === FOREVER) fail(409, "У пары уже «Вдвоём+» навсегда");
  let next: string;
  if (term === "forever") next = FOREVER;
  else if (term === "date") {
    if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until))) fail(400, "Дата в формате ГГГГ-ММ-ДД");
    if (until! < today()) fail(400, "Дата уже прошла");
    if (cur && cur >= until!) fail(409, `Уже открыто до ${cur}`);
    next = until!;
  } else next = addDays(cur && cur > today() ? cur : today(), GIFT_DAYS[term]);
  tx(() => {
    run("UPDATE pairs SET plus_until = ? WHERE id = ?", next, pairId);
    run(
      "INSERT INTO payments (id, pair_id, user_id, plan, amount, status, method, paid_at) VALUES (?, ?, ?, ?, 0, 'succeeded', 'gift', datetime('now'))",
      `gift-${randomUUID()}`, pairId, member!.id, term,
    );
    track(byId, pairId, `GIFT_PLUS:${term}`);
  });
  changed(pairId, "pair");
  return { until: next, forever: next === FOREVER };
}

// ——— блогеры и источники ———

export interface PartnerRow {
  code: string;
  name: string;
  platform: string | null;
  url: string | null;
  note: string | null;
  created_at: string;
}

/** Код блогера: то, что после b_. Вместе с приставкой не длиннее 32 символов, как любая метка. */
export const PARTNER_CODE = /^[a-z0-9_-]{2,30}$/;

export const partnerList = () => all<PartnerRow>("SELECT * FROM partners ORDER BY created_at DESC, code");

/** Название источника: имя блогера для b_<код>, иначе сама метка. */
export function sourceLabel(source: string): string {
  if (source.startsWith("b_")) {
    const p = get<{ name: string }>("SELECT name FROM partners WHERE code = ?", source.slice(2));
    if (p) return p.name;
  }
  return source;
}

const clip = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Завести или поправить блогера. code при правке — из адреса, в теле не меняется. */
export function savePartner(b: Record<string, unknown>, code?: string): PartnerRow {
  const key = (code ?? String(b.code ?? "")).trim().toLowerCase().replace(/^b_/, "");
  if (!PARTNER_CODE.test(key)) fail(400, "Код: латиница, цифры, _ и -, от 2 до 30 символов");
  const name = clip(b.name, 80);
  if (!name) fail(400, "Нужно имя");
  const url = clip(b.url, 300);
  if (url && !/^https?:\/\//.test(url)) fail(400, "Ссылка должна начинаться с https://");
  if (code) {
    if (!get("SELECT 1 FROM partners WHERE code = ?", key)) fail(404, "Нет такого блогера");
    run("UPDATE partners SET name = ?, platform = ?, url = ?, note = ? WHERE code = ?", name, clip(b.platform, 40), url, clip(b.note, 500), key);
  } else {
    if (get("SELECT 1 FROM partners WHERE code = ?", key)) fail(409, "Такой код уже есть");
    run("INSERT INTO partners (code, name, platform, url, note) VALUES (?, ?, ?, ?, ?)", key, name, clip(b.platform, 40), url, clip(b.note, 500));
  }
  return get<PartnerRow>("SELECT * FROM partners WHERE code = ?", key)!;
}

/** Убрать блогера из справочника. Метки у людей остаются: воронка покажет их кодом. */
export function deletePartner(code: string): boolean {
  return run("DELETE FROM partners WHERE code = ?", code).changes > 0;
}

// ——— воронка ———

export const FUNNEL_DEFINITION =
  "Старт — человек впервые нажал «Старт» в боте или открыл приложение. Пара сложилась — в пространстве двое настоящих людей. " +
  "Жива на 7-й (14-й) день — оба заходили в приложение через 7 (14) суток после того, как пара сложилась, или позже; считаются только пары, которым уже 7 (14) дней. " +
  "Замок — сервер ответил «это во „Вдвоём+“» или показал шторку замка. «Вдвоём+» — открыт экран «Вдвоём+». Оплата начата — счёт выставлен. Оплатили — платёж прошёл, подарки не считаются. " +
  "Люди — по дню первого входа, пары — по дню, когда завели пространство; источник пары — у пригласившего, а если у него пусто, у второго.";

export interface FunnelRow {
  key: string;
  label: string;
  starts: number;
  pairs: number;
  d7: number;
  d7of: number;
  d14: number;
  d14of: number;
  lock: number;
  plusView: number;
  checkout: number;
  paid: number;
  rub: number;
  stars: number;
}

const emptyRow = (key: string, label: string): FunnelRow => ({ key, label, starts: 0, pairs: 0, d7: 0, d7of: 0, d14: 0, d14of: 0, lock: 0, plusView: 0, checkout: 0, paid: 0, rub: 0, stars: 0 });

/** SQLite хранит время в UTC «YYYY-MM-DD HH:MM:SS». */
const sqlMs = (s: string) => Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
const toSql = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const MSK = 3 * 3_600_000;
const DAY = 86_400_000;
/** Понедельник недели (по Москве) для времени из базы. */
export function weekOf(sqlTime: string): string {
  const d = new Date(sqlMs(sqlTime) + MSK);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export function weekLabel(monday: string): string {
  const a = new Date(monday + "T00:00:00Z");
  const b = new Date(a.getTime() + 6 * DAY);
  const m = (d: Date) => MONTHS[d.getUTCMonth()];
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${m(b)}` : `${a.getUTCDate()} ${m(a)} – ${b.getUTCDate()} ${m(b)}`;
}

/**
 * Воронка за период [from; to] (даты по Москве, включительно): по источникам, по
 * неделям прихода и итого. source — только этот источник ('' — без метки).
 * Никаких ответов: только журнал входов, замков, экранов
 * «Вдвоём+» и оплаты.
 */
export function funnel(opts: { from: string; to: string; source?: string | null; now?: number }) {
  const now = opts.now ?? Date.now();
  const fromSql = toSql(Date.parse(`${opts.from}T00:00:00Z`) - MSK);
  const toSqlEnd = toSql(Date.parse(`${opts.to}T00:00:00Z`) - MSK + DAY);
  const want = (src: string | null) => opts.source === undefined || opts.source === null || (src ?? "") === opts.source;

  const people = all<{ id: number; source: string | null; created_at: string }>(
    "SELECT id, source, created_at FROM users WHERE id > 0 AND created_at >= ? AND created_at < ?",
    fromSql, toSqlEnd,
  ).filter((u) => want(u.source));
  const pairs = all<{ id: number; source: string | null; created_at: string; paired_at: string }>(
    "SELECT id, source, created_at, paired_at FROM pairs WHERE paired_at IS NOT NULL AND created_at >= ? AND created_at < ?",
    fromSql, toSqlEnd,
  ).filter((p) => want(p.source));

  const ids = pairs.map((p) => p.id);
  const inList = ids.length ? ids.join(",") : "NULL";
  const seen = new Map<number, (string | null)[]>();
  for (const m of all<{ pair_id: number; seen_at: string | null }>(`SELECT pair_id, seen_at FROM users WHERE id > 0 AND pair_id IN (${inList})`)) {
    seen.set(m.pair_id, [...(seen.get(m.pair_id) ?? []), m.seen_at]);
  }
  const flags = new Map<number, { lock: number; plusView: number; checkout: number }>();
  for (const f of all<{ pair_id: number; lock: number; plusView: number; checkout: number }>(
    `SELECT u.pair_id,
       MAX(a.action LIKE 'LOCK:%' OR a.action LIKE 'LOCK_VIEW:%') AS lock,
       MAX(a.action LIKE 'PLUS_VIEW:%') AS plusView,
       MAX(a.action = 'POST /plus/checkout') AS checkout
     FROM activity a JOIN users u ON u.id = a.user_id
     WHERE u.id > 0 AND u.pair_id IN (${inList})
       AND (a.action LIKE 'LOCK%' OR a.action LIKE 'PLUS_VIEW:%' OR a.action = 'POST /plus/checkout')
     GROUP BY u.pair_id`,
  )) flags.set(f.pair_id, f);
  // Счёт выставлен — тоже «оплата начата»: журнал живёт 90 дней, payments — всегда
  const billed = new Set(all<{ pair_id: number }>(`SELECT DISTINCT pair_id FROM payments WHERE method != 'gift' AND pair_id IN (${inList})`).map((r) => r.pair_id));
  const money = new Map<number, { rub: number; stars: number }>();
  for (const m of all<{ pair_id: number; rub: number; stars: number }>(
    `SELECT pair_id, SUM(CASE WHEN method = 'stars' THEN 0 ELSE amount END) AS rub, SUM(CASE WHEN method = 'stars' THEN amount ELSE 0 END) AS stars
     FROM payments WHERE status = 'succeeded' AND method != 'gift' AND pair_id IN (${inList}) GROUP BY pair_id`,
  )) money.set(m.pair_id, m);

  const bySource = new Map<string, FunnelRow>();
  const byWeek = new Map<string, FunnelRow>();
  const total = emptyRow("all", "Всего");
  const rowsFor = (src: string | null, at: string): FunnelRow[] => {
    const s = src ?? "";
    if (!bySource.has(s)) bySource.set(s, emptyRow(s, s ? sourceLabel(s) : "без метки"));
    const w = weekOf(at);
    if (!byWeek.has(w)) byWeek.set(w, emptyRow(w, weekLabel(w)));
    return [bySource.get(s)!, byWeek.get(w)!, total];
  };

  for (const u of people) for (const r of rowsFor(u.source, u.created_at)) r.starts++;
  for (const p of pairs) {
    const both = seen.get(p.id) ?? [];
    const alive = (days: number) => both.length >= 2 && both.every((t) => !!t && sqlMs(t) >= sqlMs(p.paired_at) + days * DAY);
    const old = (days: number) => sqlMs(p.paired_at) + days * DAY <= now;
    const f = flags.get(p.id);
    const m = money.get(p.id);
    for (const r of rowsFor(p.source, p.created_at)) {
      r.pairs++;
      if (old(7)) {
        r.d7of++;
        if (alive(7)) r.d7++;
      }
      if (old(14)) {
        r.d14of++;
        if (alive(14)) r.d14++;
      }
      if (f?.lock) r.lock++;
      if (f?.plusView) r.plusView++;
      if (f?.checkout || billed.has(p.id)) r.checkout++;
      if (m) {
        r.paid++;
        r.rub += m.rub;
        r.stars += m.stars;
      }
    }
  }
  return {
    from: opts.from,
    to: opts.to,
    source: opts.source ?? null,
    definition: FUNNEL_DEFINITION,
    total,
    bySource: [...bySource.values()].sort((a, b) => b.starts - a.starts || b.pairs - a.pairs || a.label.localeCompare(b.label)),
    cohorts: [...byWeek.values()].sort((a, b) => b.key.localeCompare(a.key)),
    // Для выбора источника в когортах: все метки, что встречались, и все блогеры из справочника
    sources: [
      ...new Set([
        ...partnerList().map((p) => `b_${p.code}`),
        ...all<{ source: string }>("SELECT DISTINCT source FROM users WHERE source IS NOT NULL").map((r) => r.source),
      ]),
    ].map((s) => ({ key: s, label: sourceLabel(s) })),
  };
}
