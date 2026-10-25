import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PairRow, UserRow } from "./model.ts";

export type AppEnv = { Variables: { user: UserRow; startParam: string | null } };

/** Ошибка, которую поймал onError, — по запросу: alarmOn5xx (alarm.ts) назовёт её владельцу. */
export const failures = new WeakMap<Request, unknown>();

/** Ответ на ошибку для всего сервера (index.ts). Вынесено сюда, чтобы тесты шли через тот же код. */
export function onError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    // «Это во «Вдвоём+»»: клиент по коду plus показывает шторку с ценой
    const m = /^PLUS:(\w+):(.*)$/s.exec(err.message);
    if (m) return c.json({ error: m[2], plus: m[1] }, 402);
    return c.json({ error: err.message }, err.status);
  }
  if (err instanceof SyntaxError) return c.json({ error: "Битый JSON" }, 400);
  console.error(err);
  // Саму ошибку — владельцу: alarmOn5xx возьмёт её отсюда, когда увидит ответ 500
  failures.set(c.req.raw, err);
  return c.json({ error: "Что-то сломалось на сервере" }, 500);
}

export function router() {
  return new Hono<AppEnv>();
}

export function bad(message: string, status: 400 | 403 | 404 | 409 | 429 = 400): never {
  throw new HTTPException(status, { message });
}

/** Пара того, кто спрашивает. Без пары большинство разделов бессмысленны. */
export function needPair(u: UserRow): number {
  if (!u.pair_id) bad("Нет пространства пары", 409);
  return u.pair_id!;
}

// ——— проверка входных данных ———

export function str(v: unknown, max = 500, required = true): string {
  if (typeof v !== "string" || !v.trim()) {
    if (required) bad("Пустое поле");
    return "";
  }
  return v.trim().slice(0, max);
}

export function optStr(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function int(v: unknown, min = -1e12, max = 1e12): number {
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "")) : Number(v);
  if (!Number.isFinite(n)) bad("Ожидалось число");
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function optInt(v: unknown, min?: number, max?: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  return int(v, min, max);
}

export function date(v: unknown, required = true): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  if (required) bad("Дата в формате ГГГГ-ММ-ДД");
  return "";
}

export function optDate(v: unknown): string | null {
  return v ? date(v) : null;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], fallback?: T): T {
  if (list.includes(v as T)) return v as T;
  if (fallback !== undefined) return fallback;
  bad(`Ожидалось одно из: ${list.join(", ")}`);
}

export type { PairRow };
