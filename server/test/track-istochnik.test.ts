// Источник прихода (11.10.2026): ссылки блогеров ?startapp=b_<код> и /start b_<код>.
// Первое касание у человека, у пары — от пригласившего, а если у него пусто, от второго.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { get } from "../src/db.ts";
import { env } from "../src/env.ts";
import type { AppEnv } from "../src/http.ts";
import { apiGate, isNewUser, normSource, setSource } from "../src/track.ts";
import { launchFromHeader } from "../src/auth.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";

env.devAuth = true;
const sub = new Hono<AppEnv>();
sub.get("/me", (c) => c.json({ ok: true }));
const api = new Hono<AppEnv>();
api.use("*", apiGate);
api.route("/", sub);
const app = new Hono();
app.route("/api", api);

const open = (id: number, start?: string) =>
  app.request("/api/me", { headers: { authorization: `dev ${id}:${encodeURIComponent(`Тест${id}`)}${start !== undefined ? `:${encodeURIComponent(start)}` : ""}` } });
const sourceOf = (id: number) => get<{ source: string | null }>("SELECT source FROM users WHERE id = ?", id)?.source ?? null;
const pairSource = (id: number) => get<{ source: string | null }>("SELECT p.source FROM pairs p JOIN users u ON u.pair_id = p.id WHERE u.id = ?", id)?.source ?? null;

test("нормализация метки: только [a-z0-9_-], до 32 символов; pair_, plus и paysupport — не источник", () => {
  assert.equal(normSource("b_anya"), "b_anya");
  assert.equal(normSource("B_Anya!"), "b_anya");
  assert.equal(normSource("  tiktok-oct "), "tiktok-oct");
  assert.equal(normSource("b_" + "x".repeat(60)), "b_" + "x".repeat(30));
  assert.equal(normSource("b_ник🙂"), null, "от метки блогера остался один префикс");
  assert.equal(normSource("b_ник_ok"), "b__ok");
  assert.equal(normSource("ру"), null, "после чистки пусто");
  assert.equal(normSource("pair_abc"), null);
  assert.equal(normSource("plus"), null);
  assert.equal(normSource("paysupport"), null);
  assert.equal(normSource(null), null);
  assert.equal(normSource(""), null);
});

test("dev-вход передаёт start_param третьей частью, как телеграм в initData", () => {
  assert.equal(launchFromHeader("dev 5:Аня:b_anya")?.startParam, "b_anya");
  assert.equal(launchFromHeader(`dev 5:${encodeURIComponent("А:я")}`)?.user.first_name, "А:я");
  assert.equal(launchFromHeader("dev 5:Аня")?.startParam, null);
});

test("первый вход по ссылке блогера записывает источник, следующий с другой меткой — нет", async () => {
  await open(7101, "b_Anya");
  assert.equal(sourceOf(7101), "b_anya");
  await open(7101, "b_other");
  assert.equal(sourceOf(7101), "b_anya", "первое касание не перезаписывается");
});

test("уже знакомый человек по ссылке блогера источник не получает", async () => {
  await open(7102);
  assert.equal(sourceOf(7102), null);
  await open(7102, "b_late");
  assert.equal(sourceOf(7102), null);
});

test("любая другая метка тоже источник, pair_ и plus — нет", async () => {
  await open(7103, "reels_oct-1");
  assert.equal(sourceOf(7103), "reels_oct-1");
  await open(7104, "pair_abcdef");
  assert.equal(sourceOf(7104), null);
  await open(7105, "plus");
  assert.equal(sourceOf(7105), null);
});

test("бот: /start b_<код> у нового — источник (та же setSource, что в bot.ts)", () => {
  // bot.command("start") без токена не регистрируется — проверяем его шаги
  assert.equal(isNewUser(7106), true);
  get("INSERT INTO users (id, first_name, chat_ok) VALUES (7106, 'Бот', 1) RETURNING id");
  assert.equal(setSource(7106, "b_blog"), "b_blog");
  assert.equal(sourceOf(7106), "b_blog");
  setSource(7106, "b_second");
  assert.equal(sourceOf(7106), "b_blog");
  assert.equal(setSource(7106, "paysupport"), null);
});

test("пара: источник пригласившего; новое пространство берёт его сразу", async () => {
  await open(7111, "b_inviter");
  const code = ensurePair(7111).invite_code;
  assert.equal(pairSource(7111), "b_inviter");
  await open(7112, "b_joiner");
  joinPair(7112, code);
  assert.equal(pairSource(7112), "b_inviter");
  assert.equal(pairSource(7111), "b_inviter");
});

test("пара: у пригласившего пусто — источник второго", async () => {
  await open(7121);
  const code = ensurePair(7121).invite_code;
  assert.equal(pairSource(7121), null);
  await open(7122, "b_second");
  ensurePair(7122); // своё пространство до соединения — оно исчезнет
  joinPair(7122, code);
  assert.equal(pairSource(7121), "b_second");
  assert.ok(get("SELECT paired_at FROM pairs WHERE id = (SELECT pair_id FROM users WHERE id = 7121)")?.paired_at);
});
