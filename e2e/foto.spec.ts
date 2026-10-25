// Альбом «Моменты» убран 08.10.2026: фото пар больше не храним (раньше здесь
// проверялось «Сохранить на телефон» для снимка из альбома). Теперь проверяем,
// что входа в альбом нигде нет, а сервер не принимает загрузку.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("альбома «Моменты» нет: ни на главной, ни в «Ещё», ни в поиске, ни в настройках", async ({ page }, info) => {
  const who = info.project.name === "iphone" ? 23 : 21;
  await open(page, who);
  await expect(page.getByText("Ваш фотоальбом")).toHaveCount(0);
  await expect(page.getByText("В этот день")).toHaveCount(0);

  await open(page, who, "&go=more");
  await expect(page.locator(".tile", { hasText: "Что надеть" })).toBeVisible();
  await expect(page.locator(".tile", { hasText: "Моменты" })).toHaveCount(0);

  await page.getByRole("button", { name: "Поиск" }).click();
  await sheet(page).getByRole("searchbox", { name: "Что найти" }).fill("альбом");
  await expect(sheet(page).getByText("Моменты")).toHaveCount(0);

  await open(page, who, "&go=settings");
  await expect(page.locator(".section .caps").first()).toHaveText("Разделы");
  await expect(page.getByText("общий фотоальбом")).toHaveCount(0);

  // Старая ссылка из бота ?go=moments ничего не открывает и не ломает приложение
  await open(page, who, "&go=moments");
  await expect(page.locator(".screen.pushed")).toHaveCount(0);
});

test("сервер не принимает фото в альбом", async ({ request }) => {
  // Отдельный человек: заголовок dev переписывает имя, у сидовых людей его не трогаем
  const headers = { authorization: `dev 977:${encodeURIComponent("Проверка")}` };
  const up = await request.post("http://localhost:3100/api/moments", {
    headers,
    multipart: { file: { name: "kusk.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]) } },
  });
  expect(up.status(), "загрузки в альбом больше нет").toBe(404);
  const list = await request.get("http://localhost:3100/api/moments", { headers });
  expect(list.headers()["content-type"] ?? "", "списка фото больше нет").not.toContain("application/json");
});
