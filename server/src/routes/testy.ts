// Тесты на совместимость, формат 2 (08.10.2026): раунды, черновик, результат,
// «Обсудили», действия и «Шпаргалка». Логика — в ../testy.ts.
import { all, get, run, tx } from "../db.ts";
import { bad, int, needPair, router } from "../http.ts";
import { displayName, type UserRow } from "../model.ts";
import { partnerOf } from "../pairs.ts";
import { changed } from "../realtime.ts";
import { esc, inviteKeyboard, notifyPartner, sendRaw } from "../bot.ts";
import { FREE_CHEAT, FREE_TESTS, needPlus, paywalled, testLocked } from "../limits.ts";
import { addDays, dayMonth, today } from "../time.ts";
import { cardPhoto } from "../cardPhoto.ts";
import { findItem } from "./fun.ts";
import { betaOnly } from "../beta.ts";
import { tests, type Test, type TestQuestion } from "../content.ts";
import {
  answerRow, cheatsheet, cleanAnswers, complete, dateProfile, DEFAULT_ABOUT, latestRound, MAX_SKIPS, nextRoundLocked, nextSaturday, NONE, openedText,
  openRound, optionsOf, parseAnswers, plural, questionsOf, roundRow, skipsOf, summarize, testFor, testMessage, unseenCount, visibleTests,
  waitingText, type Answers, type RoundRow,
} from "../testy.ts";

export const testy = router();

// Бета (08.10.2026, этап 4): новые тесты и «Шпаргалка» — только паре владельца, остальным
// 404 как у несуществующего адреса. GET /tests и /tests/:id не беты отвечает routes/fun.ts
// (старые тесты) раньше, чем доходит сюда.
for (const p of ["/tests", "/tests/*", "/cheatsheet"]) testy.use(p, betaOnly);

function testOf(u: UserRow, id: string): Test {
  const t = testFor(u, id);
  if (!t) bad("Этого теста больше нет", 404);
  if (testLocked(u.pair_id!, t!.id)) needPlus(u.pair_id!, "tests");
  return t!;
}

/** Состояние теста для списка: что показать на карточке. */
function stateOf(pairId: number, test: Test, u: UserRow, partner: UserRow | undefined) {
  const r = latestRound(pairId, test.id);
  if (!r) return { state: "new" as const, round: 0 };
  const mine = answerRow(pairId, test.id, r.round, u.id);
  const theirs = partner ? answerRow(pairId, test.id, r.round, partner.id) : undefined;
  if (r.closed_at) return { state: "done" as const, round: r.round };
  if (mine?.finished_at) return { state: "waiting" as const, round: r.round };
  if (theirs?.finished_at) return { state: "partner" as const, round: r.round };
  const answered = Object.keys(parseAnswers(mine?.answers)).length;
  return answered ? { state: "draft" as const, round: r.round, answered } : { state: "new" as const, round: r.round };
}

testy.get("/tests", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const partner = partnerOf(u);
  return c.json({
    tests: visibleTests(u).map((t) => ({
      id: t.id,
      title: t.title,
      emoji: t.emoji,
      blurb: t.blurb,
      kind: t.kind,
      minutes: t.minutes,
      count: t.perRound,
      locked: testLocked(pairId, t.id),
      ...stateOf(pairId, t, u, partner),
    })),
    cheat: cheatsheet(u, partner).length,
  });
});

/** Текст действия для кнопки: подставлены ответы и имя партнёра. Нечего подставить — действия нет. */
function actOf(q: TestQuestion, test: Test, mine: Answers, theirs: Answers, partnerName: string) {
  const act = q.act;
  if (!act) return null;
  const text = (id: string | undefined) => (id && id !== NONE && id !== "any" ? q.options.find((o) => o.id === id)?.text : undefined);
  const m = text(mine[q.id]?.self);
  const t = text(theirs[q.id]?.self);
  let title = act.title ?? "";
  if (title.includes("{mine}")) {
    if (!m) return null;
    title = title.replaceAll("{mine}", m);
  }
  if (title.includes("{theirs}")) {
    if (!t) return null;
    title = title.replaceAll("{theirs}", t);
  }
  title = title.replaceAll("{name}", partnerName).trim();
  if (act.type === "cheat" && (!t || test.kind !== "guess")) return null;
  return { type: act.type, title, list: act.list ?? null, days: act.days ?? null, price: act.price ?? null, target: act.target ?? null };
}

