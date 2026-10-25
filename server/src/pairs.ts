import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, get, run, tx } from "./db.ts";
import { env } from "./env.ts";
import type { PairRow, UserRow } from "./model.ts";
import { track } from "./adminData.ts";

function newCode(): string {
  // Без похожих символов: код иногда диктуют голосом
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Пространство создаётся сразу: приложением можно пользоваться одному, пока половинка не пришла. */
export function ensurePair(userId: number): PairRow {
  return tx(() => {
    const u = get<UserRow>("SELECT * FROM users WHERE id = ?", userId)!;
    if (u.pair_id) return get<PairRow>("SELECT * FROM pairs WHERE id = ?", u.pair_id)!;
    // Источник пары — источник того, кто её завёл (позже его может дополнить второй, см. joinPair)
    const { id } = run("INSERT INTO pairs (invite_code, source) VALUES (?, ?)", newCode(), (u as UserRow & { source?: string | null }).source ?? null);
    // pair_id пишем только если он всё ещё пуст: два параллельных запроса
    // не должны завести две пары одному человеку.
    run("UPDATE users SET pair_id = ? WHERE id = ? AND pair_id IS NULL", id, userId);
    const fresh = get<UserRow>("SELECT * FROM users WHERE id = ?", userId)!;
    return get<PairRow>("SELECT * FROM pairs WHERE id = ?", fresh.pair_id)!;
  });
}

/**
 * Половинка «заранее»: запись с отрицательным id, чтобы до её прихода
 * уже были её расписание, окна и лайки. Когда она заходит по приглашению,
 * всё это переезжает к настоящему аккаунту (adoptGhost), а заготовка удаляется.
 */
export function ghostOf(pairId: number): UserRow | undefined {
  return get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id < 0", pairId);
}

export function createGhost(pairId: number, f: { name: string; color?: string; birthday?: string | null }): UserRow {
  const id = -pairId;
  run(
    `INSERT INTO users (id, first_name, name, color, birthday, pair_id, onboarded, chat_ok) VALUES (?, ?, ?, ?, ?, ?, 1, 0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, first_name = excluded.first_name, color = excluded.color,
       birthday = COALESCE(excluded.birthday, users.birthday)`,
    id, f.name, f.name, f.color ?? "rose", f.birthday ?? null, pairId,
  );
  return get<UserRow>("SELECT * FROM users WHERE id = ?", id)!;
}

function adoptGhost(pairId: number, realId: number): void {
  const g = ghostOf(pairId);
  if (!g) return;
  const real = get<UserRow>("SELECT * FROM users WHERE id = ?", realId)!;
  const hasOwnSchedule = get<{ n: number }>("SELECT COUNT(*) AS n FROM schedule WHERE user_id = ?", realId)!.n > 0;
  if (hasOwnSchedule) run("DELETE FROM schedule WHERE user_id = ?", g.id);
  else run("UPDATE schedule SET user_id = ? WHERE user_id = ?", realId, g.id);
  run("UPDATE OR IGNORE swipes SET user_id = ? WHERE user_id = ?", realId, g.id);
  run("DELETE FROM swipes WHERE user_id = ?", g.id);
  run("UPDATE OR IGNORE movie_prefs SET user_id = ? WHERE user_id = ?", realId, g.id);
  run("DELETE FROM movie_prefs WHERE user_id = ?", g.id);
  for (const [table, col] of [
    ["events", "author_id"], ["tasks", "author_id"], ["tasks", "assignee_id"], ["tasks", "done_by"], ["wishes", "owner_id"],
    ["wishes", "reserved_by"], ["plans", "author_id"], ["plan_entries", "user_id"], ["cards", "author_id"], ["goals", "author_id"],
    ["goal_marks", "user_id"], ["goal_steps", "done_by"], ["ideas", "author_id"], ["wardrobe", "owner_id"], ["saved", "added_by"],
  ]) {
    run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, realId, g.id);
  }
  // Имя, цвет и день рождения из заготовки берём, только если она их ещё не задала сама
  run(
    `UPDATE users SET
       name = CASE WHEN onboarded = 1 AND name IS NOT NULL THEN name ELSE ? END,
       color = CASE WHEN onboarded = 1 THEN color ELSE ? END,
       birthday = COALESCE(birthday, ?),
       rea_group = COALESCE(rea_group, ?), rea_synced_at = COALESCE(rea_synced_at, ?),
       gap_min = CASE WHEN onboarded = 1 THEN gap_min ELSE ? END
     WHERE id = ?`,
    g.name, g.color, g.birthday, g.rea_group, g.rea_synced_at, g.gap_min, realId,
  );
  void real;
  run("DELETE FROM users WHERE id = ?", g.id);
}

