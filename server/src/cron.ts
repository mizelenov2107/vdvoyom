// Раз в минуту: капсулы, вопрос дня, дни рождения, годовщины, завтрашние
// события, воскресная сводка окон и подтяжка расписания РЭУ. Каждое
// напоминание помечается ключом в таблице sent и второй раз не уходит.
import { all, get, run } from "./db.ts";
import { esc, fullPairs, sendTo } from "./bot.ts";
import { displayName, hides, mutes, type PairRow, type UserRow } from "./model.ts";
import { addDays, daysBetween, dayMonth, eventOn, hhmm, humanDate, mskNow, nextYearly } from "./time.ts";
import { questionFor } from "./daily.ts";
import { busyChunks, pairWindows, personalOn, SHOWN_WINDOW_MIN, windowsOn } from "./windows.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import fs from "node:fs";
import path from "node:path";
import { genitive } from "./home.ts";
import { syncUser } from "./rea.ts";
import { checkUrl, syncIcs } from "./icsImport.ts";
import { changed } from "./realtime.ts";
import { ratingsUpdatedAt, refreshRatings } from "./imdb.ts";
import { refreshStaleKp } from "./kinopoisk.ts";
import { remindStale } from "./testy.ts";

async function once(key: string, fn: () => Promise<unknown>): Promise<void> {
  if (run("INSERT OR IGNORE INTO sent (key) VALUES (?)", key).changes === 0) return;
  try {
    await fn();
  } catch (e) {
    console.error("cron", key, e);
  }
}

function years(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} год`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} года`;
  return `${n} лет`;
}

const DAY_MILESTONES = [100, 200, 300, 365, 500, 600, 700, 730, 800, 900, 1000, 1500, 2000, 2500, 3000];

