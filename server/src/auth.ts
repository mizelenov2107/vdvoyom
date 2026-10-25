import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.ts";
import { get, run } from "./db.ts";
import type { UserRow } from "./model.ts";

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
}

export interface Launch {
  user: TgUser;
  startParam: string | null;
}

/**
 * Проверка initData по документации телеграма: ключ — HMAC-SHA256 от токена
 * бота с ключом "WebAppData", подпись — HMAC от отсортированных пар key=value.
 * Подделать её без токена нельзя, поэтому личность берём только отсюда.
 */
export function verifyInitData(raw: string, botToken: string, ttlSec: number, now = Date.now()): Launch | null {
  if (!raw || !botToken) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || now / 1000 - authDate > ttlSec) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    if (!user?.id) return null;
    return { user, startParam: params.get("start_param") };
  } catch {
    return null;
  }
}

/**
 * Разбор заголовка Authorization: `tma <initData>` или, в разработке,
 * `dev <id>:<имя>[:<start_param>]` — части по отдельности через encodeURIComponent.
 */
export function launchFromHeader(header: string | undefined | null): Launch | null {
  if (!header) return null;
  const space = header.indexOf(" ");
  const scheme = header.slice(0, space);
  const value = header.slice(space + 1);
  if (scheme === "tma") return verifyInitData(value, env.botToken, env.initDataTtlSec);
  if (scheme === "dev" && env.devAuth) {
    let parts: string[];
    try {
      parts = value.split(":").map(decodeURIComponent);
    } catch {
      return null;
    }
    const [id, name, start] = parts;
    if (!Number(id)) return null;
    return { user: { id: Number(id), first_name: name || `Тест ${id}` }, startParam: start || null };
  }
  return null;
}

/**
 * Заводит пользователя при первом входе и обновляет имя и фото из телеграма.
 * Новому — violet и color_chosen = 0 («не выбирал»): если он придёт по приглашению к
 * фиолетовому, joinPair (pairs.ts) перекрасит его в розовый, пока он не выбрал сам.
 */
export function upsertUser(u: TgUser): UserRow {
  run(
    `INSERT INTO users (id, first_name, username, photo_url, color) VALUES (?, ?, ?, ?, 'violet')
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name,
       username = excluded.username, photo_url = COALESCE(excluded.photo_url, users.photo_url)`,
    u.id,
    u.first_name.slice(0, 64),
    u.username ?? null,
    u.photo_url ?? null,
  );
  return get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
}
