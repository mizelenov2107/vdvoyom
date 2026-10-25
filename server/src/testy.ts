// Тесты на совместимость, формат 2 (08.10.2026).
//
// Как устроено:
//  • у теста пул вопросов (40–60), пара проходит раунды по perRound вопросов,
//    которых ещё не видела; пул кончился — по второму кругу с самых давних;
//  • на одном экране ответ про себя и догадка про партнёра; назад и пропуск
//    (не больше двух за раунд); каждый ответ сразу пишется черновиком на сервер;
//  • раунд закрывается, когда закончили оба, и только тогда открываются ответы
//    партнёра; закрытый раунд не переписывается, новый раунд — новые строки;
//  • результат: совпали / знали, что разные / сюрпризы, к расхождениям —
//    вопросы для разговора и одна кнопка действия (дело, событие, хотелка…);
//  • бот пишет о тестах не чаще раза в сутки одному человеку, отдельно
//    выключается в настройках («tests» в NOTIFY), напоминает один раз через 48 часов.
import { all, get, run, tx } from "./db.ts";
import { tests, type DateIdea, type Test, type TestQuestion } from "./content.ts";
import { displayName, hides, mutes, type UserRow } from "./model.ts";
import { esc, sendTo } from "./bot.ts";
import { isOnline } from "./realtime.ts";
import { addDays, today, weekdayOf } from "./time.ts";
import { paywalled, testLocked } from "./limits.ts";
import { isBeta, isBetaPair } from "./beta.ts";

export const NONE = "none"; // «Ни один не подходит» — есть у каждого вопроса
export const ANY = "any"; // «Всё равно» в «Идеальном свидании»
export const MAX_SKIPS = 2;
export const DEFAULT_ABOUT = "А что выберет {name}?";

export interface RoundRow {
  pair_id: number;
  test_id: string;
  round: number;
  question_ids: string;
  again: number;
  opened_at: string;
  closed_at: string | null;
  reminded_at: string | null;
}

export interface AnswerRow {
  pair_id: number;
  test_id: string;
  round: number;
  user_id: number;
  answers: string;
  pos: number;
  finished_at: string | null;
  nudged_at: string | null;
}

export interface Answer {
  self?: string;
  guess?: string;
  skip?: boolean;
}
export type Answers = Record<string, Answer>;

/** same — совпали; known — разные, и оба это знали; surprise — разные, кто-то не угадал; own — у кого-то «Ни один не подходит»; diff — разные (в «это или то»); skip — пропуск */
export type Outcome = "same" | "known" | "surprise" | "own" | "diff" | "skip";

export function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseAnswers(json: string | null | undefined): Answers {
  try {
    const v = JSON.parse(json ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Answers) : {};
  } catch {
    return {};
  }
}

/** Тесты, которые человек видит. */
export function visibleTests(_u: UserRow): Test[] {
  return tests();
}

export function testFor(u: UserRow, id: string): Test | undefined {
  return visibleTests(u).find((t) => t.id === id);
}

export function latestRound(pairId: number, testId: string): RoundRow | undefined {
  return get<RoundRow>("SELECT * FROM test_rounds WHERE pair_id = ? AND test_id = ? ORDER BY round DESC LIMIT 1", pairId, testId);
}

export function roundRow(pairId: number, testId: string, n: number): RoundRow | undefined {
  return get<RoundRow>("SELECT * FROM test_rounds WHERE pair_id = ? AND test_id = ? AND round = ?", pairId, testId, n);
}

export function answerRow(pairId: number, testId: string, n: number, userId: number): AnswerRow | undefined {
  return get<AnswerRow>("SELECT * FROM test_round_answers WHERE pair_id = ? AND test_id = ? AND round = ? AND user_id = ?", pairId, testId, n, userId);
}

