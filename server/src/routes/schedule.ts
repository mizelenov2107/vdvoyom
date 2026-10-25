import { all, get, run, tx } from "../db.ts";
import { bad, date, int, oneOf, optStr, router, str } from "../http.ts";
import { partnerOf } from "../pairs.ts";
import { changed } from "../realtime.ts";
import { searchGroups, syncUser } from "../rea.ts";
import { addDays, today } from "../time.ts";
import { daysBreakdown, pairWindows } from "../windows.ts";
import type { UserRow } from "../model.ts";
import { parseScheduleText } from "../schedText.ts";
import { HTTPException } from "hono/http-exception";
import { env } from "../env.ts";
import { AI_PER_DAY, aiReady, recognizeSchedule, spentThisMonth } from "../scheduleAi.ts";
import { checkUrl, syncIcs } from "../icsImport.ts";

export const schedule = router();

/**
 * Чьё расписание правим. По умолчанию своё; ?for=partner — расписание
 * половинки, но только пока она заготовка и сама его вести не может.
 */
function target(c: { req: { query: (k: string) => string | undefined }; get: (k: "user") => UserRow }): UserRow {
  const u = c.get("user");
  if (c.req.query("for") !== "partner") return u;
  const p = partnerOf(u);
  if (!p || p.id > 0) bad("Своё расписание половинка ведёт сама", 403);
  return p!;
}

interface Row {
  id: number;
  user_id: number;
  kind: string;
  weekday: number | null;
  date: string | null;
  start_min: number;
  end_min: number;
  title: string;
  place: string | null;
  skip: number;
  online: number;
  source: string;
  category: string;
}

/**
 * Что за занятость. Уход, здоровье, дела и друзья — личные дела (08.10.2026,
 * «у меня маникюр, спортзал»): добавляются из календаря кнопкой «Только я».
 */
export const CATEGORIES = ["class", "work", "tutoring", "sport", "other", "beauty", "health", "errands", "friends"] as const;

/** Расписание обоих: недельный шаблон и разовые записи на ближайшие недели. */
schedule.get("/", (c) => {
  const u = c.get("user");
  const partner = partnerOf(u);
  const ids = partner ? [u.id, partner.id] : [u.id];
  const from = addDays(today(), -7);
  const rows = all<Row>(
    `SELECT * FROM schedule WHERE user_id IN (${ids.map(() => "?").join(",")})
     AND (kind = 'weekly' OR date >= ?) ORDER BY weekday, date, start_min`,
    ...ids,
    from,
  );
  return c.json({ blocks: rows });
});

schedule.post("/", async (c) => {
  const u = target(c);
  const b = await c.req.json<Record<string, unknown>>();
  const kind = oneOf(b.kind, ["weekly", "once", "free"] as const);
  const start = int(b.start_min, 0, 1439);
  const end = int(b.end_min, 1, 1440);
  if (end <= start) bad("Конец раньше начала");
  const { id } = run(
    `INSERT INTO schedule (user_id, kind, weekday, date, start_min, end_min, title, place, skip, online, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    u.id,
    kind,
    kind === "weekly" ? int(b.weekday, 1, 7) : null,
    kind === "weekly" ? null : date(b.date),
    start,
    end,
    optStr(b.title, 120) ?? "",
    optStr(b.place, 80),
    b.skip ? 1 : 0,
    b.online ? 1 : 0,
    oneOf(b.category, CATEGORIES, "class"),
  );
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ id });
});

schedule.patch("/:id", async (c) => {
  const u = target(c);
  const row = get<Row>("SELECT * FROM schedule WHERE id = ? AND user_id = ?", Number(c.req.param("id")), u.id);
  if (!row) bad("Нет такой пары", 404);
  const b = await c.req.json<Record<string, unknown>>();
  const next = {
    title: "title" in b ? optStr(b.title, 120) ?? "" : row!.title,
    place: "place" in b ? optStr(b.place, 80) : row!.place,
    start: "start_min" in b ? int(b.start_min, 0, 1439) : row!.start_min,
    end: "end_min" in b ? int(b.end_min, 1, 1440) : row!.end_min,
    weekday: "weekday" in b && row!.kind === "weekly" ? int(b.weekday, 1, 7) : row!.weekday,
    date: "date" in b && row!.kind !== "weekly" ? date(b.date) : row!.date,
    skip: "skip" in b ? (b.skip ? 1 : 0) : row!.skip,
    online: "online" in b ? (b.online ? 1 : 0) : row!.online,
    category: "category" in b ? oneOf(b.category, CATEGORIES, "class") : row!.category,
  };
  if (next.end <= next.start) bad("Конец раньше начала");
  run(
    "UPDATE schedule SET title = ?, place = ?, start_min = ?, end_min = ?, weekday = ?, date = ?, skip = ?, online = ?, category = ? WHERE id = ?",
    next.title,
    next.place,
    next.start,
    next.end,
    next.weekday,
    next.date,
    next.skip,
    next.online,
    next.category,
    row!.id,
  );
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ ok: true });
});

schedule.delete("/:id", (c) => {
  const u = target(c);
  run("DELETE FROM schedule WHERE id = ? AND user_id = ?", Number(c.req.param("id")), u.id);
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ ok: true });
});

/**
 * Расписание текстом из чата с ИИ (формат — в schedText.ts). dry — только
 * показать, что разобралось. replace — сначала убрать прежние записи,
 * внесённые руками и прошлым импортом; подтяжку РЭУ это не трогает.
 */
schedule.post("/import", async (c) => {
  const u = target(c);
  const b = await c.req.json<{ text?: unknown; dry?: boolean; replace?: boolean }>();
  const text = typeof b.text === "string" ? b.text.slice(0, 30_000) : "";
  const { entries, errors } = parseScheduleText(text, today());
  if (b.dry) return c.json({ entries, errors });
  if (!entries.length) bad("Не нашлось ни одной строки расписания");
  tx(() => {
    if (b.replace) run("DELETE FROM schedule WHERE user_id = ? AND source IN ('manual', 'import') AND kind IN ('weekly', 'once')", u.id);
    for (const e of entries) {
      run(
        `INSERT INTO schedule (user_id, kind, weekday, date, start_min, end_min, title, place, online, category, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')`,
        u.id, e.kind, e.weekday, e.date, e.start, Math.min(e.end, 1440), e.title, e.place, e.online, e.category,
      );
    }
  });
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ imported: entries.length, errors: errors.length });
});

