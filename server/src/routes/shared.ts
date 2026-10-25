// Общие разделы пары: календарь, задачи, хотелки, копилки, карты, голосования, капсулы, заметки.
import { all, get, run, tx } from "../db.ts";
import { bad, date, int, needPair, oneOf, optDate, optInt, optStr, router, str } from "../http.ts";
import { displayName, type UserRow } from "../model.ts";
import { changed } from "../realtime.ts";
import { answerInvite, esc, inviteKeyboard, notifyPartner, sendRaw } from "../bot.ts";
import { preview } from "../preview.ts";
import { findItem } from "./fun.ts";
import { needPlus } from "../limits.ts";
import { cardPhoto } from "../cardPhoto.ts";
import { addDays, dayMonth, hhmm, today } from "../time.ts";
import { env } from "../env.ts";
import { calToken, resetCalToken } from "../ics.ts";

export const shared = router();

const id = (c: { req: { param: (k: string) => string } }) => Number(c.req.param("id"));
const who = (u: UserRow) => esc(displayName(u));

// ——— календарь ———

const EVENT_KINDS = ["event", "date", "trip", "birthday", "anniversary"] as const;

/**
 * Повтор события из запроса: repeat = week | month | year (старые клиенты шлют yearly).
 * Дни рождения и годовщины всегда раз в год; повторяющееся событие не бывает многодневным.
 */
function repeatOf(kind: string, b: Record<string, unknown>): { yearly: 0 | 1; repeat: "week" | "month" | null } {
  if (kind === "birthday" || kind === "anniversary") return { yearly: 1, repeat: null };
  if (b.repeat === "year" || (b.repeat === undefined && b.yearly)) return { yearly: 1, repeat: null };
  if (b.repeat === "week" || b.repeat === "month") return { yearly: 0, repeat: b.repeat };
  return { yearly: 0, repeat: null };
}

shared.get("/events", (c) => {
  const pairId = needPair(c.get("user"));
  return c.json({ events: all("SELECT * FROM events WHERE pair_id = ? ORDER BY date, start_min", pairId) });
});

