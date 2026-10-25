import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Альбом «Моменты» убран 08.10.2026, старые фото стираются разово с 15.10.2026.
// Своя временная база и своя папка фото: общую тестовую базу и /tmp/photos не трогаем.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdvoyom-moments-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.PHOTOS_DIR = path.join(tmp, "photos");

const { get, run } = await import("../src/db.ts");
const { ensurePair } = await import("../src/pairs.ts");
const { tick, MOMENTS_PURGE_FROM } = await import("../src/cron.ts");
const { env } = await import("../src/env.ts");

const put = (name: string) => {
  const full = path.join(env.photosDir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  return full;
};
const n = (sql: string) => get<{ n: number }>(sql)!.n;
// 12:00 по Москве в этот день
const noon = (d: string) => Date.parse(`${d}T09:00:00Z`);

test("чистка альбома: до 15.10 ничего, потом только файлы моментов", async (t) => {
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.equal(env.photosDir, path.join(tmp, "photos"), "фото — во временной папке");
  assert.equal(MOMENTS_PURGE_FROM, "2026-10-15");

  // Один человек в паре: fullPairs пустой, бот никому не пишет
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9501, 'Альбом', 1)");
  const pairId = ensurePair(9501).id;
  const m1 = put(`${pairId}/m1abc.jpg`);
  const m2 = put(`${pairId}/m2abc.jpg`);
  const ward = put(`${pairId}/wvesch.jpg`);
  const shot = put("feedback/9501-shot.jpg");
  run("INSERT INTO moments (pair_id, author_id, date, file) VALUES (?, 9501, '2026-09-01', ?), (?, 9501, '2026-09-02', ?)", pairId, `${pairId}/m1abc.jpg`, pairId, `${pairId}/m2abc.jpg`);
  // Строка с путём наружу и строка без файла: ни ошибки, ни удаления за пределами папки
  const outside = path.join(tmp, "nelzya.jpg");
  fs.writeFileSync(outside, "x");
  run("INSERT INTO moments (pair_id, author_id, date, file) VALUES (?, 9501, '2026-09-03', '../nelzya.jpg'), (?, 9501, '2026-09-04', ?)", pairId, pairId, `${pairId}/netu.jpg`);
  run("INSERT INTO wardrobe (pair_id, owner_id, file, category, color, color_name) VALUES (?, 9501, ?, 'top', '#fff', 'белый')", pairId, `${pairId}/wvesch.jpg`);

  // 14.10 — ещё рано
  await tick(noon("2026-10-14"));
  assert.equal(n("SELECT COUNT(*) n FROM moments"), 4, "строки на месте");
  for (const f of [m1, m2, ward, shot]) assert.ok(fs.existsSync(f), `${path.basename(f)} на месте`);

  // 15.10 — альбом стирается
  await tick(noon("2026-10-15"));
  assert.equal(n("SELECT COUNT(*) n FROM moments"), 0, "строк моментов больше нет");
  assert.ok(!fs.existsSync(m1) && !fs.existsSync(m2), "фото моментов удалены");
  assert.ok(fs.existsSync(ward), "вещь гардероба цела");
  assert.equal(n("SELECT COUNT(*) n FROM wardrobe"), 1, "строка гардероба цела");
  assert.ok(fs.existsSync(shot), "скриншот отзыва цел");
  assert.ok(fs.existsSync(outside), "за пределами photosDir ничего не удаляется");

  // Разово: на следующий день новых удалений нет, гардероб по-прежнему цел
  await tick(noon("2026-10-16"));
  assert.ok(fs.existsSync(ward) && fs.existsSync(shot));
});
