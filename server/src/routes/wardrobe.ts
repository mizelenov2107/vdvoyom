// Гардероб и парные луки. Сервер хранит вещи и сохранённые луки; подбор
// образов считается на телефоне — данных мало, а ответ мгновенный.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, get, run } from "../db.ts";
import { needPlus } from "../limits.ts";
import { env } from "../env.ts";
import { bad, date, int, needPair, oneOf, optStr, router, str } from "../http.ts";
import { displayName, type UserRow } from "../model.ts";
import { partnerOf } from "../pairs.ts";
import { changed } from "../realtime.ts";
import { esc, notifyPartner } from "../bot.ts";
import { mediaUrl } from "./media.ts";

export const wardrobe = router();

const CATEGORIES = ["top", "bottom", "dress", "outer", "shoes", "accessory"] as const;
const STYLES = ["casual", "smart", "sport"];

interface ItemRow {
  id: number;
  owner_id: number;
  file: string;
  category: string;
  color: string;
  color_name: string;
  warmth: number;
  styles: string;
  title: string | null;
}

/** Чей гардероб правим: свой или половинки-заготовки (?for=partner). */
function owner(u: UserRow, forPartner: boolean): UserRow {
  if (!forPartner) return u;
  const p = partnerOf(u);
  if (!p || p.id > 0) bad("Свой гардероб партнёр ведёт сам", 403);
  return p!;
}

wardrobe.get("/wardrobe", (c) => {
  const pairId = needPair(c.get("user"));
  const items = all<ItemRow>("SELECT * FROM wardrobe WHERE pair_id = ? ORDER BY category, id DESC", pairId).map((i) => ({
    ...i,
    styles: JSON.parse(i.styles) as string[],
    url: mediaUrl(i.file),
  }));
  return c.json({ items });
});

wardrobe.post("/wardrobe", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  needPlus(pairId, "wardrobe", get<{ n: number }>("SELECT COUNT(*) n FROM wardrobe WHERE pair_id = ?", pairId)!.n);
  const who = owner(u, c.req.query("for") === "partner");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) bad("Нет фото вещи");
  const buf = Buffer.from(await (file as File).arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) bad("Фото больше 4 МБ");
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) bad("Нужна фотография в JPEG");
  const name = `${pairId}/w${Date.now().toString(36)}${randomBytes(5).toString("hex")}.jpg`;
  fs.mkdirSync(path.join(env.photosDir, String(pairId)), { recursive: true });
  fs.writeFileSync(path.join(env.photosDir, name), buf);
  const color = str(body.color, 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) bad("Цвет в виде #rrggbb");
  const styles = String(body.styles ?? "casual").split(",").filter((s) => STYLES.includes(s));
  const { id } = run(
    "INSERT INTO wardrobe (pair_id, owner_id, file, category, color, color_name, warmth, styles, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    pairId, who.id, name, oneOf(body.category, CATEGORIES), color.toLowerCase(), str(body.color_name, 30),
    int(body.warmth ?? 2, 1, 3), JSON.stringify(styles.length ? styles : ["casual"]), optStr(body.title, 80),
  );
  changed(pairId, "wardrobe");
  return c.json({ id });
});

wardrobe.patch("/wardrobe/:id", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const item = get<ItemRow>("SELECT * FROM wardrobe WHERE id = ? AND pair_id = ?", Number(c.req.param("id")), pairId);
  if (!item) bad("Нет такой вещи", 404);
  const partner = partnerOf(u);
  if (item!.owner_id !== u.id && !(partner && partner.id < 0 && item!.owner_id === partner.id)) bad("Чужую вещь правит её хозяин", 403);
  const b = await c.req.json<Record<string, unknown>>();
  run(
    "UPDATE wardrobe SET category = ?, color = ?, color_name = ?, warmth = ?, styles = ?, title = ? WHERE id = ?",
    "category" in b ? oneOf(b.category, CATEGORIES) : item!.category,
    typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toLowerCase() : item!.color,
    "color_name" in b ? str(b.color_name, 30) : item!.color_name,
    "warmth" in b ? int(b.warmth, 1, 3) : item!.warmth,
    Array.isArray(b.styles) ? JSON.stringify((b.styles as string[]).filter((s) => STYLES.includes(s))) : item!.styles,
    "title" in b ? optStr(b.title, 80) : item!.title,
    item!.id,
  );
  changed(pairId, "wardrobe");
  return c.json({ ok: true });
});