shared.post("/events", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const kind = oneOf(b.kind, EVENT_KINDS, "event");
  const start = optInt(b.start_min, 0, 1439);
  const end = optInt(b.end_min, 1, 1440);
  const d = date(b.date);
  const endDate = optDate(b.end_date);
  if (endDate && endDate < d) bad("Конец раньше начала");
  // Свидание можно не просто записать, а предложить: половинке придут кнопки «Иду» и «Не могу»
  const invite = kind === "date" && !!b.invite;
  const rep = repeatOf(kind, b);
  const { id: newId } = run(
    `INSERT INTO events (pair_id, author_id, title, kind, date, end_date, start_min, end_min, yearly, note, status, idea_item, repeat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    pairId, u.id, str(b.title, 120), kind, d, rep.repeat ? null : endDate, start, end,
    rep.yearly, optStr(b.note, 1000), invite ? "proposed" : null, optStr(b.idea_item, 80), rep.repeat,
  );
  changed(pairId, "events");
  const title = esc(str(b.title, 120));
  if (invite) {
    const when = `${dayMonth(d)}${start != null ? `, ${hhmm(start)}${end != null ? "–" + hhmm(end) : ""}` : ""}`;
    const partner = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ?", pairId, u.id);
    if (partner && partner.id > 0) {
      // Свидание из мэтча «Куда сходить» приходит с фото места
      const idea = typeof b.idea_item === "string" ? findItem("idea", pairId, b.idea_item) : undefined;
      void sendRaw(
        partner.id,
        `💞 <b>${who(u)} зовёт на свидание!</b>\n\n📍 <b>${title}</b>\n🗓 ${when}${b.note ? `\n💬 ${esc(String(b.note))}` : ""}\n\nОтветь кнопкой 👇`,
        inviteKeyboard(newId),
        cardPhoto("idea", idea),
      );
    }
  } else {
    const when = `${dayMonth(d)}${start != null ? `, ${hhmm(start)}` : ""}`;
    void notifyPartner(u, `📅 <b>${who(u)} добавляет в календарь</b>\n\n${title}\n🗓 ${when}`, {
      button: { text: "Календарь", go: "calendar" },
      quietIfOnline: true,
    });
  }
  return c.json({ id: newId });
});

shared.patch("/events/:id", async (c) => {
  const pairId = needPair(c.get("user"));
  const row = get<Record<string, unknown>>("SELECT * FROM events WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!row) bad("Нет события", 404);
  const b = { ...row, ...(await c.req.json<Record<string, unknown>>()) };
  const kind = oneOf(b.kind, EVENT_KINDS, "event");
  const rep = repeatOf(kind, b);
  run(
    "UPDATE events SET title = ?, kind = ?, date = ?, end_date = ?, start_min = ?, end_min = ?, yearly = ?, note = ?, repeat = ? WHERE id = ?",
    str(b.title, 120), kind, date(b.date), rep.repeat ? null : optDate(b.end_date),
    optInt(b.start_min, 0, 1439), optInt(b.end_min, 1, 1440), rep.yearly, optStr(b.note, 1000), rep.repeat, id(c),
  );
  changed(pairId, "events");
  return c.json({ ok: true });
});

shared.post("/events/:id/rsvp", async (c) => {
  const u = c.get("user");
  const { yes } = await c.req.json<{ yes: boolean }>();
  const r = await answerInvite(Number(c.req.param("id")), u.id, !!yes);
  if (!r.ok) bad(r.error ?? "Не получилось");
  return c.json({ ok: true });
});

shared.delete("/events/:id", (c) => {
  const pairId = needPair(c.get("user"));
  run("DELETE FROM events WHERE id = ? AND pair_id = ?", id(c), pairId);
  changed(pairId, "events");
  return c.json({ ok: true });
});

// ——— задачи ———

shared.get("/tasks", (c) => {
  const pairId = needPair(c.get("user"));
  return c.json({
    tasks: all(
      `SELECT * FROM tasks WHERE pair_id = ? AND (done_at IS NULL OR done_at > datetime('now', '-14 days'))
       ORDER BY done_at IS NOT NULL, due IS NULL, due, id DESC`,
      pairId,
    ),
  });
});

shared.post("/tasks", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const assignee = b.assignee === "me" ? u.id : b.assignee === "partner" ? partnerId(u) : null;
  const title = str(b.title, 200);
  const repeat = b.repeat ? oneOf(b.repeat, ["day", "week", "month"] as const) : null;
  const { id: newId } = run(
    "INSERT INTO tasks (pair_id, author_id, title, due, assignee_id, taken_at, list, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    pairId, u.id, title, optDate(b.due) ?? (repeat ? today() : null), assignee, assignee ? new Date().toISOString() : null,
    optStr(b.list, 30), repeat,
  );
  changed(pairId, "tasks");
  if (assignee && assignee !== u.id) {
    void notifyPartner(u, `✅ ${who(u)} ставит тебе задачу: <b>${esc(title)}</b>`, { button: { text: "Задачи", go: "tasks" } });
  }
  return c.json({ id: newId });
});

function partnerId(u: UserRow): number | null {
  return get<{ id: number }>("SELECT id FROM users WHERE pair_id = ? AND id != ?", u.pair_id, u.id)?.id ?? null;
}

shared.patch("/tasks/:id", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const t = get<{ id: number; title: string; author_id: number; assignee_id: number | null; done_at: string | null; due: string | null; repeat: string | null; list: string | null }>(
    "SELECT * FROM tasks WHERE id = ? AND pair_id = ?", id(c), pairId,
  );
  if (!t) bad("Нет задачи", 404);
  const b = await c.req.json<Record<string, unknown>>();
  const now = new Date().toISOString();
  if (b.action === "take") run("UPDATE tasks SET assignee_id = ?, taken_at = ? WHERE id = ?", u.id, now, t!.id);
  else if (b.action === "release") run("UPDATE tasks SET assignee_id = NULL, taken_at = NULL WHERE id = ?", t!.id);
  else if (b.action === "done") {
    run("UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ?", now, u.id, t!.id);
    // Повторяющаяся задача: закрыли — сразу появляется следующая
    if (t!.repeat) {
      const base = t!.due && t!.due > today() ? t!.due : today();
      const next =
        t!.repeat === "day" ? addDays(base, 1) :
        t!.repeat === "week" ? addDays(base, 7) :
        (() => { const d = new Date(base + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
      run(
        "INSERT INTO tasks (pair_id, author_id, title, due, assignee_id, taken_at, list, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        pairId, t!.author_id, t!.title, next, t!.assignee_id, t!.assignee_id ? now : null, t!.list, t!.repeat,
      );
    }
    if (t!.author_id !== u.id) {
      void notifyPartner(u, `🎉 ${who(u)} закрывает задачу: <b>${esc(t!.title)}</b>`, { quietIfOnline: true });
    }
  } else if (b.action === "undo") run("UPDATE tasks SET done_at = NULL, done_by = NULL WHERE id = ?", t!.id);
  else {
    run(
      "UPDATE tasks SET title = ?, due = ?, list = ?, repeat = ? WHERE id = ?",
      str(b.title ?? t!.title, 200), "due" in b ? optDate(b.due) : t!.due, "list" in b ? optStr(b.list, 30) : t!.list,
      "repeat" in b ? (b.repeat ? oneOf(b.repeat, ["day", "week", "month"] as const) : null) : t!.repeat, t!.id,
    );
  }
  changed(pairId, "tasks");
  return c.json({ ok: true });
});

shared.delete("/tasks/:id", (c) => {
  const pairId = needPair(c.get("user"));
  run("DELETE FROM tasks WHERE id = ? AND pair_id = ?", id(c), pairId);
  changed(pairId, "tasks");
  return c.json({ ok: true });
});

// ——— хотелки ———

interface WishRow {
  id: number;
  owner_id: number;
  title: string;
  reserved_by: number | null;
  done_at: string | null;
}

shared.get("/wishes", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const rows = all<WishRow & Record<string, unknown>>(
    "SELECT * FROM wishes WHERE pair_id = ? ORDER BY done_at IS NOT NULL, level DESC, id DESC",
    pairId,
  );
  // Тайная бронь: владелец хотелки не должен знать, что её уже кто-то дарит.
  return c.json({
    wishes: rows.map((w) => ({ ...w, reserved_by: w.owner_id === u.id ? null : w.reserved_by })),
  });
});

shared.post("/wishes/preview", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  return c.json(await preview(str(url, 2000)));
});

shared.post("/wishes", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const url = optStr(b.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) bad("Ссылка должна начинаться с http");
  const image = optStr(b.image, 2000);
  const title = str(b.title, 140);
  const { id: newId } = run(
    "INSERT INTO wishes (pair_id, owner_id, title, url, price, image, level, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    pairId, u.id, title, url, optInt(b.price, 0, 1e9), image && /^https?:\/\//.test(image) ? image : null,
    int(b.level ?? 2, 1, 3), optStr(b.note, 500),
  );
  changed(pairId, "wishes");
  const price = optInt(b.price, 0, 1e9);
  void notifyPartner(u, `🎁 <b>Новая хотелка у ${who(u)}</b>\n\n${esc(title)}${price ? `\n💸 ${price.toLocaleString("ru-RU")} ₽` : ""}`, {
    button: { text: "Хотелки", go: "wishes" },
    quietIfOnline: true,
    // Картинка товара с сайта магазина: телеграм заберёт её сам
    photo: image && /^https:\/\//.test(image) ? { url: image } : null,
  });
  return c.json({ id: newId });
});

shared.patch("/wishes/:id", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const w = get<WishRow & Record<string, unknown>>("SELECT * FROM wishes WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!w) bad("Нет хотелки", 404);
  const b = await c.req.json<Record<string, unknown>>();
  if (b.action === "reserve") {
    if (w!.owner_id === u.id) bad("Себе дарить нельзя 🙂");
    run("UPDATE wishes SET reserved_by = ? WHERE id = ? AND (reserved_by IS NULL OR reserved_by = ?)", u.id, w!.id, u.id);
  } else if (b.action === "unreserve") {
    run("UPDATE wishes SET reserved_by = NULL WHERE id = ? AND reserved_by = ?", w!.id, u.id);
  } else if (b.action === "done") {
    run("UPDATE wishes SET done_at = ? WHERE id = ?", today(), w!.id);
  } else if (b.action === "undo") {
    run("UPDATE wishes SET done_at = NULL WHERE id = ?", w!.id);
  } else {
    if (w!.owner_id !== u.id) bad("Править хотелку может только её владелец", 403);
    const m = { ...w!, ...b };
    run(
      "UPDATE wishes SET title = ?, url = ?, price = ?, image = ?, level = ?, note = ? WHERE id = ?",
      str(m.title, 140), optStr(m.url, 2000), optInt(m.price, 0, 1e9), optStr(m.image, 2000), int(m.level ?? 2, 1, 3),
      optStr(m.note, 500), w!.id,
    );
  }
  changed(pairId, "wishes");
  return c.json({ ok: true });
});

shared.delete("/wishes/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  run("DELETE FROM wishes WHERE id = ? AND pair_id = ? AND owner_id = ?", id(c), pairId, u.id);
  changed(pairId, "wishes");
  return c.json({ ok: true });
});

// ——— планы и копилки ———

const PLAN_KINDS = ["поездка", "покупка", "ремонт", "событие", "подарок", "другое"] as const;

shared.get("/plans", (c) => {
  const pairId = needPair(c.get("user"));
  const plans = all<Record<string, unknown> & { id: number }>(
    "SELECT * FROM plans WHERE pair_id = ? ORDER BY archived_at IS NOT NULL, id DESC",
    pairId,
  );
  const entries = all<{ plan_id: number; user_id: number; amount: number }>(
    `SELECT e.* FROM plan_entries e JOIN plans p ON p.id = e.plan_id WHERE p.pair_id = ? ORDER BY e.id DESC`,
    pairId,
  );
  return c.json({
    plans: plans.map((p) => {
      const mine = entries.filter((e) => e.plan_id === p.id);
      const byUser: Record<number, { in: number; out: number }> = {};
      for (const e of mine) {
        byUser[e.user_id] ??= { in: 0, out: 0 };
        if (e.amount > 0) byUser[e.user_id].in += e.amount;
        else byUser[e.user_id].out -= e.amount;
      }
      const saved = mine.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
      const spent = mine.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
      return { ...p, saved, spent, byUser, entries: mine };
    }),
  });
});

shared.post("/plans", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const title = str(b.title, 100);
  const { id: newId } = run(
    "INSERT INTO plans (pair_id, author_id, kind, title, target, currency, due, place_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    pairId, u.id, oneOf(b.kind, PLAN_KINDS, "другое"), title, int(b.target ?? 0, 0, 1e10),
    oneOf(b.currency, ["₽", "€", "$"] as const, "₽"), optDate(b.due), optStr(b.place_id, 60),
  );
  changed(pairId, "plans");
  void notifyPartner(u, `🐷 ${who(u)} заводит копилку: <b>${esc(title)}</b>`, { button: { text: "Планы", go: "plans" }, quietIfOnline: true });
  return c.json({ id: newId });
});

shared.patch("/plans/:id", async (c) => {
  const pairId = needPair(c.get("user"));
  const p = get<Record<string, unknown> & { id: number }>("SELECT * FROM plans WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!p) bad("Нет плана", 404);
  const b = await c.req.json<Record<string, unknown>>();
  if (b.action === "archive") run("UPDATE plans SET archived_at = ? WHERE id = ?", today(), p!.id);
  else if (b.action === "unarchive") run("UPDATE plans SET archived_at = NULL WHERE id = ?", p!.id);
  else {
    const m = { ...p!, ...b };
    run(
      "UPDATE plans SET title = ?, kind = ?, target = ?, currency = ?, due = ? WHERE id = ?",
      str(m.title, 100), oneOf(m.kind, PLAN_KINDS, "другое"), int(m.target ?? 0, 0, 1e10),
      oneOf(m.currency, ["₽", "€", "$"] as const, "₽"), optDate(m.due), p!.id,
    );
  }
  changed(pairId, "plans");
  return c.json({ ok: true });
});

shared.delete("/plans/:id", (c) => {
  const pairId = needPair(c.get("user"));
  tx(() => {
    const p = get("SELECT id FROM plans WHERE id = ? AND pair_id = ?", id(c), pairId);
    if (!p) return;
    run("DELETE FROM plan_entries WHERE plan_id = ?", id(c));
    run("DELETE FROM plans WHERE id = ?", id(c));
  });
  changed(pairId, "plans");
  return c.json({ ok: true });
});

shared.post("/plans/:id/entries", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const p = get<{ id: number; title: string; currency: string }>("SELECT * FROM plans WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!p) bad("Нет плана", 404);
  const b = await c.req.json<Record<string, unknown>>();
  const amount = int(b.amount, -1e10, 1e10);
  if (!amount) bad("Сумма не может быть нулём");
  run("INSERT INTO plan_entries (plan_id, user_id, amount, note) VALUES (?, ?, ?, ?)", p!.id, u.id, amount, optStr(b.note, 200));
  changed(pairId, "plans");
  if (amount > 0) {
    void notifyPartner(u, `🐷 ${who(u)} кладёт ${amount.toLocaleString("ru-RU")} ${p!.currency} в «${esc(p!.title)}»`, {
      quietIfOnline: true,
    });
  }
  return c.json({ ok: true });
});

shared.delete("/plans/:id/entries/:entry", (c) => {
  const pairId = needPair(c.get("user"));
  run(
    "DELETE FROM plan_entries WHERE id = ? AND plan_id IN (SELECT id FROM plans WHERE id = ? AND pair_id = ?)",
    Number(c.req.param("entry")), id(c), pairId,
  );
  changed(pairId, "plans");
  return c.json({ ok: true });
});

// ——— карты лояльности ———

shared.get("/cards", (c) => {
  const pairId = needPair(c.get("user"));
  return c.json({ cards: all("SELECT * FROM cards WHERE pair_id = ? ORDER BY store COLLATE NOCASE", pairId) });
});

shared.post("/cards", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const number = str(b.number, 120);
  const { id: newId } = run(
    "INSERT INTO cards (pair_id, author_id, store, number, format, color) VALUES (?, ?, ?, ?, ?, ?)",
    pairId, u.id, str(b.store, 60), number, oneOf(b.format, ["EAN13", "EAN8", "CODE128", "QR"] as const, "CODE128"),
    optStr(b.color, 20),
  );
  changed(pairId, "cards");
  return c.json({ id: newId });
});

shared.delete("/cards/:id", (c) => {
  const pairId = needPair(c.get("user"));
  run("DELETE FROM cards WHERE id = ? AND pair_id = ?", id(c), pairId);
  changed(pairId, "cards");
  return c.json({ ok: true });
});

// ——— тайные голосования ———

shared.get("/votes", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const votes = all<{ id: number; options: string } & Record<string, unknown>>(
    "SELECT * FROM votes WHERE pair_id = ? ORDER BY id DESC LIMIT 50",
    pairId,
  );
  const answers = all<{ vote_id: number; user_id: number; option: number }>(
    "SELECT a.* FROM vote_answers a JOIN votes v ON v.id = a.vote_id WHERE v.pair_id = ?",
    pairId,
  );
  return c.json({
    votes: votes.map((v) => {
      const mine = answers.find((a) => a.vote_id === v.id && a.user_id === u.id);
      const theirs = answers.find((a) => a.vote_id === v.id && a.user_id !== u.id);
      // Голос половинки открывается только после своего
      return {
        ...v,
        options: JSON.parse(v.options),
        mine: mine?.option ?? null,
        partnerVoted: !!theirs,
        partner: mine ? theirs?.option ?? null : null,
      };
    }),
  });
});

shared.post("/votes", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ question: string; options: string[] }>();
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => str(o, 80, false)).filter(Boolean).slice(0, 6);
  if (options.length < 2) bad("Нужно хотя бы два варианта");
  const question = str(b.question, 200);
  const { id: newId } = run("INSERT INTO votes (pair_id, author_id, question, options) VALUES (?, ?, ?, ?)", pairId, u.id, question, JSON.stringify(options));
  changed(pairId, "votes");
  void notifyPartner(u, `🗳 ${who(u)} спрашивает: <b>${esc(question)}</b>\nОтвет скрыт, пока ты не проголосуешь.`, {
    button: { text: "Голосовать", go: "votes" },
  });
  return c.json({ id: newId });
});

shared.post("/votes/:id/answer", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const v = get<{ id: number; options: string; question: string }>("SELECT * FROM votes WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!v) bad("Нет голосования", 404);
  const { option } = await c.req.json<{ option: number }>();
  const n = JSON.parse(v!.options).length;
  run("INSERT OR REPLACE INTO vote_answers (vote_id, user_id, option) VALUES (?, ?, ?)", v!.id, u.id, int(option, 0, n - 1));
  changed(pairId, "votes");
  const both = get<{ n: number }>("SELECT COUNT(*) AS n FROM vote_answers WHERE vote_id = ?", v!.id)!.n;
  if (both === 2) void notifyPartner(u, `🗳 Оба проголосовали: «${esc(v!.question)}». Смотри, что вышло`, { button: { text: "Итог", go: "votes" }, quietIfOnline: true });
  return c.json({ ok: true });
});

shared.delete("/votes/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  run("DELETE FROM votes WHERE id = ? AND pair_id = ? AND author_id = ?", id(c), pairId, u.id);
  changed(pairId, "votes");
  return c.json({ ok: true });
});

// ——— капсулы времени ———

shared.get("/capsules", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const t = today();
  const rows = all<{ id: number; author_id: number; open_at: string; body: string; secret: number } & Record<string, unknown>>(
    "SELECT * FROM capsules WHERE pair_id = ? ORDER BY open_at",
    pairId,
  );
  // До даты текст видит только автор: получателю нечего подсматривать. Сюрприз до даты
  // получатель не видит вовсе — ни заголовка, ни самого факта письма.
  return c.json({
    capsules: rows
      .filter((r) => !(r.secret && r.open_at > t && r.author_id !== u.id))
      .map((r) => ({ ...r, secret: !!r.secret, sealed: r.open_at > t, body: r.open_at > t && r.author_id !== u.id ? null : r.body })),
  });
});

shared.post("/capsules", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const openAt = date(b.open_at);
  if (openAt <= today()) bad("Капсула открывается хотя бы завтра");
  needPlus(pairId, "capsules", get<{ n: number }>("SELECT COUNT(*) n FROM capsules WHERE pair_id = ? AND open_at > ?", pairId, today())!.n);
  const secret = b.secret === true;
  const { id: newId } = run(
    "INSERT INTO capsules (pair_id, author_id, title, body, open_at, secret) VALUES (?, ?, ?, ?, ?, ?)",
    pairId, u.id, str(b.title, 100), str(b.body, 20000), openAt, secret ? 1 : 0,
  );
  changed(pairId, "capsules");
  // Сюрприз — без уведомления: о письме половинка узнает в день открытия
  if (!secret) {
    void notifyPartner(u, `💌 ${who(u)} запечатывает для тебя письмо. Оно откроется ${openAt.split("-").reverse().join(".")}`, {
      button: { text: "Капсулы", go: "capsules" },
    });
  }
  return c.json({ id: newId });
});

shared.patch("/capsules/:id", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const cap = get<{ id: number; author_id: number; open_at: string; title: string; body: string }>(
    "SELECT * FROM capsules WHERE id = ? AND pair_id = ?", id(c), pairId,
  );
  if (!cap) bad("Нет капсулы", 404);
  const b = await c.req.json<Record<string, unknown>>();
  if (b.action === "read") {
    if (cap!.author_id !== u.id && cap!.open_at <= today()) run("UPDATE capsules SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL", cap!.id);
  } else {
    if (cap!.author_id !== u.id || cap!.open_at <= today()) bad("Открытое письмо уже не правится", 403);
    const openAt = "open_at" in b ? date(b.open_at) : cap!.open_at;
    if (openAt <= today()) bad("Капсула открывается хотя бы завтра");
    run("UPDATE capsules SET title = ?, body = ?, open_at = ? WHERE id = ?", str(b.title ?? cap!.title, 100), str(b.body ?? cap!.body, 20000), openAt, cap!.id);
  }
  changed(pairId, "capsules");
  return c.json({ ok: true });
});

shared.delete("/capsules/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  run("DELETE FROM capsules WHERE id = ? AND pair_id = ? AND author_id = ? AND open_at > ?", id(c), pairId, u.id, today());
  changed(pairId, "capsules");
  return c.json({ ok: true });
});

// ——— заметки ———

shared.get("/notes", (c) => {
  const pairId = needPair(c.get("user"));
  return c.json({ notes: all("SELECT * FROM notes WHERE pair_id = ? ORDER BY pinned DESC, updated_at DESC", pairId) });
});

shared.post("/notes", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const { id: newId } = run(
    "INSERT INTO notes (pair_id, author_id, title, body, updated_by) VALUES (?, ?, ?, ?, ?)",
    pairId, u.id, optStr(b.title, 120) ?? "", typeof b.body === "string" ? b.body.slice(0, 50000) : "", u.id,
  );
  changed(pairId, "notes");
  return c.json({ id: newId });
});

shared.patch("/notes/:id", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const n = get<{ id: number; title: string; body: string; pinned: number }>("SELECT * FROM notes WHERE id = ? AND pair_id = ?", id(c), pairId);
  if (!n) bad("Нет заметки", 404);
  const b = await c.req.json<Record<string, unknown>>();
  run(
    "UPDATE notes SET title = ?, body = ?, pinned = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
    "title" in b ? optStr(b.title, 120) ?? "" : n!.title,
    typeof b.body === "string" ? b.body.slice(0, 50000) : n!.body,
    "pinned" in b ? (b.pinned ? 1 : 0) : n!.pinned,
    u.id,
    n!.id,
  );
  changed(pairId, "notes", { id: n!.id, by: u.id });
  return c.json({ ok: true });
});

shared.delete("/notes/:id", (c) => {
  const pairId = needPair(c.get("user"));
  run("DELETE FROM notes WHERE id = ? AND pair_id = ?", id(c), pairId);
  changed(pairId, "notes");
  return c.json({ ok: true });
});

// ——— календарь телефона (отзыв #4, 28.09.2026) ———

shared.get("/calendar/link", (c) => {
  const t = calToken(c.get("user"));
  const host = env.publicUrl.replace(/^https?:\/\//, "");
  return c.json({ page: `${env.publicUrl}/cal/${t}`, https: `${env.publicUrl}/cal/${t}.ics`, webcal: `webcal://${host}/cal/${t}.ics` });
});

/** Новая ссылка: старая перестаёт работать (если ею случайно поделились). */
shared.post("/calendar/link/reset", (c) => {
  resetCalToken(c.get("user").id);
  return c.json({ ok: true });
});