/** Ответ партнёра не угадан — он попадает в шпаргалку сам (так же считает cheatsheet в testy.ts). */
function cheatMiss(mine: Answers, theirs: Answers, qid: string): boolean {
  const b = theirs[qid];
  return !!b?.self && !b.skip && b.self !== NONE && mine[qid]?.guess !== b.self;
}

/** Раунд глазами человека: вопросы, свои ответы, а ответы партнёра — только когда закончили оба. */
function roundView(u: UserRow, partner: UserRow | undefined, test: Test, r: RoundRow) {
  const pairId = u.pair_id!;
  const qs = questionsOf(test, r);
  const mineRow = answerRow(pairId, test.id, r.round, u.id);
  const theirRow = partner ? answerRow(pairId, test.id, r.round, partner.id) : undefined;
  const mine = parseAnswers(mineRow?.answers);
  const closed = !!r.closed_at;
  const theirs = closed ? parseAnswers(theirRow?.answers) : null;
  const name = partner ? displayName(partner) : "половинка";
  const marks = closed ? all<{ question_id: string; kind: string; user_id: number; ref: string | null }>("SELECT question_id, kind, user_id, ref FROM test_marks WHERE pair_id = ? AND test_id = ? AND round = ?", pairId, test.id, r.round) : [];
  const summary = closed && theirs ? summarize(test, qs, mine, theirs) : null;
  return {
    n: r.round,
    again: !!r.again,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    questions: qs.map((q) => ({
      id: q.id,
      self: q.self,
      about: (q.about ?? DEFAULT_ABOUT).replaceAll("{name}", name),
      options: optionsOf(test, q),
      talk: q.talk,
      weight: q.weight ?? 1,
      axis: q.axis ?? null,
      act: closed && theirs ? actOf(q, test, mine, theirs, name) : null,
    })),
    mine: { answers: mine, pos: mineRow?.pos ?? 0, finished: !!mineRow?.finished_at },
    partnerFinished: !!theirRow?.finished_at,
    partner: theirs,
    summary,
    profile: closed && theirs && test.kind === "either" ? dateProfile(test, qs, mine, theirs, pairId + r.round) : null,
    marks: {
      talked: [...new Set(marks.filter((m) => m.kind === "talked").map((m) => m.question_id))],
      acts: {
        // Промах уже лежит в шпаргалке сам: кнопка «Запомнить в шпаргалке» там ничего бы не добавила
        ...Object.fromEntries(theirs && test.cheat ? qs.filter((q) => q.act?.type === "cheat" && cheatMiss(mine, theirs, q.id)).map((q) => [q.id, "cheat"]) : []),
        ...Object.fromEntries(marks.filter((m) => m.kind === "act" && m.user_id === u.id).map((m) => [m.question_id, m.ref])),
      },
      cheat: marks.filter((m) => m.kind === "cheat" && m.user_id === u.id).map((m) => m.question_id),
    },
    canNudge: !!partner && partner.id > 0 && !!mineRow?.finished_at && !theirRow?.finished_at && !closed && (!mineRow?.nudged_at || Date.parse(mineRow.nudged_at.replace(" ", "T") + "Z") < Date.now() - 86_400_000),
  };
}

function testMeta(t: Test) {
  return { id: t.id, title: t.title, emoji: t.emoji, blurb: t.blurb, intro: t.intro ?? null, kind: t.kind, perRound: t.perRound, minutes: t.minutes, score: !!t.score, cheat: !!t.cheat, axes: t.axes ?? null };
}

