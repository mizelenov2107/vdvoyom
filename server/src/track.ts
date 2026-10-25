// Вход в API (28.09.2026): блокировка, «был в сети» и журнал действий для админки.
// С 11.10.2026 здесь же события воронки: OPEN, LOCK:<feature>, источник прихода
// и ручка POST /api/track для событий, которые видит только клиент (показ экрана
// «Вдвоём+» и шторки замка). Всё пишется в тот же activity, без содержимого.
import type { Context, Next } from "hono";
import { launchFromHeader, upsertUser } from "./auth.ts";
import { get, run } from "./db.ts";
import { bad, router, type AppEnv } from "./http.ts";
import type { UserRow } from "./model.ts";
import { track } from "./adminData.ts";

/** Не пишем в журнал: присутствие шлётся каждые полминуты и засорило бы ленту. */
const QUIET = new Set([
  "POST /presence",
  "POST /plus/check",
  "DELETE /me", // удаление аккаунта стирает и журнал
  "PUT /tests/:id/draft", // черновик теста — после каждого ответа
  "POST /track", // события клиента пишутся своими именами, см. trackRoute
]);

/** Закрытые разделы «Вдвоём+» (limits.ts, Feature). */
export const FEATURES = ["films", "capsules", "goals", "wardrobe", "tests", "rounds", "cheat"] as const;
const featureOf = (v: unknown): string | null =>
  typeof v === "string" && (FEATURES as readonly string[]).includes(v) ? v : null;

/** Шаблон маршрута без /api: «/wardrobe», «/goals/:id». */
export function routeOf(c: Context): string | null {
  const route = [...c.req.matchedRoutes].reverse().find((r) => r.method !== "ALL")?.path;
  return route ? route.replace(/^\/api(?=\/)/, "") : null;
}

/** Метод и шаблон маршрута без /api: «POST /wardrobe», «DELETE /goals/:id». */
export function actionOf(c: Context): string | null {
  if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return null;
  const route = routeOf(c);
  if (!route) return null;
  const action = `${c.req.method} ${route}`;
  return QUIET.has(action) ? null : action;
}

const ageMs = (sqlTime: string) => Date.now() - Date.parse(sqlTime.replace(" ", "T") + "Z");

/** Отметка «был в сети» не чаще раза в 5 минут: запросов много, писать в базу на каждый незачем. */
export function markSeen(u: UserRow): void {
  if (u.seen_at && ageMs(u.seen_at) < 5 * 60_000) return;
  run("UPDATE users SET seen_at = datetime('now') WHERE id = ?", u.id);
}

/**
 * Открытие приложения (для «жива ли пара»): первый запрос после получаса тишины.
 * Пока приложение открыто, присутствие шлётся каждые полминуты и seen_at свежее
 * пяти минут, поэтому одна долгая сессия — одно OPEN, а не по штуке на запрос.
 * Вызывать до markSeen.
 */
export const OPEN_GAP_MIN = 30;
export function markOpen(u: UserRow): void {
  if (u.seen_at && ageMs(u.seen_at) < OPEN_GAP_MIN * 60_000) return;
  track(u.id, u.pair_id, "OPEN");
}

/** Первый вход — отдельное событие: админка показывает, кто пришёл. */
export const isNewUser = (id: number) => !get("SELECT 1 FROM users WHERE id = ?", id);

/**
 * Метка источника из start_param или /start: только латиница, цифры, _ и -, до 32
 * символов. pair_… (приглашение), plus (возврат из оплаты) и paysupport — не источники.
 */
export function normSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.startsWith("pair_") || s === "plus" || s === "paysupport") return null;
  const clean = s.replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  // Пустая метка блогера («b_» и одна буква) — не источник
  if (clean.length < 2 || (clean.startsWith("b_") && clean.length < 4)) return null;
  return clean;
}

