// Админка внутри приложения — только для владельца (env.adminIds), 28.09.2026.
import fs from "node:fs";
import path from "node:path";
import { all, get } from "../db.ts";
import { env } from "../env.ts";
import { bad, router } from "../http.ts";
import { displayName, type UserRow } from "../model.ts";
import { deletePartner, feed, funnel, grantPlus, isAdmin, overview, pairInfo, partnerList, savePartner, setBlocked, userCard, users, type GiftTerm, type PartnerRow } from "../adminData.ts";
import { FEEDBACK_KINDS, type FeedbackRow } from "../feedback.ts";
import { botUsername, esc, sendTo } from "../bot.ts";
import { addDays, dayMonth, today } from "../time.ts";

export const adminApp = router();

adminApp.use("*", async (c, next) => {
  if (!isAdmin(c.get("user"))) return c.json({ error: "Только для владельца" }, 403);
  await next();
});

adminApp.get("/overview", (c) => c.json(overview()));
adminApp.get("/users", (c) => c.json({ users: users() }));
adminApp.get("/users/:id", (c) => {
  const card = userCard(Number(c.req.param("id")));
  return card ? c.json(card) : c.json({ error: "Нет такого человека" }, 404);
});
adminApp.post("/users/:id/block", async (c) => {
  const id = Number(c.req.param("id"));
  const { blocked } = await c.req.json<{ blocked: boolean }>();
  if (id === c.get("user").id) bad("Себя заблокировать нельзя");
  if (!get("SELECT 1 FROM users WHERE id = ?", id)) bad("Нет такого человека", 404);
  setBlocked(id, !!blocked);
  return c.json({ ok: true });
});
adminApp.get("/activity", (c) => c.json({ items: feed(80) }));

adminApp.get("/feedback", (c) => {
  const rows = all<FeedbackRow>("SELECT * FROM feedback ORDER BY id DESC LIMIT 50");
  return c.json({
    items: rows.map((f) => {
      const u = get<UserRow>("SELECT * FROM users WHERE id = ?", f.user_id);
      return {
        id: f.id,
        kind: FEEDBACK_KINDS[f.kind] ?? f.kind,
        author: u ? displayName(u) : `id ${f.user_id}`,
        userId: f.user_id,
        screen: f.screen,
        platform: f.platform,
        text: f.text,
        photos: f.photos ? (JSON.parse(f.photos) as string[]).length : 0,
        doneNote: f.done_note ?? null,
        at: f.created_at,
      };
    }),
  });
});

/** Скриншот отзыва: картинку клиент берёт fetch-ем с заголовком входа, поэтому через API, а не /media. */
adminApp.get("/feedback/:id/photo/:n", (c) => {
  const f = get<FeedbackRow>("SELECT * FROM feedback WHERE id = ?", Number(c.req.param("id")));
  const name = f?.photos ? (JSON.parse(f.photos) as string[])[Number(c.req.param("n"))] : undefined;
  const full = name ? path.join(env.photosDir, name) : "";
  if (!name || !fs.existsSync(full)) return c.body(null, 404);
  return c.body(new Uint8Array(fs.readFileSync(full)), 200, { "content-type": name.endsWith(".png") ? "image/png" : "image/jpeg" });
});

// ——— воронка, блогеры, подарок «Вдвоём+» (11.10.2026) ———

/** Период воронки из query: from/to ГГГГ-ММ-ДД по Москве, по умолчанию последние 8 недель. */
export function funnelQuery(q: (k: string) => string | undefined) {
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const to = ok(q("to")) ?? today();
  const from = ok(q("from")) ?? addDays(to, -55);
  const source = q("source");
  return funnel({ from: from <= to ? from : to, to, source: source === undefined ? null : source });
}

/** Ссылки блогера: сразу в приложение и через чат с ботом. */
export const partnerLinks = (code: string) => ({
  app: `https://t.me/${botUsername}?startapp=b_${code}`,
  bot: `https://t.me/${botUsername}?start=b_${code}`,
});

export function partnersPayload() {
  const starts = new Map(
    all<{ source: string; n: number }>("SELECT source, COUNT(*) n FROM users WHERE id > 0 AND source LIKE 'b\\_%' ESCAPE '\\' GROUP BY source").map((r) => [r.source, r.n]),
  );
  return {
    items: partnerList().map((p: PartnerRow) => ({
      code: p.code,
      name: p.name,
      platform: p.platform,
      url: p.url,
      note: p.note,
      createdAt: p.created_at,
      starts: starts.get(`b_${p.code}`) ?? 0,
      links: partnerLinks(p.code),
    })),
  };
}

/** Подарок и сообщение паре: бот пишет обоим (без токена — в журнал). */
export async function giftPlus(pairId: number, b: { term?: unknown; until?: unknown; notify?: unknown }, byId: number) {
  const r = grantPlus(pairId, String(b.term ?? "") as GiftTerm, byId, typeof b.until === "string" ? b.until : null);
  if (b.notify !== false) {
    const till = r.forever ? "навсегда" : `до ${dayMonth(r.until)}`;
    const members = all<{ id: number }>("SELECT id FROM users WHERE pair_id = ? AND id > 0", pairId);
    for (const m of members) {
      void sendTo(m.id, `🎁 <b>Вам подарили «Вдвоём+» ${esc(till)}</b>\n\nВсё открыто для вас обоих, платить не нужно 💞`, { text: "Открыть", go: "plus" });
    }
  }
  return { ok: true, ...r, pair: pairInfo(pairId) };
}

adminApp.get("/funnel", (c) => c.json(funnelQuery((k) => c.req.query(k))));
adminApp.get("/partners", (c) => c.json(partnersPayload()));
adminApp.post("/partners", async (c) => c.json({ ok: true, partner: savePartner(await c.req.json<Record<string, unknown>>()) }));
adminApp.patch("/partners/:code", async (c) => c.json({ ok: true, partner: savePartner(await c.req.json<Record<string, unknown>>(), c.req.param("code")) }));
adminApp.delete("/partners/:code", (c) => (deletePartner(c.req.param("code")) ? c.json({ ok: true }) : bad("Нет такого блогера", 404)));
adminApp.get("/pairs/:id", (c) => {
  const p = pairInfo(Number(c.req.param("id")));
  return p ? c.json(p) : bad("Нет такой пары", 404);
});
adminApp.post("/pairs/:id/plus", async (c) => c.json(await giftPlus(Number(c.req.param("id")), await c.req.json(), c.get("user").id)));