testy.get("/tests/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const partner = partnerOf(u);
  const r = latestRound(pairId, test.id);
  const history = all<RoundRow>("SELECT * FROM test_rounds WHERE pair_id = ? AND test_id = ? AND closed_at IS NOT NULL ORDER BY round DESC", pairId, test.id)
    .filter((h) => h.round !== r?.round)
    .map((h) => {
      const qs = questionsOf(test, h);
      const s = partner ? summarize(test, qs, parseAnswers(answerRow(pairId, test.id, h.round, u.id)?.answers), parseAnswers(answerRow(pairId, test.id, h.round, partner.id)?.answers)) : null;
      return { n: h.round, closedAt: h.closed_at, counts: s?.counts ?? null };
    });
  return c.json({ test: testMeta(test), round: r ? roundView(u, partner, test, r) : null, history, unseen: unseenCount(pairId, test), nextLocked: nextRoundLocked(pairId, test) });
});

testy.get("/tests/:id/rounds/:n", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const r = roundRow(pairId, test.id, Number(c.req.param("n")));
  if (!r) bad("Нет такого раунда", 404);
  return c.json({ test: testMeta(test), round: roundView(u, partnerOf(u), test, r!) });
});

/** Начать: открытый раунд пары или новый, если прошлый закрыт. */
testy.post("/tests/:id/round", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  // Бесплатно — первый раунд; новый после закрытого — во «Вдвоём+» (только при PLUS=1)
  if (nextRoundLocked(pairId, test)) needPlus(pairId, "rounds");
  const r = openRound(pairId, test);
  changed(pairId, "tests");
  return c.json({ round: r.round });
});

function openFor(u: UserRow, test: Test, n: unknown): RoundRow {
  const r = roundRow(u.pair_id!, test.id, int(n, 1, 100000));
  if (!r) bad("Нет такого раунда", 404);
  if (r!.closed_at || answerRow(u.pair_id!, test.id, r!.round, u.id)?.finished_at) bad("Ответы в этом раунде уже отправлены, их не поменять. Можно начать новый раунд", 409);
  return r!;
}

/** Черновик: каждый ответ сразу на сервере, выход из теста ничего не стирает. */
testy.put("/tests/:id/draft", async (c) => {
  const u = c.get("user");
  needPair(u);
  const test = testOf(u, c.req.param("id"));
  const b = await c.req.json<{ round: number; answers: unknown; pos?: number }>();
  const r = openFor(u, test, b.round);
  const qs = questionsOf(test, r);
  const answers = cleanAnswers(test, qs, b.answers);
  if (skipsOf(answers) > MAX_SKIPS) bad(`Пропустить можно не больше ${MAX_SKIPS} вопросов`);
  run(
    `INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET answers = excluded.answers, pos = excluded.pos, updated_at = datetime('now')`,
    u.pair_id, test.id, r.round, u.id, JSON.stringify(answers), int(b.pos ?? 0, 0, qs.length),
  );
  return c.json({ ok: true });
});

/** Отправить ответы. Сообщение партнёру уходит только теперь, а не во время прохождения. */
testy.post("/tests/:id/finish", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const b = await c.req.json<{ round: number; answers: unknown }>();
  const r = openFor(u, test, b.round);
  const qs = questionsOf(test, r);
  const answers = cleanAnswers(test, qs, b.answers);
  if (skipsOf(answers) > MAX_SKIPS) bad(`Пропустить можно не больше ${MAX_SKIPS} вопросов`);
  if (qs.some((q) => !complete(test, answers[q.id]))) bad("Ответь на все вопросы или пропусти их");
  const partner = partnerOf(u);
  const closed = tx(() => {
    run(
      `INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos, finished_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT DO UPDATE SET answers = excluded.answers, pos = excluded.pos, finished_at = excluded.finished_at, updated_at = datetime('now')`,
      pairId, test.id, r.round, u.id, JSON.stringify(answers), qs.length,
    );
    const both = !!partner && !!answerRow(pairId, test.id, r.round, partner.id)?.finished_at;
    if (both) run("UPDATE test_rounds SET closed_at = datetime('now') WHERE pair_id = ? AND test_id = ? AND round = ?", pairId, test.id, r.round);
    return both;
  });
  changed(pairId, "tests");
  if (partner && partner.id > 0) {
    if (closed) {
      // Второй закончил — первому: результаты открылись
      const s = summarize(test, qs, parseAnswers(answerRow(pairId, test.id, r.round, partner.id)?.answers), answers);
      // Человек сейчас в приложении — результат и так появится у него на экране
      void testMessage(partner, openedText(test, s), `test:${test.id}`, "Смотреть", { quietIfOnline: true });
    } else {
      void testMessage(partner, waitingText(test, u), `test:${test.id}`, "Пройти", { quietIfOnline: true });
    }
  }
  return c.json({ ok: true, closed });
});