const WEEKDAY_NAME = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/**
 * Расписание по фото или сырому тексту (28.09.2026): отдаёт строки формата, их
 * клиент показывает тем же предпросмотром, что и ответ своего чата, и сохраняет
 * через /import. Картинки не сохраняются.
 */
schedule.post("/ai", async (c) => {
  target(c);
  const me = c.get("user");
  if (!aiReady()) bad("Распознавание пока не подключено", 409);
  const used = get<{ n: number }>("SELECT COUNT(*) n FROM ai_usage WHERE user_id = ? AND at > datetime('now', '-1 day')", me.id)!.n;
  if (used >= AI_PER_DAY) bad("На сегодня распознаваний хватит. Попробуй завтра или через свой чат с ИИ ниже", 429);
  if (spentThisMonth() >= env.aiMonthLimitRub) bad("Распознавание на паузе до следующего месяца. Пока можно через свой чат с ИИ ниже", 429);
  const body = await c.req.parseBody({ all: true });
  const files = ([] as unknown[]).concat(body.file ?? []).filter((f): f is File => f instanceof File).slice(0, 2);
  const images: { buf: Buffer; mime: string }[] = [];
  for (const f of files) {
    if (f.size > 4 * 1024 * 1024) bad("Снимок больше 4 МБ");
    const buf = Buffer.from(await f.arrayBuffer());
    const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : null;
    if (!mime) bad("Нужна картинка: фото или скриншот");
    images.push({ buf, mime: mime! });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 20_000) : "";
  if (!images.length && text.trim().length < 5) bad("Приложи фото или вставь текст расписания");
  const t = today();
  try {
    const r = await recognizeSchedule({ images, text }, t, WEEKDAY_NAME[new Date(t + "T12:00:00Z").getUTCDay()], me.id);
    if (!r.entries) bad("Не нашлось занятий со временем. Попробуй снимок почётче или вставь текст");
    return c.json(r);
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error("расписание ИИ:", (e as Error).message);
    bad("Не получилось распознать: сервис не ответил. Попробуй ещё раз через минуту", 409);
  }
});

/** Очистить своё расписание целиком — например, перед новым семестром. */
schedule.delete("/", (c) => {
  const u = target(c);
  const source = c.req.query("source");
  if (source) run("DELETE FROM schedule WHERE user_id = ? AND source = ?", u.id, source);
  else run("DELETE FROM schedule WHERE user_id = ?", u.id);
  if (source === "rea" || !source) run("UPDATE users SET rea_group = NULL WHERE id = ?", u.id);
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ ok: true });
});

schedule.get("/rea/search", async (c) => {
  const q = str(c.req.query("q"), 40);
  if (q.length < 2) return c.json({ groups: [] });
  try {
    return c.json({ groups: await searchGroups(q) });
  } catch {
    bad("Сайт расписания РЭУ не ответил");
  }
});

schedule.post("/rea", async (c) => {
  const u = target(c);
  const { group } = await c.req.json<{ group: string }>();
  try {
    const n = await syncUser(u.id, str(group, 60));
    if (u.pair_id) changed(u.pair_id, "schedule");
    return c.json({ imported: n });
  } catch (e) {
    bad(`Не получилось забрать расписание: ${(e as Error).message}`);
  }
});

/** Подключить календарь по ссылке (HSE App X, SmartLMS, Google, Яндекс): сразу забрать и дальше раз в сутки. */
schedule.post("/ics", async (c) => {
  const u = target(c);
  const { url } = await c.req.json<{ url?: string }>();
  const ok = await checkUrl(String(url ?? "").slice(0, 2000));
  if ("error" in ok) bad(ok.error);
  try {
    const n = await syncIcs(u.id, (ok as { url: string }).url);
    if (u.pair_id) changed(u.pair_id, "schedule");
    return c.json({ imported: n });
  } catch (e) {
    bad(`Не получилось забрать календарь: ${(e as Error).message}`);
  }
});

schedule.delete("/ics", (c) => {
  const u = target(c);
  run("DELETE FROM schedule WHERE user_id = ? AND source = 'ics'", u.id);
  run("UPDATE users SET ics_url = NULL, ics_synced_at = NULL WHERE id = ?", u.id);
  if (u.pair_id) changed(u.pair_id, "schedule");
  return c.json({ ok: true });
});

/** Свободные промежутки по дням у обоих и общие окна. */
schedule.get("/days", (c) => {
  const u = c.get("user") as UserRow;
  const days = int(c.req.query("days") ?? 14, 1, 35);
  return c.json({ days: daysBreakdown(u, partnerOf(u), days) });
});

schedule.get("/windows", (c) => {
  const u = c.get("user") as UserRow;
  const days = int(c.req.query("days") ?? 14, 1, 35);
  const min = int(c.req.query("min") ?? 90, 30, 600);
  return c.json({ windows: pairWindows(u, partnerOf(u), days, min) });
});