/** Стереть пространство пары целиком: все общие записи, заготовку половинки и фото. */
export function wipePair(pairId: number): void {
  // moments — старый альбом (убран 08.10.2026): до разовой чистки 15.10 в cron.ts
  // там ещё лежат фото, и удалённое пространство должно уйти вместе с ними
  const files = all<{ file: string }>(
    "SELECT file FROM moments WHERE pair_id = ? UNION ALL SELECT file FROM wardrobe WHERE pair_id = ? UNION ALL SELECT photo AS file FROM ideas WHERE pair_id = ? AND photo IS NOT NULL",
    pairId, pairId, pairId,
  );
  for (const m of files) fs.rmSync(path.join(env.photosDir, m.file), { force: true });
  run("DELETE FROM plan_entries WHERE plan_id IN (SELECT id FROM plans WHERE pair_id = ?)", pairId);
  run("DELETE FROM vote_answers WHERE vote_id IN (SELECT id FROM votes WHERE pair_id = ?)", pairId);
  run("DELETE FROM goal_marks WHERE goal_id IN (SELECT id FROM goals WHERE pair_id = ?)", pairId);
  run("DELETE FROM goal_steps WHERE goal_id IN (SELECT id FROM goals WHERE pair_id = ?)", pairId);
  for (const t of ["events", "tasks", "wishes", "plans", "cards", "votes", "capsules", "notes", "ideas", "swipes", "matches", "daily", "daily_answers", "test_answers", "test_rounds", "test_round_answers", "test_marks", "pings", "goals", "moments", "wardrobe", "looks", "saved"]) {
    run(`DELETE FROM ${t} WHERE pair_id = ?`, pairId);
  }
  const ghost = ghostOf(pairId);
  if (ghost) {
    run("DELETE FROM schedule WHERE user_id = ?", ghost.id);
    run("DELETE FROM users WHERE id = ?", ghost.id);
  }
  run("UPDATE users SET pair_id = NULL WHERE pair_id = ?", pairId);
  run("DELETE FROM pairs WHERE id = ?", pairId);
}

/** Цвет, которым перекрашиваем совпавшего партнёра: розовый, а к розовому — фиолетовый. */
export const otherColor = (c: string) => (c === "rose" ? "violet" : "rose");

/**
 * Оба в паре одного цвета — тот, кто цвет не выбирал (color_chosen = 0), получает
 * другой. Сначала второй (пришедший по приглашению), если же он цвет выбрал сам, —
 * пригласивший. Выбрали оба — не трогаем: это их решение (11.10.2026).
 */
export function differentColors(inviterId: number, joinerId: number): void {
  type C = { id: number; color: string; color_chosen: number };
  const inviter = get<C>("SELECT id, color, color_chosen FROM users WHERE id = ?", inviterId);
  const joiner = get<C>("SELECT id, color, color_chosen FROM users WHERE id = ?", joinerId);
  if (!inviter || !joiner || inviter.color !== joiner.color) return;
  const who = joiner.color_chosen !== 1 ? joiner : inviter.color_chosen !== 1 ? inviter : null;
  if (who) run("UPDATE users SET color = ?, color_chosen = 2 WHERE id = ?", otherColor(who.color), who.id);
}

export function partnerOf(u: UserRow): UserRow | undefined {
  if (!u.pair_id) return undefined;
  return get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ?", u.pair_id, u.id);
}

/**
 * Вход по приглашению. Если у пришедшего уже было своё пространство и в нём
 * он один, его записи переезжают в пару пригласившего — ничего не теряется.
 */
export function joinPair(userId: number, code: string): { ok: boolean; error?: string; partner?: UserRow; already?: boolean } {
  return tx(() => {
    const pair = get<PairRow>("SELECT * FROM pairs WHERE invite_code = ?", code.trim().toLowerCase());
    if (!pair) return { ok: false, error: "Приглашение не нашлось. Попроси прислать ссылку ещё раз." };
    // Заготовка половинки место не занимает: она и есть это место
    const members = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE pair_id = ? AND id > 0", pair.id)!.n;
    const me = get<UserRow>("SELECT * FROM users WHERE id = ?", userId)!;
    if (me.pair_id === pair.id) {
      const partner = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ? AND id > 0", pair.id, userId);
      return { ok: !!partner, partner, already: true, error: partner ? undefined : "Это твоя собственная ссылка — отправь её половинке." };
    }
    if (members >= 2) return { ok: false, error: "В этом пространстве уже двое." };

    if (me.pair_id) {
      const mine = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE pair_id = ? AND id > 0", me.pair_id)!.n;
      if (mine >= 2) return { ok: false, error: "Ты уже в паре. Сначала выйди из неё в настройках." };
      const old = me.pair_id;
      for (const table of ["events", "tasks", "wishes", "plans", "cards", "votes", "capsules", "notes", "ideas"]) {
        run(`UPDATE ${table} SET pair_id = ? WHERE pair_id = ?`, pair.id, old);
      }
      run("UPDATE OR IGNORE swipes SET pair_id = ? WHERE pair_id = ?", pair.id, old);
      run("DELETE FROM swipes WHERE pair_id = ?", old);
      run("DELETE FROM matches WHERE pair_id = ?", old);
      run("DELETE FROM daily WHERE pair_id = ?", old);
      run("DELETE FROM daily_answers WHERE pair_id = ?", old);
      run("DELETE FROM test_answers WHERE pair_id = ?", old);
      for (const t of ["test_rounds", "test_round_answers", "test_marks"]) run(`DELETE FROM ${t} WHERE pair_id = ?`, old);
      run("UPDATE users SET pair_id = NULL WHERE id = ?", userId);
      run("DELETE FROM users WHERE pair_id = ? AND id < 0", old);
      run("DELETE FROM pairs WHERE id = ?", old);
    }
    run("UPDATE users SET pair_id = ? WHERE id = ?", pair.id, userId);
    adoptGhost(pair.id, userId);
    const partner = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ?", pair.id, userId);
    if (partner && partner.id > 0) {
      differentColors(partner.id, userId);
      // Пара сложилась: от этого дня считаются «живы на 7-й и 14-й день». Источник —
      // у пригласившего, а если у него пусто, у второго (11.10.2026)
      run(
        "UPDATE pairs SET paired_at = datetime('now'), source = COALESCE(source, (SELECT source FROM users WHERE id = ?), (SELECT source FROM users WHERE id = ?)) WHERE id = ?",
        partner.id, userId, pair.id,
      );
      track(userId, pair.id, "PAIR");
    }
    return { ok: true, partner: partner && get<UserRow>("SELECT * FROM users WHERE id = ?", partner.id) };
  });
}