/** «Напомнить» вручную: не чаще раза в сутки. */
testy.post("/tests/:id/nudge", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const r = latestRound(pairId, test.id);
  const partner = partnerOf(u);
  const mine = r ? answerRow(pairId, test.id, r.round, u.id) : undefined;
  if (!r || !partner || partner.id < 0 || !mine?.finished_at || r.closed_at) bad("Напоминать пока не о чем");
  if (mine!.nudged_at && Date.parse(mine!.nudged_at.replace(" ", "T") + "Z") > Date.now() - 86_400_000) bad("Напомнить можно раз в сутки", 429);
  run("UPDATE test_round_answers SET nudged_at = datetime('now') WHERE pair_id = ? AND test_id = ? AND round = ? AND user_id = ?", pairId, test.id, r!.round, u.id);
  const text = `👋 <b>${esc(displayName(u))} зовёт пройти тест «${esc(test.title)}»</b>\n\nСвои ответы уже есть, ждём твои 🔓`;
  const sent = await testMessage(partner!, text, `test:${test.id}`, "Пройти");
  changed(pairId, "tests");
  return c.json({ sent });
});

function closedFor(u: UserRow, test: Test, n: unknown): RoundRow {
  const r = roundRow(u.pair_id!, test.id, int(n, 1, 100000));
  if (!r || !r.closed_at) bad("Результат ещё не открыт", 409);
  return r!;
}

/** «Обсудили»: отметка общая, её видят оба. Повторное нажатие снимает. */
testy.post("/tests/:id/talked", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const b = await c.req.json<{ round: number; q: string; on?: boolean }>();
  const r = closedFor(u, test, b.round);
  if (!questionsOf(test, r).some((q) => q.id === b.q)) bad("Нет такого вопроса", 404);
  if (b.on === false) run("DELETE FROM test_marks WHERE pair_id = ? AND test_id = ? AND round = ? AND question_id = ? AND kind = 'talked'", pairId, test.id, r.round, b.q);
  else run("INSERT OR IGNORE INTO test_marks (pair_id, test_id, round, question_id, kind, user_id) VALUES (?, ?, ?, ?, 'talked', ?)", pairId, test.id, r.round, b.q, u.id);
  changed(pairId, "tests");
  return c.json({ ok: true });
});

/**
 * Кнопка действия под расхождением: создаёт дело, событие, хотелку, цель,
 * копилку, письмо в будущее или строку в заметке. Ничего не делается само —
 * только по нажатию; повторное нажатие не создаёт второй раз.
 * Для «Идеального свидания» body.idea — «Запланировать» идею из итога.
 */
