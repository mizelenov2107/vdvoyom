// Бета новых тестов (08.10.2026, этап 4): тесты формата 2 и «Шпаргалка»
// видны только паре владельца. Остальные пары живут со старыми
// семью тестами (routes/fun.ts, tests-v1.json, экран TestsV1.tsx), как до 08.10.
//
// Пара в бете, если хотя бы один из двоих в env.adminIds (ADMIN_IDS, иначе
// SUPPORT_CHAT_ID — это владелец). Открыть всем — одна правка: TESTY_V2=all в
// окружении сервера или `all: true` ниже.
import type { Context, Next } from "hono";
import { all } from "./db.ts";
import { env } from "./env.ts";
import type { UserRow } from "./model.ts";

export const BETA = {
  /** true — новые тесты у всех пар, старые больше никому не показываются */
  all: process.env.TESTY_V2 === "all",
};

/** Пара в бете: в ней есть кто-то из env.adminIds. */
export function isBetaPair(pairId: number | null | undefined): boolean {
  if (BETA.all) return true;
  if (!pairId || !env.adminIds.length) return false;
  return all<{ id: number }>("SELECT id FROM users WHERE pair_id = ?", pairId).some((m) => env.adminIds.includes(m.id));
}

/** Человек видит новые тесты: он сам владелец или в паре с ним. */
export function isBeta(u: Pick<UserRow, "id" | "pair_id">): boolean {
  if (BETA.all || env.adminIds.includes(u.id)) return true;
  return isBetaPair(u.pair_id);
}

/**
 * Маршрут только для беты. Остальным — обычный 404, как у несуществующего адреса:
 * по ответу не видно, что такой раздел вообще есть.
 */
export async function betaOnly(c: Context, next: Next) {
  const u = c.get("user") as UserRow | undefined;
  if (!u || !isBeta(u)) return c.notFound();
  await next();
}
