// Настройки: разделы по выбору и запас до встречи.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("«Разделы» — первый блок настроек, выключенный раздел пропадает с главной и из «Ещё»", async ({ page }) => {
  await open(page, 1, "&go=settings");
  await expect(page.locator(".section .caps").first()).toHaveText("Разделы");
  const row = page.locator(".row", { hasText: "к чему идёте вместе" });
  const sw = row.getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");

  await open(page, 1);
  await expect(page.getByText("Наши цели")).toHaveCount(0);
  await open(page, 1, "&go=more");
  await expect(page.locator(".tile", { hasText: "Цели" })).toHaveCount(0);

  // Вернуть раздел
  await open(page, 1, "&go=settings");
  await page.locator(".row", { hasText: "к чему идёте вместе" }).getByRole("switch").click();
  await open(page, 1, "&go=more");
  await expect(page.locator(".tile", { hasText: "Цели" })).toBeVisible();
});

test("запас до встречи: по умолчанию без запаса, меняется прямо в «Когда свободны»", async ({ page }) => {
  await open(page, 1, "&go=windows");
  await expect(page.getByText(/Запас до встречи:.*без запаса/)).toBeVisible();
  await page.getByText("Изменить", { exact: true }).click();
  await sheet(page).getByRole("button", { name: "30 мин" }).click();
  await expect(page.getByText(/Запас до встречи:.*30 мин/)).toBeVisible();
  await page.getByText("Изменить", { exact: true }).click();
  await sheet(page).getByRole("button", { name: "Без запаса" }).click();
  await expect(page.getByText(/Запас до встречи:.*без запаса/)).toBeVisible();
});
