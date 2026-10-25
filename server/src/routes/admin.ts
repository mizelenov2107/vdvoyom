// /admin — только для бота «Ассистент» владельца (28.09.2026): смотреть отзывы
// закрытого теста, их скриншоты и отвечать авторам. Вход по ключу ADMIN_TOKEN
// в заголовке Authorization: Bearer …; без ключа на сервере раздела нет вовсе.
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { all, get, run } from "../db.ts";
import { env } from "../env.ts";
import { displayName, type UserRow } from "../model.ts";
import { replyToFeedback } from "../bot.ts";
import { FEEDBACK_KINDS, type FeedbackRow } from "../feedback.ts";
import { alerts, overview, pairInfo, users } from "../adminData.ts";
import { funnelQuery, giftPlus, partnersPayload } from "./adminApp.ts";

export const admin = new Hono();

admin.use("*", async (c, next) => {
  const given = Buffer.from((c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(env.adminToken);
  if (!env.adminToken || given.length !== want.length || !timingSafeEqual(given, want)) return c.body(null, 404);
  await next();
});

/** Отзывы от новых к старым, по limit штук; before — id, с которого листать дальше. */
admin.get("/feedback", (c) => {
  const limit = Math.min(30, Math.max(1, Number(c.req.query("limit")) || 10));
  const before = Number(c.req.query("before")) || Number.MAX_SAFE_INTEGER;
  const rows = all<FeedbackRow>("SELECT * FROM feedback WHERE id < ? ORDER BY id DESC LIMIT ?", before, limit);
  const people = new Map<number, UserRow | undefined>();
  const who = (id: number) => {
    if (!people.has(id)) people.set(id, get<UserRow>("SELECT * FROM users WHERE id = ?", id));
    return people.get(id);
  };
  const counts = get<{ total: number; open: number }>("SELECT COUNT(*) total, SUM(done_at IS NULL) open FROM feedback")!;
  return c.json({
    total: counts.total,
    unanswered: counts.open ?? 0,
    items: rows.map((f) => ({
      id: f.id,
      kind: FEEDBACK_KINDS[f.kind] ?? f.kind,
      author: who(f.user_id) ? displayName(who(f.user_id)!) : `id ${f.user_id}`,
      username: who(f.user_id)?.username ?? null,
      pairId: f.pair_id,
      screen: f.screen,
      platform: f.platform,
      text: f.text,
      photos: f.photos ? (JSON.parse(f.photos) as string[]).length : 0,
      reply: f.reply,
      done: f.done_note ?? (f.done_at ? "учтено" : null),
      createdAt: f.created_at,
    })),
  });
});

admin.get("/feedback/:id/photo/:n", (c) => {
  const f = get<FeedbackRow>("SELECT * FROM feedback WHERE id = ?", Number(c.req.param("id")));
  const name = f?.photos ? (JSON.parse(f.photos) as string[])[Number(c.req.param("n"))] : undefined;
  const full = name ? path.join(env.photosDir, name) : "";
  if (!name || !fs.existsSync(full)) return c.body(null, 404);
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return c.body(new Uint8Array(fs.readFileSync(full)), 200, { "content-type": type });
});

admin.post("/feedback/:id/reply", async (c) => {
  const f = get<FeedbackRow>("SELECT * FROM feedback WHERE id = ?", Number(c.req.param("id")));
  if (!f) return c.json({ error: "Нет такого отзыва" }, 404);
  const { text } = await c.req.json<{ text?: string }>().catch(() => ({ text: "" }));
  const answer = String(text ?? "").trim().slice(0, 2000);
  if (!answer) return c.json({ error: "Пустой ответ" }, 400);
  return c.json({ ok: true, delivered: await replyToFeedback(f, answer) });
});

/** Отзыв учтён: Claude ставит после правки, «Ассистент» показывает «✅ сделано: …». */
admin.post("/feedback/:id/done", async (c) => {
  const { note } = await c.req.json<{ note?: string }>().catch(() => ({ note: "" }));
  const id = Number(c.req.param("id"));
  if (!get("SELECT 1 FROM feedback WHERE id = ?", id)) return c.json({ error: "Нет такого отзыва" }, 404);
  run("UPDATE feedback SET done_at = datetime('now'), done_note = ? WHERE id = ?", String(note ?? "").trim().slice(0, 300) || null, id);
  return c.json({ ok: true });
});

/** Для «Ассистента»: сводка, новые люди (since — дата UTC «YYYY-MM-DD HH:MM:SS») и тревоги. */
admin.get("/overview", (c) => c.json(overview()));
admin.get("/users", (c) => c.json({ users: users(c.req.query("since") || undefined) }));
admin.get("/alerts", (c) => c.json({ alerts: alerts() }));

/**
 * Для «Ассистента» (11.10.2026): воронка за период (?from=&to= ГГГГ-ММ-ДД, ?source=b_код),
 * справочник блогеров со ссылками, карточка пары и подарок «Вдвоём+»
 * ({ term: month | year | forever | date, until?: ГГГГ-ММ-ДД, notify?: false }).
 */
admin.get("/funnel", (c) => c.json(funnelQuery((k) => c.req.query(k))));
admin.get("/sources", (c) => {
  const f = funnelQuery((k) => c.req.query(k));
  return c.json({ from: f.from, to: f.to, definition: f.definition, total: f.total, sources: f.bySource });
});
admin.get("/partners", (c) => c.json(partnersPayload()));
admin.get("/pairs/:id", (c) => {
  const p = pairInfo(Number(c.req.param("id")));
  return p ? c.json(p) : c.json({ error: "Нет такой пары" }, 404);
});
admin.post("/pairs/:id/plus", async (c) => c.json(await giftPlus(Number(c.req.param("id")), await c.req.json().catch(() => ({})), 0)));
