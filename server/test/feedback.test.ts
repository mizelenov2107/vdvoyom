import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/db.ts";
import { env } from "../src/env.ts";
import { admin } from "../src/routes/admin.ts";

run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9601, 'Отзывчивая', 1)");
run("INSERT INTO feedback (user_id, kind, text, screen) VALUES (9601, 'design', 'Кнопка слишком яркая', 'Главная')");

test("/admin без ключа на сервере закрыт, с чужим ключом тоже", async () => {
  env.adminToken = "";
  assert.equal((await admin.request("/feedback", { headers: { authorization: "Bearer anything" } })).status, 404);
  env.adminToken = "right-key-for-tests-01";
  assert.equal((await admin.request("/feedback")).status, 404);
  assert.equal((await admin.request("/feedback", { headers: { authorization: "Bearer wrong-key-for-tests-01" } })).status, 404);
});

test("/admin с ключом отдаёт отзывы с автором и видом, ответ уходит автору", async () => {
  env.adminToken = "right-key-for-tests-01";
  const auth = { authorization: "Bearer right-key-for-tests-01" };
  const r = await admin.request("/feedback?limit=5", { headers: auth });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { total: number; unanswered: number; items: { id: number; kind: string; author: string; text: string }[] };
  const mine = body.items.find((i) => i.text === "Кнопка слишком яркая")!;
  assert.equal(mine.kind, "🎨 Дизайн");
  assert.equal(mine.author, "Отзывчивая");
  assert.ok(body.unanswered >= 1);
  const reply = await admin.request(`/feedback/${mine.id}/reply`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ text: "Спасибо, приглушим" }) });
  assert.equal(reply.status, 200);
  const after = (await (await admin.request("/feedback?limit=5", { headers: auth })).json()) as { items: { id: number; reply: string | null }[] };
  assert.equal(after.items.find((i) => i.id === mine.id)?.reply, "Спасибо, приглушим");
});