/** Вопросы раунда. Вопрос, которого больше нет в пуле, просто пропадает — старые строки не роняют экран. */
export function questionsOf(test: Test, r: RoundRow): TestQuestion[] {
  const byId = new Map(test.pool.map((q) => [q.id, q]));
  return parseList(r.question_ids).map((id) => byId.get(id)).filter((q): q is TestQuestion => !!q);
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Сколько вопросов пула пара ещё не видела. */
export function unseenCount(pairId: number, test: Test): number {
  const seen = new Set(all<{ question_ids: string }>("SELECT question_ids FROM test_rounds WHERE pair_id = ? AND test_id = ?", pairId, test.id).flatMap((r) => parseList(r.question_ids)));
  return test.pool.filter((q) => !seen.has(q.id)).length;
}

/**
 * Открытый раунд пары или новый. Новый — только когда прошлый закрыт: пока
 * кто-то не закончил, оба отвечают на одни и те же вопросы.
 */
export function openRound(pairId: number, test: Test): RoundRow {
  return tx(() => {
    const last = latestRound(pairId, test.id);
    if (last && !last.closed_at) return last;
    const rounds = all<{ question_ids: string }>("SELECT question_ids FROM test_rounds WHERE pair_id = ? AND test_id = ? ORDER BY round", pairId, test.id);
    const seen = new Set(rounds.flatMap((r) => parseList(r.question_ids)));
    const n = Math.min(test.perRound, test.pool.length);
    let pick = shuffle(test.pool.filter((q) => !seen.has(q.id)).map((q) => q.id)).slice(0, n);
    let again = 0;
    if (pick.length < n) {
      // Пул кончился: добираем самыми давними вопросами
      again = 1;
      const old: string[] = [];
      for (const r of rounds) for (const id of parseList(r.question_ids)) if (!old.includes(id) && !pick.includes(id) && test.pool.some((q) => q.id === id)) old.push(id);
      pick = [...pick, ...old.slice(0, n - pick.length)];
    }
    // Серьёзные вопросы не идут первыми: раунд разогревается лёгкими
    const weight = new Map(test.pool.map((q) => [q.id, q.weight ?? 1]));
    pick.sort((a, b) => (weight.get(a) ?? 1) - (weight.get(b) ?? 1));
    const round = (last?.round ?? 0) + 1;
    run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids, again) VALUES (?, ?, ?, ?, ?)", pairId, test.id, round, JSON.stringify(pick), again);
    return roundRow(pairId, test.id, round)!;
  });
}

/**
 * Новый раунд — во «Вдвоём+» (08.10.2026): бесплатно только первый раунд теста.
 * Открытый раунд (кто-то ещё не ответил) доступен всегда: закрывается только новое.
 */
export function nextRoundLocked(pairId: number, test: Test): boolean {
  const last = latestRound(pairId, test.id);
  return !!last?.closed_at && paywalled(pairId);
}

/** Варианты вопроса, как их видит человек: последним «Ни один не подходит» или «Всё равно». */
export function optionsOf(test: Test, q: TestQuestion): { id: string; text: string; tag?: string }[] {
  return [...q.options, test.kind === "either" ? { id: ANY, text: "Всё равно" } : { id: NONE, text: "Ни один не подходит" }];
}

/** Ответы из запроса, без лишнего: только вопросы раунда и существующие варианты. */
export function cleanAnswers(test: Test, qs: TestQuestion[], raw: unknown): Answers {
  const out: Answers = {};
  if (!raw || typeof raw !== "object") return out;
  for (const q of qs) {
    const a = (raw as Record<string, unknown>)[q.id];
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (o.skip === true) {
      out[q.id] = { skip: true };
      continue;
    }
    const ids = optionsOf(test, q).map((x) => x.id);
    if (typeof o.self !== "string" || !ids.includes(o.self)) continue;
    const ans: Answer = { self: o.self };
    if (test.kind === "guess" && typeof o.guess === "string" && ids.includes(o.guess)) ans.guess = o.guess;
    out[q.id] = ans;
  }
  return out;
}

export const skipsOf = (a: Answers) => Object.values(a).filter((x) => x.skip).length;
export const complete = (test: Test, a: Answer | undefined) => !!a && (!!a.skip || (!!a.self && (test.kind !== "guess" || !!a.guess)));

export interface Item {
  id: string;
  outcome: Outcome;
  mine: Answer;
  theirs: Answer;
}

export interface Summary {
  items: Item[];
  counts: { same: number; known: number; surprise: number; own: number; diff: number };
  /** Сколько угадал я, сколько угадали меня, из скольких */
  hits: { me: number; them: number; total: number };
}

/** Разбор раунда глазами mine. */
export function summarize(test: Test, qs: TestQuestion[], mine: Answers, theirs: Answers): Summary {
  const counts = { same: 0, known: 0, surprise: 0, own: 0, diff: 0 };
  const hits = { me: 0, them: 0, total: 0 };
  const items: Item[] = [];
  for (const q of qs) {
    const a = mine[q.id] ?? {};
    const b = theirs[q.id] ?? {};
    let outcome: Outcome;
    if (!a.self || !b.self || a.skip || b.skip) outcome = "skip";
    else if (test.kind === "either") outcome = a.self === b.self || a.self === ANY || b.self === ANY ? "same" : "diff";
    else {
      hits.total++;
      if (a.guess === b.self) hits.me++;
      if (b.guess === a.self) hits.them++;
      if (a.self === NONE || b.self === NONE) outcome = "own";
      else if (a.self === b.self) outcome = "same";
      else if (a.guess === b.self && b.guess === a.self) outcome = "known";
      else outcome = "surprise";
    }
    if (outcome !== "skip") counts[outcome]++;
    items.push({ id: q.id, outcome, mine: a, theirs: b });
  }
  return { items, counts, hits };
}

