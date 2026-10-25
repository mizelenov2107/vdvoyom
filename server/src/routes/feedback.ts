// Кнопка «Отзыв»: текст, до трёх скриншотов и где человек был в приложении.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { get, run } from "../db.ts";
import { env } from "../env.ts";
import { bad, oneOf, router } from "../http.ts";
import { feedbackToOwner } from "../bot.ts";
import { FEEDBACK_KINDS, FEEDBACK_PER_DAY, type FeedbackKind } from "../feedback.ts";

export const feedback = router();

const MAGIC: [string, number[]][] = [
  ["jpg", [0xff, 0xd8, 0xff]],
  ["png", [0x89, 0x50, 0x4e, 0x47]],
  ["webp", [0x52, 0x49, 0x46, 0x46]],
];

const line = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

feedback.post("/feedback", async (c) => {
  const u = c.get("user");
  const body = await c.req.parseBody({ all: true });
  const kind = oneOf(body.kind, Object.keys(FEEDBACK_KINDS) as FeedbackKind[]);
  const text = line(body.text, 3000) ?? "";
  if (text.length < 3) bad("Напиши хотя бы пару слов");
  const today = get<{ n: number }>("SELECT COUNT(*) n FROM feedback WHERE user_id = ? AND created_at > datetime('now', '-1 day')", u.id)!.n;
  if (today >= FEEDBACK_PER_DAY) bad("На сегодня отзывов хватит, спасибо! Напиши завтра", 429);

  const files = ([] as unknown[]).concat(body.file ?? []).filter((f): f is File => f instanceof File).slice(0, 3);
  const photos: string[] = [];
  for (const f of files) {
    if (f.size > 6 * 1024 * 1024) bad("Скриншот больше 6 МБ");
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b))?.[0];
    if (!ext) bad("Прикрепить можно только картинку");
    photos.push(`feedback/${u.id}-${Date.now().toString(36)}${randomBytes(4).toString("hex")}.${ext}`);
    fs.mkdirSync(path.join(env.photosDir, "feedback"), { recursive: true });
    fs.writeFileSync(path.join(env.photosDir, photos.at(-1)!), buf);
  }

  const { id } = run(
    "INSERT INTO feedback (user_id, pair_id, kind, text, screen, platform, photos) VALUES (?, ?, ?, ?, ?, ?, ?)",
    u.id, u.pair_id, kind, text, line(body.screen, 60), line(body.platform, 80), photos.length ? JSON.stringify(photos) : null,
  );
  void feedbackToOwner(Number(id)).catch((e) => console.error("отзыв: не отправился владельцу", id, (e as Error).message));
  return c.json({ id });
});