testy.post("/tests/:id/act", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const test = testOf(u, c.req.param("id"));
  const b = await c.req.json<{ round: number; q?: string; idea?: string }>();
  const r = closedFor(u, test, b.round);
  const partner = partnerOf(u);
  const name = partner ? displayName(partner) : "половинка";
  const key = b.idea ? `idea:${b.idea}` : String(b.q ?? "");
  const done = get<{ ref: string }>("SELECT ref FROM test_marks WHERE pair_id = ? AND test_id = ? AND round = ? AND question_id = ? AND kind = 'act' AND user_id = ?", pairId, test.id, r.round, key, u.id);
  if (done) return c.json({ ref: done.ref, again: true });

  const remember = (ref: string) => run("INSERT OR IGNORE INTO test_marks (pair_id, test_id, round, question_id, kind, user_id, ref) VALUES (?, ?, ?, ?, 'act', ?, ?)", pairId, test.id, r.round, key, u.id, ref);
  const invite = (eventId: number, title: string, d: string, ideaItem?: string) => {
    if (!partner || partner.id < 0) return;
    const idea = ideaItem ? findItem("idea", pairId, ideaItem) : undefined;
    void sendRaw(partner.id, `💞 <b>${esc(displayName(u))} зовёт на свидание!</b>\n\n📍 <b>${esc(title)}</b>\n🗓 ${dayMonth(d)}\n\nОтветь кнопкой 👇`, inviteKeyboard(eventId), cardPhoto("idea", idea));
  };

  // «Запланировать» идею из итога «Идеального свидания»: свидание-приглашение на ближайшую субботу
  if (b.idea) {
    const idea = (test.ideas ?? []).find((i) => i.id === b.idea);
    if (!idea) bad("Нет такой идеи", 404);
    const d = nextSaturday();
    const { id } = run(
      "INSERT INTO events (pair_id, author_id, title, kind, date, status, idea_item) VALUES (?, ?, ?, 'date', ?, 'proposed', ?)",
      pairId, u.id, idea!.title, d, idea!.catalog ?? null,
    );
    remember(`event:${id}`);
    changed(pairId, "events");
    changed(pairId, "tests");
    invite(id, idea!.title, d, idea!.catalog);
    return c.json({ ref: `event:${id}` });
  }

  const q = questionsOf(test, r).find((x) => x.id === b.q);
  if (!q) bad("Нет такого вопроса", 404);
  const mine = parseAnswers(answerRow(pairId, test.id, r.round, u.id)?.answers);
  const theirs = partner ? parseAnswers(answerRow(pairId, test.id, r.round, partner.id)?.answers) : {};
  const act = actOf(q!, test, mine, theirs, name);
  if (!act) bad("Здесь нечего добавить");
  const title = act!.title.slice(0, 120);
  const textOf = (a: Answers) => {
    const id = a[q!.id]?.self;
    return optionsOf(test, q!).find((o) => o.id === id)?.text ?? "пропуск";
  };
  const line = `${q!.self} — ${displayName(u)}: ${textOf(mine)}; ${name}: ${textOf(theirs)}`;
  let ref = "";
  const rawAct = q!.act;

  if (act!.type === "task") {
    const due = act!.days ? addDays(today(), act!.days) : null;
    const assignee = rawAct.assignee === "me" ? u.id : null;
    const { id } = run(
      "INSERT INTO tasks (pair_id, author_id, title, due, assignee_id, taken_at, list) VALUES (?, ?, ?, ?, ?, ?, ?)",
      pairId, u.id, title, due, assignee, assignee ? new Date().toISOString() : null, act!.list,
    );
    ref = `task:${id}`;
    changed(pairId, "tasks");
  } else if (act!.type === "event") {
    const d = act!.days ? addDays(today(), act!.days) : nextSaturday();
    const { id } = run("INSERT INTO events (pair_id, author_id, title, kind, date, note) VALUES (?, ?, ?, 'event', ?, ?)", pairId, u.id, title, d, `Из теста «${test.title}»: ${q!.self}`);
    ref = `event:${id}`;
    changed(pairId, "events");
    void notifyPartner(u, `📅 <b>${esc(displayName(u))} добавляет в календарь</b>\n\n${esc(title)}\n🗓 ${dayMonth(d)}`, { button: { text: "Календарь", go: "calendar" }, quietIfOnline: true });
  } else if (act!.type === "wish") {
    const { id } = run("INSERT INTO wishes (pair_id, owner_id, title, price, level) VALUES (?, ?, ?, ?, 2)", pairId, u.id, title, act!.price);
    ref = `wish:${id}`;
    changed(pairId, "wishes");
    void notifyPartner(u, `🎁 <b>Новая хотелка: ${esc(displayName(u))}</b>\n\n${esc(title)}`, { button: { text: "Хотелки", go: "wishes" }, quietIfOnline: true });
  } else if (act!.type === "goal") {
    needPlus(pairId, "goals", get<{ n: number }>("SELECT COUNT(*) n FROM goals WHERE pair_id = ? AND archived_at IS NULL", pairId)!.n);
    const { id } = run(
      "INSERT INTO goals (pair_id, author_id, kind, title, emoji, target, unit) VALUES (?, ?, 'count', ?, ?, ?, ?)",
      pairId, u.id, title, rawAct.emoji ?? "🎯", Math.max(1, Math.round(act!.target ?? 1)), rawAct.unit ?? null,
    );
    ref = `goal:${id}`;
    changed(pairId, "goals");
    void notifyPartner(u, `🎯 ${esc(displayName(u))} ставит общую цель: <b>${esc(title)}</b>`, { button: { text: "Цели", go: "goals" }, quietIfOnline: true });
  } else if (act!.type === "plan") {
    const kinds = ["поездка", "покупка", "ремонт", "событие", "подарок", "другое"];
    const { id } = run(
      "INSERT INTO plans (pair_id, author_id, kind, title, target) VALUES (?, ?, ?, ?, ?)",
      pairId, u.id, kinds.includes(rawAct.kind ?? "") ? rawAct.kind : "другое", title, Math.max(0, Math.round(act!.target ?? 0)),
    );
    ref = `plan:${id}`;
    changed(pairId, "plans");
    void notifyPartner(u, `🐷 ${esc(displayName(u))} заводит копилку: <b>${esc(title)}</b>`, { button: { text: "Планы", go: "plans" }, quietIfOnline: true });
  } else if (act!.type === "capsule") {
    needPlus(pairId, "capsules", get<{ n: number }>("SELECT COUNT(*) n FROM capsules WHERE pair_id = ? AND open_at > ?", pairId, today())!.n);
    const openAt = addDays(today(), Math.max(1, act!.days ?? 365));
    const body = `Из теста «${test.title}», ${dayMonth(today())}.\n\n${q!.self}\n\n${displayName(u)}: ${textOf(mine)}\n${name}: ${textOf(theirs)}\n\nЧто с тех пор поменялось?`;
    const { id } = run("INSERT INTO capsules (pair_id, author_id, title, body, open_at) VALUES (?, ?, ?, ?, ?)", pairId, u.id, title, body, openAt);
    ref = `capsule:${id}`;
    changed(pairId, "capsules");
    void notifyPartner(u, `💌 ${esc(displayName(u))} запечатывает для вас письмо. Оно откроется ${openAt.split("-").reverse().join(".")}`, { button: { text: "Капсулы", go: "capsules" } });
  } else if (act!.type === "note") {
    // Одна заметка на тему: строка дописывается в конец
    const note = get<{ id: number; body: string }>("SELECT id, body FROM notes WHERE pair_id = ? AND title = ? ORDER BY id LIMIT 1", pairId, title);
    if (note) {
      run("UPDATE notes SET body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?", `${note.body.trimEnd()}\n• ${line}`.slice(0, 50000), u.id, note.id);
      ref = `note:${note.id}`;
    } else {
      const { id } = run("INSERT INTO notes (pair_id, author_id, title, body, updated_by) VALUES (?, ?, ?, ?, ?)", pairId, u.id, title, `• ${line}`, u.id);
      ref = `note:${id}`;
    }
    changed(pairId, "notes");
  } else if (act!.type === "cheat") {
    run("INSERT OR IGNORE INTO test_marks (pair_id, test_id, round, question_id, kind, user_id) VALUES (?, ?, ?, ?, 'cheat', ?)", pairId, test.id, r.round, q!.id, u.id);
    ref = "cheat";
  }
  remember(ref);
  changed(pairId, "tests");
  return c.json({ ref });
});

/**
 * «Шпаргалка про партнёра»: что не угадано в «Угадай меня» и «Что мне приятно».
 * Без «Вдвоём+» (только при PLUS=1) — первые FREE_CHEAT строк; остальные сервер не
 * отдаёт вовсе, только их число: экран рисует на их месте размытые заглушки.
 */
testy.get("/cheatsheet", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const partner = partnerOf(u);
  const list = cheatsheet(u, partner);
  const cut = paywalled(pairId) && list.length > FREE_CHEAT;
  return c.json({ name: partner ? displayName(partner) : null, entries: cut ? list.slice(0, FREE_CHEAT) : list, hidden: cut ? list.length - FREE_CHEAT : 0 });
});
