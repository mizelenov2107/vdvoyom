// Цвет партнёров (11.10.2026): сервер всем новым ставил violet, и оба в паре выходили
// фиолетовыми. Теперь при соединении пары тот, кто цвет не выбирал, получает другой.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { get, run } from "../src/db.ts";
import { upsertUser } from "../src/auth.ts";
import { ensurePair, joinPair, otherColor } from "../src/pairs.ts";

type C = { color: string; color_chosen: number };
const colorOf = (id: number) => ({ ...get<C>("SELECT color, color_chosen FROM users WHERE id = ?", id)! });
const pick = (id: number, color: string) => run("UPDATE users SET color = ? WHERE id = ?", color, id); // так меняет POST /me
const invite = (id: number) => ensurePair(id).invite_code;

test("новый человек — violet и «не выбирал»; выбор цвета ставит отметку, даже если это тот же violet", () => {
  const u = upsertUser({ id: 7301, first_name: "Аня" });
  assert.equal(u.color, "violet");
  assert.equal(colorOf(7301).color_chosen, 0);
  pick(7301, "violet");
  assert.deepEqual(colorOf(7301), { color: "violet", color_chosen: 1 });
  // Повторный вход не сбрасывает ни цвет, ни отметку
  upsertUser({ id: 7301, first_name: "Аня" });
  assert.deepEqual(colorOf(7301), { color: "violet", color_chosen: 1 });
});

test("второй по приглашению не выбирал цвет — становится розовым", () => {
  upsertUser({ id: 7311, first_name: "Он" });
  pick(7311, "violet");
  const code = invite(7311);
  upsertUser({ id: 7312, first_name: "Она" });
  const r = joinPair(7312, code);
  assert.equal(r.ok, true);
  assert.deepEqual(colorOf(7312), { color: "rose", color_chosen: 2 });
  assert.equal(colorOf(7311).color, "violet");
  // Потом выбрала сама — отметка «выбрала»
  pick(7312, "sky");
  assert.deepEqual(colorOf(7312), { color: "sky", color_chosen: 1 });
});

test("у пригласившего розовый — второй, не выбиравший, остаётся фиолетовым", () => {
  upsertUser({ id: 7321, first_name: "А" });
  pick(7321, "rose");
  const code = invite(7321);
  upsertUser({ id: 7322, first_name: "Б" });
  joinPair(7322, code);
  assert.equal(colorOf(7322).color, "violet");
  assert.equal(colorOf(7321).color, "rose");
});

test("второй сам выбрал тот же цвет, а пригласивший не выбирал — перекрашивается пригласивший", () => {
  upsertUser({ id: 7331, first_name: "А" });
  const code = invite(7331); // цвет по умолчанию, знакомство не пройдено
  upsertUser({ id: 7332, first_name: "Б" });
  pick(7332, "violet");
  joinPair(7332, code);
  assert.equal(colorOf(7332).color, "violet");
  assert.deepEqual(colorOf(7331), { color: "rose", color_chosen: 2 });
});

test("оба выбрали один цвет сами — не трогаем", () => {
  upsertUser({ id: 7341, first_name: "А" });
  pick(7341, "mint");
  const code = invite(7341);
  upsertUser({ id: 7342, first_name: "Б" });
  pick(7342, "mint");
  joinPair(7342, code);
  assert.equal(colorOf(7341).color, "mint");
  assert.equal(colorOf(7342).color, "mint");
});

test("ответ joinPair отдаёт партнёра уже с новым цветом", () => {
  upsertUser({ id: 7351, first_name: "А" });
  const code = invite(7351);
  upsertUser({ id: 7352, first_name: "Б" });
  pick(7352, "violet");
  const r = joinPair(7352, code);
  assert.equal(r.partner?.color, "rose");
  assert.equal(otherColor("rose"), "violet");
  assert.equal(otherColor("sky"), "rose");
});

test("разовая миграция: в старых парах с одинаковым цветом второй по приходу — розовый", () => {
  const dir = fs.mkdtempSync("/tmp/vdvoyom-cvet-");
  const file = path.join(dir, "old.db");
  // База «как до 11.10»: схема без новых колонок, две пары
  const old = new DatabaseSync(file);
  old.exec(fs.readFileSync(path.join(import.meta.dirname, "..", "src", "schema.sql"), "utf8"));
  old.exec(`
    INSERT INTO pairs (id, invite_code) VALUES (1, 'a1'), (2, 'b2'), (3, 'c3');
    INSERT INTO users (id, first_name, color, pair_id, onboarded, created_at) VALUES
      (11, 'Первый', 'violet', 1, 1, '2026-10-01 10:00:00'), (12, 'Вторая', 'violet', 1, 1, '2026-10-02 10:00:00'),
      (21, 'Первая', 'rose', 2, 1, '2026-10-01 10:00:00'), (22, 'Второй', 'rose', 2, 1, '2026-10-03 10:00:00'),
      (31, 'Свой', 'sky', 3, 1, '2026-10-01 10:00:00'), (32, 'Своя', 'mint', 3, 0, '2026-10-03 10:00:00'), (-3, 'Заготовка', 'sky', 3, 1, '2026-10-01 10:00:00');
  `);
  old.close();
  execFileSync(process.execPath, ["-e", "await import('./src/db.ts')"], {
    cwd: path.join(import.meta.dirname, ".."),
    env: { ...process.env, DB_PATH: file },
  });
  const db = new DatabaseSync(file);
  const c = (id: number) => ({ ...(db.prepare("SELECT color, color_chosen FROM users WHERE id = ?").get(id) as C) });
  assert.equal(c(11).color, "violet");
  assert.deepEqual({ ...c(12) }, { color: "rose", color_chosen: 2 });
  assert.equal(c(21).color, "rose");
  assert.equal(c(22).color, "violet");
  assert.equal(c(31).color, "sky");
  assert.equal(c(32).color, "mint");
  assert.equal(c(-3).color, "sky", "заготовку половинки миграция не трогает");
  assert.equal(c(31).color_chosen, 1, "прошёл знакомство — значит, выбирал");
  assert.equal(c(32).color_chosen, 0);
  // Пара сложилась — день прихода второго
  assert.equal((db.prepare("SELECT paired_at FROM pairs WHERE id = 1").get() as { paired_at: string }).paired_at, "2026-10-02 10:00:00");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
