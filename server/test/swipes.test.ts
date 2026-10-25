import { test } from "node:test";
import assert from "node:assert/strict";
import { isMatch } from "../src/routes/fun.ts";

test("мэтч — обоим хотя бы «норм», кому-то «хочу» и выше", () => {
  assert.equal(isMatch(4, 4), true);
  assert.equal(isMatch(3, 5), true);
  assert.equal(isMatch(3, 3), false, "два «норм» — ещё не желание");
  assert.equal(isMatch(2, 5), false, "«не очень» у одного — не мэтч");
  assert.equal(isMatch(1, 5), false);
});
