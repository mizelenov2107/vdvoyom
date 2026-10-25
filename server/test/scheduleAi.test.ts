import { test } from "node:test";
import assert from "node:assert/strict";
import { all, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import { layoutText, onlyRows, recognizeSchedule, spentThisMonth } from "../src/scheduleAi.ts";

const box = (x: number, y: number, w = 80, h = 20) => ({ vertices: [{ x: String(x), y: String(y) }, { x: String(x + w), y: String(y + h) }] });

test("OCR: строки таблицы собираются по высоте и идут слева направо", () => {
  const a = {
    result: {
      textAnnotation: {
        fullText: "перемешано",
        blocks: [
          { lines: [{ text: "Понедельник", boundingBox: box(10, 10) }, { text: "Вторник", boundingBox: box(10, 60) }] },
          { lines: [{ text: "09:30-10:50", boundingBox: box(200, 12) }, { text: "11:10-12:30", boundingBox: box(200, 62) }] },
          { lines: [{ text: "Матанализ", boundingBox: box(400, 9) }, { text: "Линал", boundingBox: box(400, 61) }] },
        ],
      },
    },
  };
  assert.equal(layoutText(a), "Понедельник | 09:30-10:50 | Матанализ\nВторник | 11:10-12:30 | Линал");
});

test("OCR: таблица из модели table — по ячейкам", () => {
  const a = { textAnnotation: { tables: [{ cells: [{ text: "пн", rowIndex: "0", columnIndex: "0" }, { text: "09:30", rowIndex: "0", columnIndex: "1" }, { text: "вт", rowIndex: "1", columnIndex: "0" }] }] } };
  assert.match(layoutText(a), /^пн \| 09:30\nвт/);
});

test("ответ модели: только строки с « | », без обёрток и пояснений", () => {
  assert.equal(onlyRows("Вот расписание:\n```\nпн | 09:30-10:50 | Матан | пара | R405\n```\nУдачи!"), "пн | 09:30-10:50 | Матан | пара | R405");
});

test("распознавание: фото → OCR → модель; споткнулся разбор — одна попытка исправить; деньги записаны", async () => {
  env.yandexApiKey = "test-key";
  env.yandexFolder = "b1gtest";
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9901, 'Расписание', 1)");
  const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const answers = [
    "пн | 9:30 | Матанализ | пара |\nвт | непонятно | Линал | пара |", // обе строки с ошибками
    "пн | 09:30-10:50 | Матанализ | пара | R405\nвт | 11:10-12:30 | Линал | пара | D501",
  ];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, auth: (init.headers as Record<string, string>).Authorization });
    if (url.includes("ocr")) return new Response(JSON.stringify({ result: { textAnnotation: { fullText: "пн 9:30 Матанализ" } } }));
    return new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() } }], usage: { prompt_tokens: 1500, completion_tokens: 500 } }));
  }) as unknown as typeof fetch;

  const before = spentThisMonth();
  const r = await recognizeSchedule({ images: [{ buf: Buffer.from([0xff, 0xd8, 0xff]), mime: "image/jpeg" }], text: "" }, "2026-09-28", "понедельник", 9901, fetcher);
  assert.equal(r.entries, 2);
  assert.equal(r.errors, 0, "взят исправленный ответ");
  assert.equal(calls.length, 3, "OCR и две попытки модели");
  assert.equal(calls[0].auth, "Api-Key test-key");
  assert.equal(calls[1].body.model, "gpt://b1gtest/yandexgpt/latest");
  // 0,1321 ₽ за картинку + 3000 токенов на входе и 1000 на выходе по 0,40 ₽
  const row = all<{ pages: number; tokens_in: number; tokens_out: number; rub: number }>("SELECT * FROM ai_usage WHERE user_id = 9901")[0];
  assert.deepEqual([row.pages, row.tokens_in, row.tokens_out], [1, 3000, 1000]);
  assert.equal(row.rub, 1.73);
  assert.ok(Math.abs(spentThisMonth() - before - 1.73) < 0.001);
});
