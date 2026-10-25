import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { createGhost, ensurePair, joinPair, partnerOf, wipePair } from "../src/pairs.ts";
import type { PairRow, UserRow } from "../src/model.ts";

const user = (id: number) => get<UserRow>("SELECT * FROM users WHERE id = ?", id)!;
const mk = (id: number, name: string) =>
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (?, ?, 1)", id, name);

test("регистрация, заготовка половинки и вход по приглашению", () => {
  mk(9001, "Миша");
  const pair = ensurePair(9001);
  const ghost = createGhost(pair.id, { name: "Алина", color: "rose" });
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min) VALUES (?, 'weekly', 2, 600, 700)", ghost.id);
  run("INSERT INTO swipes (pair_id, user_id, deck, item, liked) VALUES (?, ?, 'idea', 'g:kuskovo', 1)", pair.id, ghost.id);

  // Она заходит сама и у неё уже есть своё пустое пространство
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9002, 'Эля', 0)");
  ensurePair(9002);
  const r = joinPair(9002, pair.invite_code);
  assert.equal(r.ok, true);
  const alina = user(9002);
  assert.equal(alina.pair_id, pair.id);
  assert.equal(alina.name, "Алина", "имя из заготовки, раз она ещё не представилась");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM schedule WHERE user_id = 9002")!.n, 1);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM swipes WHERE user_id = 9002")!.n, 1);
  assert.equal(get("SELECT 1 FROM users WHERE id = ?", ghost.id), undefined, "заготовка удалена");
  assert.equal(partnerOf(user(9001))?.id, 9002);
});

test("третий по той же ссылке не попадает", () => {
  mk(9003, "Лишний");
  const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", user(9001).pair_id)!;
  assert.equal(joinPair(9003, pair.invite_code).ok, false);
});

test("своя ссылка не соединяет с самим собой", () => {
  mk(9010, "Один");
  const p = ensurePair(9010);
  const r = joinPair(9010, p.invite_code);
  assert.equal(r.ok, false);
});

test("стирание пространства убирает всё общее", () => {
  mk(9020, "Соло");
  const p = ensurePair(9020);
  run("INSERT INTO tasks (pair_id, author_id, title) VALUES (?, 9020, 'купить хлеб')", p.id);
  createGhost(p.id, { name: "Кто-то" });
  wipePair(p.id);
  assert.equal(get("SELECT 1 FROM pairs WHERE id = ?", p.id), undefined);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE pair_id = ?", p.id)!.n, 0);
  assert.equal(user(9020).pair_id, null);
});

test("повторный вход по той же ссылке не считается новым соединением", () => {
  const pair = get<PairRow>("SELECT * FROM pairs WHERE id = ?", user(9001).pair_id)!;
  const again = joinPair(9002, pair.invite_code);
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
});