export interface Profile {
  axes: { axis: string; title: string; pole: string | null; label: string; split: boolean }[];
  ideas: DateIdea[];
}

/**
 * «Идеальное свидание»: совпадения и «всё равно» складываются в профиль — вдвоём
 * или с друзьями, дома или вне дома и т. д. — и по нему подбираются три идеи.
 */
export function dateProfile(test: Test, qs: TestQuestion[], a: Answers, b: Answers, seed = 0): Profile {
  const axes: Profile["axes"] = [];
  const lean = (ans: Answers, axis: string): string | null => {
    const tally = new Map<string, number>();
    for (const q of qs.filter((x) => x.axis === axis)) {
      const tag = q.options.find((o) => o.id === ans[q.id]?.self)?.tag;
      if (tag) tally.set(tag, (tally.get(tag) ?? 0) + 1);
    }
    const sorted = [...tally.entries()].sort((x, y) => y[1] - x[1]);
    if (!sorted.length || (sorted[1] && sorted[1][1] === sorted[0][1])) return null;
    return sorted[0][0];
  };
  for (const [axis, def] of Object.entries(test.axes ?? {})) {
    if (!qs.some((q) => q.axis === axis)) continue;
    const x = lean(a, axis);
    const y = lean(b, axis);
    const split = !!x && !!y && x !== y;
    const pole = split ? null : x ?? y;
    axes.push({ axis, title: def.title, pole, split, label: pole ? def.poles[pole] : split ? "по-разному" : "всё равно" });
  }
  const score = (i: DateIdea) => axes.reduce((s, ax) => s + (ax.pole ? (i.tags[ax.axis] === ax.pole ? 2 : i.tags[ax.axis] ? -1 : 0) : 0), 0);
  const ideas = (test.ideas ?? [])
    .map((i, k) => ({ i, s: score(i), k: (k * 7 + seed) % 31 }))
    .sort((x, y) => y.s - x.s || x.k - y.k)
    .slice(0, 3)
    .map((x) => x.i);
  return { axes, ideas };
}

// ——— бот: не чаще раза в сутки одному человеку ———

export type Sent = "sent" | "off" | "capped" | "online";

/**
 * Сообщение о тестах. Молчит, если человек выключил тесты или их уведомления;
 * второе сообщение за сутки не отправляется (лишние склеиваются в одно —
 * то, что пришло первым, всё равно ведёт в список тестов).
 */