/** Записать источник новому человеку. Уже заданный не трогаем: считаем первое касание. */
export function setSource(userId: number, raw: string | null | undefined): string | null {
  const src = normSource(raw);
  if (!src) return null;
  run("UPDATE users SET source = ? WHERE id = ? AND source IS NULL", src, userId);
  // Пространство могло уже появиться: у пары тоже пусто — заполним
  run("UPDATE pairs SET source = ? WHERE id = (SELECT pair_id FROM users WHERE id = ?) AND source IS NULL", src, userId);
  return src;
}

/**
 * Журнал после ответа. Успешные изменения — методом и маршрутом; упор в замок
 * «Вдвоём+» (402) — LOCK:<feature>. Остальные ошибки не пишем.
 */
export async function trackRequest(c: Context, u: UserRow): Promise<void> {
  if (c.res.status === 402) {
    let feature: string | null = null;
    try {
      feature = featureOf(((await c.res.clone().json()) as { plus?: unknown }).plus);
    } catch {
      /* не JSON — не замок */
    }
    if (feature) track(u.id, u.pair_id, `LOCK:${feature}`);
    return;
  }
  if (c.res.status >= 400) return;
  const action = actionOf(c);
  if (action) track(u.id, u.pair_id, action);
}

/** Вход в /api: подпись телеграма, блокировка, «был в сети», журнал действий. */
export async function apiGate(c: Context<AppEnv>, next: Next) {
  const launch = launchFromHeader(c.req.header("authorization"));
  if (!launch) return c.json({ error: "Открой приложение из телеграма" }, 401);
  const fresh = isNewUser(launch.user.id);
  let u = upsertUser(launch.user);
  if (fresh) {
    track(u.id, u.pair_id, "JOIN");
    if (setSource(u.id, launch.startParam)) u = get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
  }
  // Заблокированному владельцем — ни чтения, ни записи
  if (u.blocked_at) return c.json({ error: "Доступ к «Вдвоём» закрыт" }, 403);
  markOpen(u);
  markSeen(u);
  c.set("user", u);
  c.set("startParam", launch.startParam);
  await next();
  await trackRequest(c, u);
}

// ——— события клиента ———

/**
 * Что клиент может прислать в POST /api/track. Только то, чего сервер сам не видит:
 * открытие экрана «Вдвоём+» и показ шторки замка. Остальное сервер пишет сам:
 * OPEN, PAIR, LOCK:<feature>, POST /plus/checkout; оплаты лежат в payments.
 */
export const PLUS_FROM = ["lock", "menu", "home", "promo", "link", "other"] as const;
export const CLIENT_EVENTS = ["plus_view", "lock_view"] as const;

/** Имя события и свойства → строка журнала. Чужое имя или раздел — 400. */
export function clientAction(name: unknown, props: unknown): string {
  const p = (props && typeof props === "object" ? props : {}) as Record<string, unknown>;
  if (name === "plus_view") {
    const from = (PLUS_FROM as readonly string[]).includes(p.from as string) ? (p.from as string) : "other";
    return `PLUS_VIEW:${from}`;
  }
  if (name === "lock_view") {
    const feature = featureOf(p.feature);
    if (!feature) bad("Неизвестный раздел");
    return `LOCK_VIEW:${feature}`;
  }
  bad("Неизвестное событие");
}

/** Одинаковое событие от человека — не чаще раза в минуту, событий клиента — не больше 120 в час. */
const CLIENT_DEDUP_SEC = 60;
const CLIENT_PER_HOUR = 120;

export const trackRoute = router();
trackRoute.post("/track", async (c) => {
  const u = c.get("user");
  const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; props?: unknown };
  const action = clientAction(b.name, b.props);
  const dup = get("SELECT 1 FROM activity WHERE user_id = ? AND action = ? AND at > datetime('now', ?)", u.id, action, `-${CLIENT_DEDUP_SEC} seconds`);
  const many = get<{ n: number }>(
    "SELECT COUNT(*) n FROM activity WHERE user_id = ? AND at > datetime('now', '-1 hour') AND (action LIKE 'PLUS_VIEW:%' OR action LIKE 'LOCK_VIEW:%')",
    u.id,
  )!.n;
  if (!dup && many < CLIENT_PER_HOUR) track(u.id, u.pair_id, action);
  return c.json({ ok: true });
});
