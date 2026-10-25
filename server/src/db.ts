import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.ts";

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
db.exec(fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8"));

// Новые колонки в уже существующих таблицах: в SQLite нет ADD COLUMN IF NOT EXISTS
// Возвращает true, если колонку только что добавили: тогда можно разово перенести старые данные.
function addColumn(table: string, column: string, def: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  return true;
}
// Задачи: список («дом», «покупки»…) и повтор (week, month)
addColumn("tasks", "list", "TEXT");
addColumn("tasks", "repeat", "TEXT");
// Занятость: пары, работа, репетиторство, спорт — у каждой свой цвет и значок
addColumn("schedule", "category", "TEXT NOT NULL DEFAULT 'class'");
// Свидание-приглашение: proposed → accepted | declined
addColumn("events", "status", "TEXT");
addColumn("events", "idea_item", "TEXT");
// Повтор события: week | month (ежегодное — прежнее поле yearly), 07.10.2026
addColumn("events", "repeat", "TEXT");
// Цель, которая считается сама: ideas_done, movies_done, wishes_done, dates
addColumn("goals", "auto", "TEXT");
// Оценка карточки по шкале 1–5: не хочу, не очень, норм, хочу, очень хочу.
// Старые свайпы «да/нет» становятся «хочу» и «не хочу».
addColumn("swipes", "score", "INTEGER");
db.exec("UPDATE swipes SET score = CASE liked WHEN 1 THEN 4 ELSE 1 END WHERE score IS NULL");
// Свои идеи: фото (закрытое, на томе пары), откуда взялась и ссылка на пост
addColumn("ideas", "photo", "TEXT");
addColumn("ideas", "source", "TEXT");
// Когда человек согласился на хранение данных (экран знакомства)
addColumn("users", "consent_at", "TEXT");
// Свой фильм из поиска: номер на Кинопоиске, чтобы спросить его оценку и дать прямую ссылку
addColumn("films", "kp", "INTEGER");
// Что человек убрал у себя: разделы приложения и напоминания бота (JSON-списки ключей)
addColumn("users", "hidden", "TEXT NOT NULL DEFAULT '[]'");
addColumn("users", "muted", "TEXT NOT NULL DEFAULT '[]'");
// «Вдвоём+»: до какого дня включительно оплачено (на пару, не на человека)
addColumn("pairs", "plus_until", "TEXT");
// Акция «год по цене восьми месяцев»: до какого момента (ISO, UTC) она действует у пары
addColumn("pairs", "offer_until", "TEXT");
// Запас до встречи: сколько минут после дел (и до них) нужно на дорогу и сборы.
// По умолчанию 0 — окно начинается ровно тогда, когда у обоих кончились дела
// (просьба 26.09.2026). Старая commute_min (45 по умолчанию) больше не читается.
addColumn("users", "gap_min", "INTEGER NOT NULL DEFAULT 0");
// Оплаты: чем платили (yookassa | stars), почта для чека и номер платежа телеграма
addColumn("payments", "method", "TEXT NOT NULL DEFAULT 'yookassa'");
addColumn("payments", "email", "TEXT");
addColumn("payments", "charge_id", "TEXT");
// Админка (28.09.2026): блокировка, когда человек последний раз заходил, отметка «отзыв учтён»
addColumn("users", "blocked_at", "TEXT");
addColumn("users", "seen_at", "TEXT");
addColumn("feedback", "done_at", "TEXT");
addColumn("feedback", "done_note", "TEXT");
// Капсула-сюрприз (отзыв #2, 28.09.2026): половинка не знает о письме, пока оно не откроется
addColumn("capsules", "secret", "INTEGER NOT NULL DEFAULT 0");
// Подписка календаря телефона (отзыв #4): личный секрет ссылки .ics
addColumn("users", "cal_token", "TEXT");
// Расписание из календаря по ссылке (HSE App X, SmartLMS, Google…): ссылка и время последней подтяжки
addColumn("users", "ics_url", "TEXT");
addColumn("users", "ics_synced_at", "TEXT");
// Откуда пришёл человек (11.10.2026): start_param первого входа — b_<код> блогера или любая
// другая метка, без pair_… и plus. Первое касание: потом не перезаписывается (track.ts, bot.ts).
// У пары — источник пригласившего, а если у него пусто, второго (pairs.ts).
addColumn("users", "source", "TEXT");
addColumn("pairs", "source", "TEXT");
// Когда в паре стало двое настоящих людей: от этого дня считаются «живы на 7-й и 14-й день»
if (addColumn("pairs", "paired_at", "TEXT")) {
  db.exec(`UPDATE pairs SET paired_at = (SELECT MAX(created_at) FROM users WHERE pair_id = pairs.id AND id > 0)
           WHERE (SELECT COUNT(*) FROM users WHERE pair_id = pairs.id AND id > 0) >= 2`);
}
// Цвет партнёра (11.10.2026): сервер всем новым ставит violet, и оба в паре выходили фиолетовыми.
// color_chosen: 0 — цвет по умолчанию, 1 — человек выбрал сам (или его выбрали за него
// в «половинке заранее»), 2 — назначил сервер при соединении пары. Отличить «не выбирал»
// от «выбрал violet» по одному цвету нельзя, поэтому отметку ставит триггер на любой
// UPDATE … SET color — так меняют цвет только экран знакомства и настройки (POST /me).
if (addColumn("users", "color_chosen", "INTEGER NOT NULL DEFAULT 0")) {
  // Кто прошёл знакомство, тот цвет уже отправлял сам
  db.exec("UPDATE users SET color_chosen = 1 WHERE onboarded = 1");
  // Разово: в парах с одинаковым цветом второй по времени прихода становится розовым
  // (или фиолетовым, если у обоих розовый)
  db.exec(`UPDATE users SET color = CASE color WHEN 'rose' THEN 'violet' ELSE 'rose' END, color_chosen = 2
           WHERE id > 0 AND pair_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM users o WHERE o.pair_id = users.pair_id AND o.id > 0 AND o.id != users.id AND o.color = users.color
               AND (o.created_at < users.created_at OR (o.created_at = users.created_at AND o.id < users.id)))`);
}
db.exec(`CREATE TRIGGER IF NOT EXISTS users_color_chosen AFTER UPDATE OF color ON users
         FOR EACH ROW WHEN NEW.color_chosen = OLD.color_chosen AND NEW.color_chosen != 1
         BEGIN UPDATE users SET color_chosen = 1 WHERE id = NEW.id; END`);

type Param = SQLInputValue | undefined | boolean;

const cache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// node:sqlite не принимает undefined и boolean — приводим сами, иначе
// забытое необязательное поле роняет запрос с невнятной ошибкой.
function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return stmt(sql).all(...norm(params)) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return stmt(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; id: number } {
  const r = stmt(sql).run(...norm(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
