import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../src/auth.ts";

const TOKEN = "123456:TEST";

function sign(fields: Record<string, string>): string {
  const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = Date.now();
const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id: 42, first_name: "Эля" }), start_param: "pair_abc" };

test("верная подпись принимается", () => {
  const r = verifyInitData(sign(fields), TOKEN, 3600, now);
  assert.equal(r?.user.id, 42);
  assert.equal(r?.startParam, "pair_abc");
});

test("подделанный пользователь отклоняется", () => {
  const raw = sign(fields).replace("%22id%22%3A42", "%22id%22%3A43");
  assert.equal(verifyInitData(raw, TOKEN, 3600, now), null);
});

test("чужой токен и просрочка отклоняются", () => {
  assert.equal(verifyInitData(sign(fields), "999:OTHER", 3600, now), null);
  assert.equal(verifyInitData(sign(fields), TOKEN, 60, now + 3600_000), null);
});
