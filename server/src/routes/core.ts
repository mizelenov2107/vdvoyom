import { streamSSE } from "hono/streaming";
import { all, get, run, tx } from "../db.ts";
import { launchFromHeader, upsertUser } from "../auth.ts";
import { bad, date, int, oneOf, optDate, optStr, router, needPair, str } from "../http.ts";
import { publicUser, displayName, listOf, MODULES, NOTIFY, type PairRow, type UserRow } from "../model.ts";
import { offerOf, PLANS, plusOf } from "../plus.ts";
import { env } from "../env.ts";
import { isAdmin } from "../adminData.ts";
import { aiReady } from "../scheduleAi.ts";
import { createGhost, ensurePair, ghostOf, joinPair, partnerOf, wipePair } from "../pairs.ts";
import { connect, changed, setRoom } from "../realtime.ts";
import { esc, inviteLink, notifyPartner, botUsername, sendTo } from "../bot.ts";
import { homeSummary } from "../home.ts";
import { isBeta } from "../beta.ts";

export const core = router();

export const COLORS = ["violet", "rose", "sky", "mint", "sun", "coral", "blue", "green", "amber", "pink"] as const;

function mePayload(u: UserRow) {
  const beta = isBeta(u);
  const pair = u.pair_id ? get<PairRow>("SELECT * FROM pairs WHERE id = ?", u.pair_id) : undefined;
  const partner = partnerOf(u);
  return {
    me: publicUser(u),
    partner: partner ? publicUser(partner) : null,
    pair: pair
      ? {
          id: pair.id, togetherSince: pair.together_since, invite: inviteLink(pair.invite_code), plus: plusOf(pair.id),
          // Акция для главной: таймер и цена, пока идёт и «Вдвоём+» не куплен
          offer: (() => {
            const o = offerOf(pair.id);
            return o?.active ? { until: o.until, rub: PLANS.year_offer.rub, oldRub: PLANS.year.rub } : null;
          })(),
        }
      : null,
    bot: botUsername,
    /** Платная часть включена (PLUS=1). В бою на время закрытого теста — нет */
    plusOn: env.plusOn,
    /** Владелец: в «Ещё» есть админка */
    isAdmin: isAdmin(u),
    /** Расписание по фото прямо в приложении (ключ Яндекса есть) */
    aiSchedule: aiReady(),
    /** Личные настройки: что убрано из приложения и о чём бот не напоминает */
    prefs: { hidden: listOf(u.hidden), muted: listOf(u.muted) },
    /**
     * Бета новых тестов (08.10.2026, этап 4, beta.ts): тесты формата 2 и «Шпаргалка».
     * false — старые семь тестов, как до 08.10
     */
    beta,
  };
}

core.get("/me", (c) => {
  const u = c.get("user");
  // Пространство есть всегда: одному тоже можно пользоваться.
  ensurePair(u.id);
  const fresh = get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
  // Открыли по ссылке с приглашением — присоединяем сразу.
  const sp = c.get("startParam");
  let joined: string | null = null;
  if (sp?.startsWith("pair_")) {
    const r = joinPair(u.id, sp.slice(5));
    // Код остаётся в initData всю сессию: уже соединённым повторно не пишем
    if (r.ok && r.partner && !r.already) {
      joined = displayName(r.partner);
      const me = get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
      changed(me.pair_id!, "pair");
      void notifyPartner(me, `🎉 <b>${esc(displayName(me))} теперь с тобой во «Вдвоём»!</b>\n\nВсё, что уже было в приложении, стало общим 💞`, { button: { text: "Открыть" } });
      return c.json({ ...mePayload(me), joined });
    }
  }
  return c.json({ ...mePayload(fresh), joined });
});

