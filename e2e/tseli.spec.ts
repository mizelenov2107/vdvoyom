// Цели: отметка через счётчик «− N +» и удаление отметки из истории.
// Регрессия 26.09.2026: цифра в поле не рисовалась, удалить отметку было не во что нажать.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("поставить цель, отметить +2 и удалить отметку", async ({ page }) => {
  await open(page, 1, "&go=goals");
  await expect(page.locator(".spinner")).toHaveCount(0);
  const card = page.locator(".card", { hasText: "Встретить 5 рассветов" });
  if (!(await card.count())) {
    // Готовые цели — плитки: на пустом экране сразу, иначе в шторке «Новая цель»
    const tile = page.locator(".tile", { hasText: "Встретить 5 рассветов" });
    if (!(await tile.count())) await page.getByRole("button", { name: "Новая цель" }).click();
    await page.locator(".tile", { hasText: "Встретить 5 рассветов" }).first().click();
    await expect(card.first()).toBeVisible();
  }
  await card.first().click();
  const s = sheet(page);
  await expect(s.getByText("Встретить 5 рассветов")).toBeVisible();

  await s.getByRole("button", { name: "Больше" }).click();
  await expect(s.getByRole("textbox", { name: "Сколько отметить" })).toHaveValue("2");
  await s.getByRole("button", { name: /Отметить \+2/ }).click();
  await expect(s.getByText("ты +2")).toBeVisible();

  await s.getByRole("button", { name: "Удалить отметку ты +2" }).click();
  await expect(s.getByText("ты +2")).toHaveCount(0);
});
