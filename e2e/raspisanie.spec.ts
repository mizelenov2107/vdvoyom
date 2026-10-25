// Расписание из чата с ИИ: вставили ответ — предпросмотр — загрузка.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

const ANSWER = `Вот ваше расписание:
ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ
пн | 09:30-10:50 | Линал e2e | пара | R405
вт,чт | 19:00-21:00 | Работа e2e | работа |
сб | утром | Бассейн | спорт |`;

test("вставить ответ чата и загрузить расписание", async ({ page }) => {
  await open(page, 2, "&go=schedule");
  await page.getByRole("button", { name: /Расписание (из чата с ИИ|по фото)/ }).click();
  // Своего чата с ИИ хватает и при встроенном распознавании: подсказка — под «Или через свой чат»
  await sheet(page).getByText(/Или через свой чат с ИИ/).click();
  await expect(sheet(page).getByRole("button", { name: /Скопировать/ })).toBeVisible();
  await sheet(page).locator("textarea").last().fill(ANSWER);
  await expect(sheet(page).getByText(/Нашлось 3 занятия/)).toBeVisible();
  await expect(sheet(page).getByText(/не понял время/)).toBeVisible();
  await sheet(page).getByRole("button", { name: /Загрузить 3 занятия/ }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByText("Линал e2e")).toBeVisible();
  await expect(page.getByText("Работа e2e").first()).toBeVisible();
});

// Встроенное распознавание (28.09.2026): в тестах AI_FAKE=1 — Яндекс не вызывается,
// приходит готовый ответ; проверяется путь от снимка до сохранённых пар.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("расписание по скриншоту: распознать, проверить, сохранить", async ({ page }, info) => {
  const who = info.project.name === "iphone" ? 7 : 5;
  await open(page, who, "&go=schedule");
  await page.getByRole("button", { name: /Расписание по фото или скриншоту/ }).click();
  await expect(sheet(page).getByRole("button", { name: /Сфотографировать/ })).toBeVisible();
  await sheet(page).locator('input[type="file"][multiple]').setInputFiles({ name: "rasp.png", mimeType: "image/png", buffer: PNG });
  // «вт,чт» — два занятия: всего четыре
  await expect(sheet(page).getByText(/Нашлось 4 занятия/)).toBeVisible({ timeout: 15_000 });
  await expect(sheet(page).locator("textarea").first()).toHaveValue(/Матанализ, лекция/);
  await sheet(page).getByRole("button", { name: /Загрузить 4 занятия/ }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByText("Матанализ, лекция").first()).toBeVisible();
});

test("календарь по ссылке: блок виден, плохая ссылка — понятная ошибка", async ({ page }) => {
  await open(page, 2, "&go=schedule");
  await page.getByRole("button", { name: /Вышка, SmartLMS или свой календарь/ }).click();
  await expect(sheet(page).getByText(/HSE App X на айфоне/)).toBeVisible();
  await sheet(page).getByRole("textbox", { name: "Ссылка на календарь" }).fill("http://localhost/rasp.ics");
  await sheet(page).getByRole("button", { name: "Подключить" }).click();
  await expect(page.getByText("Нужна ссылка https:// или webcal://")).toBeVisible();
});