export async function tick(now = Date.now()): Promise<void> {
  const { date, minutes, weekday } = mskNow(now);
  // Журнал действий админки живёт 90 дней (так написано в политике)
  if (minutes % 60 === 17) run("DELETE FROM activity WHERE at < datetime('now', '-90 day')");
  // Тесты: один раз напомнить тому, кого партнёр ждёт больше 48 часов (днём, не ночью)
  if (minutes >= 10 * 60 && minutes < 21 * 60) await remindStale().catch((e) => console.error("cron tests", e));

  for (const { pair_id, a, b } of fullPairs()) {
    const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", pair_id)!;
    const both = [a, b];
    const other = (u: UserRow) => (u.id === a.id ? b : a);

    // Капсулы времени — утром в день открытия
    if (minutes >= 9 * 60) {
      for (const cap of all<{ id: number; title: string; author_id: number }>(
        "SELECT id, title, author_id FROM capsules WHERE pair_id = ? AND open_at <= ? AND notified = 0",
        pair_id,
        date,
      )) {
        run("UPDATE capsules SET notified = 1 WHERE id = ?", cap.id);
        const author = both.find((u) => u.id === cap.author_id) ?? a;
        await sendTo(other(author).id, `💌 <b>Открылась капсула от ${esc(genitive(displayName(author)))}</b>\n\n«${esc(cap.title)}»\n\nПисьмо ждало этого дня 🕰`, { text: "Прочитать", go: "capsules" });
        await sendTo(author.id, `💌 Твоя капсула «${esc(cap.title)}» сегодня открылась 🕰`, { text: "Капсулы", go: "capsules" });
        changed(pair_id, "capsules");
      }
    }

    // Вопрос дня — в полдень тем, кто ещё не ответил
    if (minutes >= 12 * 60 && minutes < 22 * 60) {
      const q = questionFor(pair_id, date);
      if (q) {
        for (const u of both) {
          const answered = get("SELECT 1 FROM daily_answers WHERE pair_id = ? AND date = ? AND user_id = ?", pair_id, date, u.id);
          if (!answered && !mutes(u, "daily") && !hides(u, "daily")) await once(`daily:${u.id}:${date}`, () => sendTo(u.id, `💬 <b>Вопрос дня</b>\n\n«${esc(q.text)}»\n\nОтветь, и откроется ответ ${esc(genitive(displayName(other(u))))} 👀`, { text: "Ответить", go: "daily" }));
        }
      }
    }

    // Дни рождения — за неделю, накануне и в сам день, со списком хотелок
    if (minutes >= 10 * 60) {
      for (const hero of both) {
        if (!hero.birthday) continue;
        const next = nextYearly(hero.birthday, date);
        const left = daysBetween(date, next);
        if (![0, 1, 7].includes(left)) continue;
        const friend = other(hero);
        const wishes = all<{ title: string; image: string | null }>(
          "SELECT title, image FROM wishes WHERE pair_id = ? AND owner_id = ? AND done_at IS NULL AND (reserved_by IS NULL OR reserved_by = ?) ORDER BY level DESC, id DESC LIMIT 3",
          pair_id, hero.id, friend.id,
        );
        const name = esc(genitive(displayName(hero)));
        const list = wishes.length ? `\n\n🎁 В хотелках:\n${wishes.map((w) => `• ${esc(w.title)}`).join("\n")}` : "";
        const text =
          left === 0 ? `🎂 <b>Сегодня день рождения ${name}!</b>\n\nНе забудь поздравить 🥳` :
          left === 1 ? `🎂 <b>Завтра день рождения ${name}</b>${list}` :
          `🎂 <b>Через неделю, ${dayMonth(next)}, день рождения ${name}</b>\n\nСамое время выбрать подарок${list}`;
        // Картинка главной хотелки: сразу видно, что дарить
        const pic = left > 0 ? wishes.find((w) => w.image)?.image : null;
        await once(`bday:${hero.id}:${next}:${left}`, () => sendTo(friend.id, text, { text: "Хотелки", go: "wishes" }, pic ? { url: pic } : null));
      }
    }

    // Годовщина и круглые даты в днях
    if (pair.together_since && minutes >= 9 * 60) {
      const days = daysBetween(pair.together_since, date) + 1;
      const isAnniversary = date.slice(5) === pair.together_since.slice(5) && date > pair.together_since;
      if (isAnniversary) {
        const n = Number(date.slice(0, 4)) - Number(pair.together_since.slice(0, 4));
        for (const u of both) await once(`anniv:${u.id}:${date}`, () => sendTo(u.id, `🥂 <b>Сегодня ${years(n)} вместе!</b>\n\nС годовщиной 💞`, { text: "Открыть", go: "home" }));
      } else if (DAY_MILESTONES.includes(days)) {
        for (const u of both) await once(`milestone:${u.id}:${days}`, () => sendTo(u.id, `✨ <b>Сегодня ${days}-й день вместе</b> 💞`, { text: "Открыть", go: "home" }));
      }
    }

    // Завтрашние события — вечером накануне
    if (minutes >= 20 * 60) {
      const tomorrow = addDays(date, 1);
      // Многодневное напоминаем в день начала, повторяющееся — в каждый свой день
      const events = all<{ id: number; title: string; start_min: number | null; date: string; repeat: string | null }>(
        "SELECT id, title, start_min, date, repeat FROM events WHERE pair_id = ? AND date <= ? AND yearly = 0 AND kind IN ('event','date','trip') ORDER BY start_min",
        pair_id, tomorrow,
      ).filter((e) => (e.repeat ? eventOn(e, tomorrow) : e.date === tomorrow));
      const shared = events.map((e) => `• ${e.start_min != null ? hhmm(e.start_min) + " " : ""}${esc(e.title)}`).join("\n");
      for (const u of both.filter((x) => !mutes(x, "tomorrow"))) {
        // Свои дела (маникюр, зал) — только их владельцу
        const own = personalOn(u, tomorrow).map((r) => `• ${hhmm(r.start)} ${esc(r.title)}`).join("\n");
        if (!shared && !own) continue;
        const text = `📅 <b>Завтра</b>\n\n${[shared, own && `🙋 Свои дела:\n${own}`].filter(Boolean).join("\n\n")}`;
        await once(`tomorrow:${u.id}:${tomorrow}`, () => sendTo(u.id, text, { text: "Календарь", go: "calendar" }));
      }
    }

    // Утренняя сводка в 8:30: чем занят день у обоих и когда окно
    if (minutes >= 8 * 60 + 30 && minutes < 11 * 60) {
      // Те же окна, что на главной: одно правило для бота и приложения
      const todayWin = windowsOn(a, b, date);
      for (const u of both) {
        if (mutes(u, "morning")) continue;
        const other = u.id === a.id ? b : a;
        const lines: string[] = [];
        // Весь учебный день, а не кусок до первой большой перемены: «занятия 8:30–15:30»
        // Личные дела называем по имени: «Маникюр 15:00–16:00», а не «занятия»
        const plan = (p: UserRow) => {
          const chunks = busyChunks(p, date, false);
          const own = personalOn(p, date).map((r) => `${esc(r.title)} ${hhmm(r.start)}–${hhmm(r.end)}`);
          const parts = [chunks.length ? `занятия ${chunks.map((c) => `${hhmm(c.start)}–${hhmm(c.end)}`).join(" и ")}` : "", ...own].filter(Boolean);
          return parts.length ? parts.join(", ") : "свободный день";
        };
        // Кто убрал у себя расписание, тому строки про пары и окна не нужны
        if (!hides(u, "schedule")) {
          lines.push(`🙋 У тебя: ${plan(u)}`);
          if (!hides(other, "schedule")) lines.push(`💗 У ${esc(genitive(displayName(other)))}: ${plan(other)}`);
          if (todayWin.length) lines.push(`💞 Вместе можно: ${todayWin.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`).join(", ")}`);
        }
        const due = all<{ title: string }>(
          "SELECT title FROM tasks WHERE pair_id = ? AND done_at IS NULL AND due <= ? AND (assignee_id = ? OR assignee_id IS NULL) LIMIT 4",
          pair_id, date, u.id,
        );
        if (due.length) lines.push(`✅ Дела на сегодня: ${due.map((d) => esc(d.title)).join(", ")}`);
        const evs = all<{ title: string; start_min: number | null; date: string; repeat: string | null }>(
          "SELECT title, start_min, date, repeat FROM events WHERE pair_id = ? AND date <= ? AND yearly = 0 AND COALESCE(status, 'accepted') != 'declined' ORDER BY start_min", pair_id, date,
        ).filter((e) => (e.repeat ? eventOn(e, date) : e.date === date));
        if (evs.length) lines.push(`📅 В календаре: ${evs.map((e) => `${e.start_min != null ? hhmm(e.start_min) + " " : ""}${esc(e.title)}`).join(", ")}`);
        if (!lines.length) continue;
        await once(`morning:${u.id}:${date}`, () => sendTo(u.id, `☀️ <b>Доброе утро!</b>\n\n${lines.join("\n")}`, { text: "Открыть", go: "home" }));
      }
    }

    // Воскресная сводка общих окон на неделю
    if (weekday === 7 && minutes >= 18 * 60) {
      const windows = pairWindows(a, b, 8, 120).filter((w) => w.date > date);
      if (windows.length) {
        const lines = windows.slice(0, 7).map((w) => `• ${humanDate(w.date, date)}: ${hhmm(w.start)}–${hhmm(w.end)}`);
        const text = `🗓 <b>Когда увидеться на этой неделе</b>\n\n${lines.join("\n")}\n\nЗови на свидание прямо из приложения 💞`;
        for (const u of both.filter((x) => !mutes(x, "weekly") && !hides(x, "schedule"))) await once(`weekly:${u.id}:${date}`, () => sendTo(u.id, text, { text: "Окна", go: "windows" }));
      }
    }
  }

  // Расписание РЭУ — раз в сутки под утро, и сразу, если давно не обновлялось
  const stale = all<UserRow>(
    "SELECT * FROM users WHERE rea_group IS NOT NULL AND (rea_synced_at IS NULL OR rea_synced_at < datetime('now', '-20 hours'))",
  );
  for (const u of stale) {
    if (minutes < 4 * 60 && u.rea_synced_at) continue; // ночью не дёргаем чужой сайт без нужды
    try {
      await syncUser(u.id, u.rea_group!);
      if (u.pair_id) changed(u.pair_id, "schedule");
    } catch (e) {
      console.error("rea sync", u.id, (e as Error).message);
      run("UPDATE users SET rea_synced_at = datetime('now', '-19 hours') WHERE id = ?", u.id); // повтор через час
    }
  }

  // Календари по ссылке (HSE App X, SmartLMS, Google…) — так же раз в сутки
  const icsStale = all<UserRow>(
    "SELECT * FROM users WHERE ics_url IS NOT NULL AND (ics_synced_at IS NULL OR ics_synced_at < datetime('now', '-20 hours'))",
  );
  for (const u of icsStale) {
    if (minutes < 4 * 60 && u.ics_synced_at) continue;
    try {
      const ok = await checkUrl(u.ics_url!);
      if ("error" in ok) throw new Error(ok.error);
      await syncIcs(u.id, ok.url);
      if (u.pair_id) changed(u.pair_id, "schedule");
    } catch (e) {
      console.error("ics sync", u.id, (e as Error).message);
      run("UPDATE users SET ics_synced_at = datetime('now', '-19 hours') WHERE id = ?", u.id);
    }
  }

  maybeRefreshRatings(minutes);
  refreshKpInBackground();

  // Копия базы раз в сутки в 3:30, хранится две недели
  if (minutes >= 3 * 60 + 30 && minutes < 4 * 60) {
    const dir = path.join(path.dirname(env.dbPath), "backup");
    const file = path.join(dir, `vdvoyom-${date}.db`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      for (const old of fs.readdirSync(dir).sort().slice(0, -14)) fs.rmSync(path.join(dir, old), { force: true });
    }
  }

  if (date >= MOMENTS_PURGE_FROM) purgeMoments();

  // Старые ключи напоминаний больше не нужны
  run("DELETE FROM sent WHERE created_at < datetime('now', '-60 days')");
}

/**
 * Альбом «Моменты» убран 08.10.2026: фото пар больше не храним. Уже загруженные
 * снимки удаляются через неделю, с 15.10.2026 (дата по Москве, как во всём cron).
 * Срабатывает один раз: пока в таблице moments есть строки. Стираются только
 * файлы из этих строк — вещи гардероба, фото идей и скриншоты отзывов лежат
 * рядом в том же photosDir и не трогаются. Сама таблица остаётся в schema.sql.
 */
export const MOMENTS_PURGE_FROM = "2026-10-15";

export function purgeMoments(): number {
  const rows = all<{ id: number; file: string }>("SELECT id, file FROM moments");
  if (!rows.length) return 0;
  const root = path.resolve(env.photosDir);
  let files = 0;
  for (const r of rows) {
    const full = path.resolve(root, r.file);
    // Только внутри photosDir: кривая строка не уведёт удаление за пределы папки
    if (!r.file || !full.startsWith(root + path.sep)) continue;
    try {
      if (fs.existsSync(full)) files++;
      fs.rmSync(full, { force: true });
    } catch (e) {
      console.error("моменты: файл не удалился", r.file, (e as Error).message);
    }
  }
  run("DELETE FROM moments WHERE id <= ?", Math.max(...rows.map((r) => r.id)));
  console.log(`моменты: альбом стёрт, строк ${rows.length}, файлов ${files}`);
  return rows.length;
}

// Рейтинги IMDb — раз в неделю под утро и сразу, если базы ещё нет. Качаются
// в фоне: минутный цикл напоминаний их не ждёт. Сорвалось — повтор через час.
let ratingsBusy = false;
let ratingsTried = 0;
function maybeRefreshRatings(minutes: number): void {
  const at = ratingsUpdatedAt();
  const old = !at || Date.now() - at.getTime() > 7 * 86_400_000;
  const night = minutes >= 4 * 60 && minutes < 6 * 60;
  if (ratingsBusy || !old || (at && !night) || Date.now() - ratingsTried < 3_600_000) return;
  ratingsBusy = true;
  ratingsTried = Date.now();
  refreshRatings()
    .then((n) => console.log(`imdb: рейтинги обновлены, ${n} фильмов и сериалов`))
    .catch((e) => console.error("imdb: рейтинги", (e as Error).message))
    .finally(() => (ratingsBusy = false));
}

// Оценки Кинопоиска — по 25 фильмов в минуту, пока не обновятся все, кому больше недели.
// Первый проход по каталогу занимает полчаса, дальше раз в неделю столько же.
let kpBusy = false;
function refreshKpInBackground(): void {
  if (kpBusy) return;
  kpBusy = true;
  refreshStaleKp()
    .catch((e) => console.error("кинопоиск", (e as Error).message))
    .finally(() => (kpBusy = false));
}

export function startCron(): void {
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (e) {
      console.error("tick", e);
    } finally {
      busy = false;
    }
  };
  setTimeout(loop, 5_000);
  setInterval(loop, 60_000);
}