export async function testMessage(to: UserRow, text: string, go: string, button: string, opts: { quietIfOnline?: boolean } = {}): Promise<Sent> {
  // Новые тесты пока только в бете (beta.ts): за пределами пары владельца бот о них не пишет
  if (to.id < 0 || !isBeta(to) || hides(to, "tests") || mutes(to, "tests")) return "off";
  if (opts.quietIfOnline && to.pair_id && isOnline(to.pair_id, to.id)) return "online";
  if (run("INSERT OR IGNORE INTO sent (key) VALUES (?)", `tests:${to.id}:${today()}`).changes === 0) return "capped";
  await sendTo(to.id, text, { text: button, go });
  return "sent";
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Первый закончил раунд — второму; молчит, если второй сейчас в приложении. */
export function waitingText(test: Test, from: UserRow): string {
  return `📝 <b>${esc(displayName(from))} ждёт тебя в тесте «${esc(test.title)}»</b>\n\nСвои ответы уже есть. Пройди тест, и откроются общие результаты 🔓`;
}

export function openedText(test: Test, s: Summary): string {
  const n = s.counts.surprise;
  const tail =
    test.kind === "either" ? "Там ваше свидание и три идеи, куда сходить 💫" :
    n ? `${n} ${plural(n, "сюрприз", "сюрприза", "сюрпризов")}: там можно узнать новое друг о друге` :
    "Сюрпризов нет: смотри, где вы совпали и где знали, что разные";
  return `✨ <b>Результаты «${esc(test.title)}» открылись</b>\n\n${tail}`;
}

/** Напоминание через 48 часов: один раз за раунд, если второй так и не прошёл. */
export async function remindStale(): Promise<void> {
  const rows = all<RoundRow & { done_id: number }>(
    `SELECT r.*, a.user_id AS done_id FROM test_rounds r
     JOIN test_round_answers a ON a.pair_id = r.pair_id AND a.test_id = r.test_id AND a.round = r.round
     WHERE r.closed_at IS NULL AND r.reminded_at IS NULL AND a.finished_at IS NOT NULL AND a.finished_at < datetime('now', '-48 hours')`,
  );
  for (const r of rows) {
    const test = tests().find((t) => t.id === r.test_id);
    const done = get<UserRow>("SELECT * FROM users WHERE id = ? AND pair_id = ?", r.done_id, r.pair_id);
    const other = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ? AND id > 0", r.pair_id, r.done_id);
    const mark = () => run("UPDATE test_rounds SET reminded_at = datetime('now') WHERE pair_id = ? AND test_id = ? AND round = ?", r.pair_id, r.test_id, r.round);
    // Не бета (beta.ts): новых тестов у пары нет — не напоминаем и раунд не трогаем
    if (!isBetaPair(r.pair_id)) continue;
    if (!test || !done || !other || answerRow(r.pair_id, r.test_id, r.round, other.id)?.finished_at) {
      mark();
      continue;
    }
    const text = `⏳ <b>${esc(displayName(done))} всё ещё ждёт тебя в тесте «${esc(test.title)}»</b>\n\nБольше напоминать не будем.`;
    const res = await testMessage(other, text, `test:${test.id}`, "Пройти");
    // Сегодня бот уже писал про тесты — попробуем завтра; выключено — больше не пытаемся
    if (res !== "capped") mark();
  }
}

/** Тест, где партнёр уже ответил и ждёт тебя, — для карточки на главной. */
export function waitingFor(u: UserRow, partner: UserRow | undefined): { id: string; title: string; emoji: string } | null {
  if (!u.pair_id || !partner || partner.id < 0 || hides(u, "tests")) return null;
  const rows = all<{ test_id: string }>(
    `SELECT r.test_id FROM test_rounds r
     JOIN test_round_answers p ON p.pair_id = r.pair_id AND p.test_id = r.test_id AND p.round = r.round AND p.user_id = ? AND p.finished_at IS NOT NULL
     LEFT JOIN test_round_answers m ON m.pair_id = r.pair_id AND m.test_id = r.test_id AND m.round = r.round AND m.user_id = ?
     WHERE r.pair_id = ? AND r.closed_at IS NULL AND m.finished_at IS NULL
     ORDER BY p.finished_at DESC`,
    partner.id, u.id, u.pair_id,
  );
  for (const r of rows) {
    const t = testFor(u, r.test_id);
    if (t && !testLocked(u.pair_id, t.id)) return { id: t.id, title: t.title, emoji: t.emoji };
  }
  return null;
}

/** Ближайшая суббота после сегодняшнего дня — дата свидания по умолчанию. */
export function nextSaturday(from = today()): string {
  const wd = weekdayOf(from);
  return addDays(from, (6 - wd + 7) % 7 || 7);
}

export interface CheatEntry {
  testId: string;
  test: string;
  emoji: string;
  questionId: string;
  question: string;
  answer: string;
  round: number;
  date: string;
}

/**
 * «Шпаргалка про партнёра»: ответы партнёра, которые не угаданы (и те, что
 * добавлены в неё вручную), из закрытых раундов. Свежий раунд важнее старого.
 */
export function cheatsheet(u: UserRow, partner: UserRow | undefined): CheatEntry[] {
  if (!u.pair_id || !partner) return [];
  const out = new Map<string, CheatEntry>();
  for (const test of visibleTests(u).filter((t) => t.cheat && t.kind === "guess")) {
    const rounds = all<RoundRow>("SELECT * FROM test_rounds WHERE pair_id = ? AND test_id = ? AND closed_at IS NOT NULL ORDER BY round", u.pair_id, test.id);
    for (const r of rounds) {
      const mine = parseAnswers(answerRow(u.pair_id, test.id, r.round, u.id)?.answers);
      const theirs = parseAnswers(answerRow(u.pair_id, test.id, r.round, partner.id)?.answers);
      const pinned = new Set(all<{ question_id: string }>("SELECT question_id FROM test_marks WHERE pair_id = ? AND test_id = ? AND round = ? AND kind = 'cheat' AND user_id = ?", u.pair_id, test.id, r.round, u.id).map((m) => m.question_id));
      for (const q of questionsOf(test, r)) {
        const b = theirs[q.id];
        if (!b?.self || b.skip || b.self === NONE) continue;
        const miss = mine[q.id]?.guess !== b.self;
        if (!miss && !pinned.has(q.id)) continue;
        const answer = q.options.find((o) => o.id === b.self)?.text;
        if (!answer) continue;
        out.set(`${test.id}:${q.id}`, { testId: test.id, test: test.title, emoji: test.emoji, questionId: q.id, question: q.self, answer, round: r.round, date: (r.closed_at ?? r.opened_at).slice(0, 10) });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
}