core.post("/me", async (c) => {
  const u = c.get("user");
  const b = await c.req.json<Record<string, unknown>>();
  if ("name" in b) run("UPDATE users SET name = ? WHERE id = ?", optStr(b.name, 40), u.id);
  if ("color" in b) run("UPDATE users SET color = ? WHERE id = ?", oneOf(b.color, COLORS), u.id);
  if ("birthday" in b) run("UPDATE users SET birthday = ? WHERE id = ?", optDate(b.birthday), u.id);
  if ("gapMin" in b) run("UPDATE users SET gap_min = ? WHERE id = ?", int(b.gapMin, 0, 180), u.id);
  if ("dayStartMin" in b) run("UPDATE users SET day_start_min = ? WHERE id = ?", int(b.dayStartMin, 0, 1439), u.id);
  if ("dayEndMin" in b) run("UPDATE users SET day_end_min = ? WHERE id = ?", int(b.dayEndMin, 1, 1440), u.id);
  if ("onboarded" in b) run("UPDATE users SET onboarded = 1 WHERE id = ?", u.id);
  if (b.consent === true) run("UPDATE users SET consent_at = COALESCE(consent_at, datetime('now')) WHERE id = ?", u.id);
  // Телеграм подтвердил, что бот может писать первым (requestWriteAccess)
  if (b.writeAccess === true) run("UPDATE users SET chat_ok = 1 WHERE id = ?", u.id);
  if (Array.isArray(b.hidden)) run("UPDATE users SET hidden = ? WHERE id = ?", JSON.stringify(MODULES.filter((m) => (b.hidden as unknown[]).includes(m))), u.id);
  if (Array.isArray(b.muted)) run("UPDATE users SET muted = ? WHERE id = ?", JSON.stringify(NOTIFY.filter((n) => (b.muted as unknown[]).includes(n))), u.id);
  const fresh = get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
  if (fresh.pair_id) changed(fresh.pair_id, "pair");
  return c.json(mePayload(fresh));
});

core.post("/pair", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  if ("togetherSince" in b) run("UPDATE pairs SET together_since = ? WHERE id = ?", optDate(b.togetherSince), pairId);
  changed(pairId, "pair");
  return c.json(mePayload(u));
});

/** Завести половинку заранее: её расписание и окна появятся до того, как она зайдёт. */
core.post("/pair/partner", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const real = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id > 0 AND id != ?", pairId, u.id);
  if (real) bad("Половинка уже в приложении");
  const b = await c.req.json<Record<string, unknown>>();
  createGhost(pairId, { name: str(b.name, 40), color: b.color ? oneOf(b.color, COLORS) : "rose", birthday: optDate(b.birthday) });
  changed(pairId, "pair");
  return c.json(mePayload(get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!));
});

core.delete("/pair/partner", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const g = ghostOf(pairId);
  if (g) {
    run("DELETE FROM schedule WHERE user_id = ?", g.id);
    run("DELETE FROM swipes WHERE user_id = ?", g.id);
    run("DELETE FROM users WHERE id = ?", g.id);
  }
  changed(pairId, "pair");
  return c.json(mePayload(u));
});

/** Выйти из пары: общее остаётся у половинки, у тебя начинается новое пустое пространство. */
core.post("/pair/leave", async (c) => {
  const u = c.get("user");
  const partner = partnerOf(u);
  if (!partner || partner.id < 0) bad("Ты и так один в пространстве");
  const oldPair = u.pair_id!;
  run("UPDATE users SET pair_id = NULL WHERE id = ?", u.id);
  ensurePair(u.id);
  changed(oldPair, "pair");
  await sendTo(partner!.id, `${esc(displayName(u))} выходит из вашего общего пространства. Всё, что вы вели вместе, осталось у тебя.`);
  return c.json(mePayload(get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!));
});

/**
 * Удалить аккаунт. Личное (расписание, свайпы, ответы) удаляется всегда.
 * Если половинка есть, общее остаётся ей; если человек был один — стирается всё пространство.
 */
core.delete("/me", async (c) => {
  const u = c.get("user");
  const partner = partnerOf(u);
  const pairId = u.pair_id;
  tx(() => {
    for (const [table, col] of [
      ["schedule", "user_id"], ["movie_prefs", "user_id"], ["swipes", "user_id"], ["daily_answers", "user_id"], ["activity", "user_id"], ["daily_reactions", "user_id"],
      ["test_answers", "user_id"], ["test_round_answers", "user_id"], ["test_marks", "user_id"], ["vote_answers", "user_id"], ["pings", "from_id"],
    ]) run(`DELETE FROM ${table} WHERE ${col} = ?`, u.id);
    if (pairId && (!partner || partner.id < 0)) wipePair(pairId);
    run("DELETE FROM users WHERE id = ?", u.id);
  });
  if (pairId && partner && partner.id > 0) {
    changed(pairId, "pair");
    await sendTo(partner.id, `${esc(displayName(u))} удаляет свой аккаунт во «Вдвоём». Всё общее осталось у тебя.`);
  }
  return c.json({ ok: true });
});

