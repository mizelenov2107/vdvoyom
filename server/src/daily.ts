import { all, get, run } from "./db.ts";
import { questions } from "./content.ts";
import type { UserRow } from "./model.ts";

/**
 * Вопрос на дату. Выбирается один раз и запоминается, чтобы у обоих был
 * один и тот же вопрос. Порядок у каждой пары свой, повторов нет, пока
 * банк не пройден целиком.
 */
export function questionFor(pairId: number, date: string): { id: number; text: string; category: string } | null {
  const bank = questions();
  if (!bank.length) return null;
  const saved = get<{ question_id: number }>("SELECT question_id FROM daily WHERE pair_id = ? AND date = ?", pairId, date);
  if (saved) return bank.find((q) => q.id === saved.question_id) ?? null;

  const used = new Set(all<{ question_id: number }>("SELECT question_id FROM daily WHERE pair_id = ?", pairId).map((r) => r.question_id));
  let pool = bank.filter((q) => !used.has(q.id));
  if (!pool.length) pool = bank;
  // Детерминированный выбор от пары и даты: два одновременных запроса выберут одно и то же
  const seed = hash(`${pairId}:${date}`);
  const q = pool[seed % pool.length];
  run("INSERT OR IGNORE INTO daily (pair_id, date, question_id) VALUES (?, ?, ?)", pairId, date, q.id);
  const final = get<{ question_id: number }>("SELECT question_id FROM daily WHERE pair_id = ? AND date = ?", pairId, date)!;
  return bank.find((x) => x.id === final.question_id) ?? q;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Реакции на ответ половинки: короткий набор, как в мессенджерах. */
export const DAILY_REACTIONS = ["❤️", "😂", "🥺", "😮", "🔥", "🤔", "👍"] as const;

/** Оба ответили — тогда открываются реакции и переписка под ответами. */
export function bothAnswered(pairId: number, date: string): boolean {
  return (get<{ n: number }>("SELECT COUNT(*) n FROM daily_answers WHERE pair_id = ? AND date = ?", pairId, date)?.n ?? 0) >= 2;
}

/** Ответ половинки виден, только когда ответил сам: подсмотреть не выйдет. */
export function dailyState(me: UserRow, partner: UserRow | undefined, date: string, create = true) {
  const pairId = me.pair_id!;
  const q = create ? questionFor(pairId, date) : questionFor(pairId, date);
  if (!q) return null;
  const answers = all<{ user_id: number; text: string }>(
    "SELECT user_id, text FROM daily_answers WHERE pair_id = ? AND date = ?",
    pairId,
    date,
  );
  const mine = answers.find((a) => a.user_id === me.id)?.text ?? null;
  const theirs = partner ? answers.find((a) => a.user_id === partner.id)?.text ?? null : null;
  const open = mine !== null && theirs !== null;
  const reactions = open
    ? all<{ user_id: number; emoji: string }>("SELECT user_id, emoji FROM daily_reactions WHERE pair_id = ? AND date = ?", pairId, date)
    : [];
  return {
    date,
    question: q,
    mine,
    partnerAnswered: theirs !== null,
    partner: mine !== null ? theirs : null,
    // mine — моя реакция на ответ половинки, theirs — её реакция на мой
    reactions: {
      mine: reactions.find((r) => r.user_id === me.id)?.emoji ?? null,
      theirs: partner ? reactions.find((r) => r.user_id === partner.id)?.emoji ?? null : null,
    },
    comments: open
      ? all<{ id: number; user_id: number; text: string; created_at: string }>(
          "SELECT id, user_id, text, created_at FROM daily_comments WHERE pair_id = ? AND date = ? ORDER BY id",
          pairId,
          date,
        ).map((c) => ({ id: c.id, mine: c.user_id === me.id, text: c.text, at: c.created_at }))
      : [],
  };
}