wardrobe.delete("/wardrobe/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const item = get<ItemRow>("SELECT * FROM wardrobe WHERE id = ? AND pair_id = ?", Number(c.req.param("id")), pairId);
  if (!item) bad("Нет такой вещи", 404);
  const partner = partnerOf(u);
  if (item!.owner_id !== u.id && !(partner && partner.id < 0 && item!.owner_id === partner.id)) bad("Чужую вещь удаляет её хозяин", 403);
  run("DELETE FROM wardrobe WHERE id = ?", item!.id);
  fs.rmSync(path.join(env.photosDir, item!.file), { force: true });
  changed(pairId, "wardrobe");
  return c.json({ ok: true });
});

// ——— сохранённые луки ———

wardrobe.get("/looks", (c) => {
  const pairId = needPair(c.get("user"));
  return c.json({ looks: all<{ items: string }>("SELECT * FROM looks WHERE pair_id = ? ORDER BY date IS NULL, date, id DESC", pairId).map((l) => ({ ...l, items: JSON.parse(l.items) })) });
});

wardrobe.post("/looks", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ title: string; occasion?: string; date?: string; items: Record<string, number[]> }>();
  const ids = new Set(all<{ id: number }>("SELECT id FROM wardrobe WHERE pair_id = ?", pairId).map((r) => r.id));
  const items: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(b.items ?? {})) items[k] = (Array.isArray(v) ? v : []).map(Number).filter((n) => ids.has(n)).slice(0, 8);
  const title = str(b.title, 80);
  const { id } = run(
    "INSERT INTO looks (pair_id, author_id, title, occasion, date, items) VALUES (?, ?, ?, ?, ?, ?)",
    pairId, u.id, title, optStr(b.occasion, 30), b.date ? date(b.date) : null, JSON.stringify(items),
  );
  changed(pairId, "wardrobe");
  void notifyPartner(u, `👗 ${esc(displayName(u))} собирает ваш парный лук: <b>${esc(title)}</b>`, { button: { text: "Посмотреть", go: "wardrobe" }, quietIfOnline: true });
  return c.json({ id });
});

wardrobe.delete("/looks/:id", (c) => {
  const pairId = needPair(c.get("user"));
  run("DELETE FROM looks WHERE id = ? AND pair_id = ?", Number(c.req.param("id")), pairId);
  changed(pairId, "wardrobe");
  return c.json({ ok: true });
});

// ——— погода для подбора: Open-Meteo, Москва, кэш на час ———

let weatherCache: { at: number; data: Record<string, { tmin: number; tmax: number; rain: number; code: number }> } | null = null;

wardrobe.get("/weather", async (c) => {
  if (!weatherCache || Date.now() - weatherCache.at > 3600_000) {
    try {
      const res = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=55.75&longitude=37.62&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Europe%2FMoscow&forecast_days=16",
        { signal: AbortSignal.timeout(8000) },
      );
      const j = (await res.json()) as { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] } };
      const data: Record<string, { tmin: number; tmax: number; rain: number; code: number }> = {};
      j.daily.time.forEach((d, i) => {
        data[d] = { tmin: j.daily.temperature_2m_min[i], tmax: j.daily.temperature_2m_max[i], rain: j.daily.precipitation_probability_max[i] ?? 0, code: j.daily.weather_code[i] };
      });
      weatherCache = { at: Date.now(), data };
    } catch {
      if (!weatherCache) return c.json({ days: {} });
    }
  }
  return c.json({ days: weatherCache!.data });
});
