// Отзывы закрытого теста: «Ещё» → «Написать отзыв», вид отзыва, текст, скриншот — и запись в базе.
// 11.10.2026: плавающей кнопки «Отзыв» больше нет — она лежала поверх живых кнопок экранов.
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

// Настоящая картинка 1×1: shrink() на телефоне её перекодирует, пустышку он бы не открыл
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("отзыв из «Ещё»: дизайн, текст и скриншот доходят до базы", async ({ page }, info) => {
  await open(page, 1, "&go=more");
  await page.getByText("Написать отзыв").click();
  const s = sheet(page);
  await expect(s.getByText("Что исправить?")).toBeVisible();
  await s.getByRole("radio", { name: "🎨 Дизайн" }).click();
  await expect(s.getByRole("textbox", { name: "Текст отзыва" })).toHaveAttribute("placeholder", /Какой экран/);
  const text = `Слишком много плашек на главной (${info.project.name} ${Date.now()})`;
  await s.getByRole("textbox", { name: "Текст отзыва" }).fill(text);
  await s.locator('input[type="file"]').setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG });
  await expect(s.getByRole("img", { name: "Скриншот 1" })).toBeVisible();
  await s.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText(/Спасибо! Прочитаем/)).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);

  // Своя копия конфига (issledovanie/…/playwright.config.ts) кладёт базу в другое место
  const db = new DatabaseSync(process.env.E2E_DB ?? "/tmp/vdvoyom-e2e.db", { readOnly: true });
  const row = db.prepare("SELECT kind, screen, photos FROM feedback WHERE text = ?").get(text) as { kind: string; screen: string; photos: string } | undefined;
  db.close();
  expect(row?.kind).toBe("design");
  expect(row?.screen).toBe("Ещё");
  expect(JSON.parse(row!.photos)).toHaveLength(1);
});

test("плавающей «Отзыв» нет ни на одной вкладке — ничего не перекрывает", async ({ page }) => {
  await open(page, 1);
  for (const tab of ["Главная", "Календарь", "Хотелки", "Ещё"]) {
    await page.locator(".tabbar").getByText(tab, { exact: true }).click();
    await expect(page.getByRole("button", { name: "Отзыв", exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("Написать отзыв")).toBeVisible();
});