core.post("/pair/join", async (c) => {
  const u = c.get("user");
  const { code } = await c.req.json<{ code: string }>();
  const r = joinPair(u.id, str(code, 300).replace(/^.*pair_/, ""));
  if (!r.ok) bad(r.error ?? "Не получилось");
  const me = get<UserRow>("SELECT * FROM users WHERE id = ?", u.id)!;
  changed(me.pair_id!, "pair");
  void notifyPartner(me, `🎉 <b>${esc(displayName(me))} теперь с тобой во «Вдвоём»!</b>\n\nВсё, что уже было в приложении, стало общим 💞`, { button: { text: "Открыть" } });
  return c.json(mePayload(me));
});

core.get("/home", (c) => c.json(homeSummary(c.get("user"))));

const MOODS = ["😊", "🥰", "😴", "🤯", "😔", "🤒", "🥳", "📚", "😤", "🫠"];

core.post("/mood", async (c) => {
  const u = c.get("user");
  const { mood } = await c.req.json<{ mood: string | null }>();
  const value = mood === null ? null : oneOf(mood, MOODS);
  run("UPDATE users SET mood = ?, mood_at = datetime('now') WHERE id = ?", value, u.id);
  if (u.pair_id) changed(u.pair_id, "pair");
  return c.json({ ok: true });
});

const PINGS = {
  miss: (n: string) => `💭 <b>${n} скучает по тебе</b>\n\nОтветь чем-нибудь тёплым 🤗`,
  hug: (n: string) => `🤗 <b>${n} обнимает тебя</b>`,
  kiss: (n: string) => `💋 <b>${n} целует тебя</b>`,
  think: (n: string) => `✨ <b>${n} думает о тебе</b>`,
} as const;

core.post("/ping", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const { kind } = await c.req.json<{ kind: keyof typeof PINGS }>();
  const k = oneOf(kind, Object.keys(PINGS) as (keyof typeof PINGS)[]);
  const recent = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pings WHERE from_id = ? AND created_at > datetime('now', '-1 minute')",
    u.id,
  )!.n;
  if (recent >= 3) bad("Не так часто 🙂 Подожди минутку", 429);
  run("INSERT INTO pings (pair_id, from_id, kind) VALUES (?, ?, ?)", pairId, u.id, k);
  const text = PINGS[k](esc(displayName(u)));
  await notifyPartner(u, text, { button: { text: "Ответить", go: "home" } });
  changed(pairId, "pings", { from: u.id, kind: k });
  return c.json({ ok: true });
});

/** Комната присутствия: колода фильмов показывает, что половинка тоже выбирает. */
core.post("/presence", async (c) => {
  const u = c.get("user");
  const { room } = await c.req.json<{ room: string | null }>();
  if (u.pair_id) setRoom(u.pair_id, u.id, room ? str(room, 20) : null);
  return c.json({ ok: true });
});

// Живой канал. Вход — тем же заголовком, что и у остальных запросов: ключ
// в адресе оседал бы в журналах прокси.
export const stream = router();
stream.get("/", (c) => {
  const launch = launchFromHeader(c.req.header("authorization"));
  if (!launch) bad("Нет входа", 403);
  const u = upsertUser(launch!.user);
  if (!u.pair_id) bad("Нет пары", 409);
  const pairId = u.pair_id!;
  return streamSSE(c, async (s) => {
    let open = true;
    const push = (event: string, data: unknown) => {
      if (open) void s.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    };
    const off = connect(pairId, u.id, push);
    s.onAbort(() => {
      open = false;
      off();
    });
    // Пустое событие раз в 25 секунд, чтобы прокси не рвали тихое соединение
    while (open) {
      await s.sleep(25_000);
      if (open) await s.writeSSE({ event: "tick", data: "{}" }).catch(() => (open = false));
    }
  });
});

