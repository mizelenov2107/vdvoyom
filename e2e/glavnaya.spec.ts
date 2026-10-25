// Главная: блок «Сейчас», шторки настроения и «С какого дня вы вместе».
// Регрессия 26.09.2026: на прокрученной главной обе шторки уезжали за край
// экрана на айфоне — часть эмодзи не было видно, дату было не выбрать.
import { expect, test } from "@playwright/test";
import { onScreen, open, sheet } from "./helpers.ts";

test("главная открывается: «Сейчас» и дни вместе", async ({ page }) => {
  await open(page, 1);
  await expect(page.getByText("Сейчас", { exact: true })).toBeVisible();
  await expect(page.getByText(/вместе$/).first()).toBeVisible();
});

test("шторка настроения видна целиком на прокрученной главной и ставит настроение", async ({ page }) => {
  await open(page, 1);
  // Кнопка — «Моё настроение» или уже выбранный смайлик
  const btn = page.locator(".card", { hasText: "тепла" }).locator(".pill");
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(sheet(page).getByText("Как ты?")).toBeVisible();
  const moods = sheet(page).locator(".grid-4 button");
  await expect(moods).toHaveCount(10);
  for (let i = 0; i < 10; i++) await onScreen(page, moods.nth(i));
  await moods.nth(1).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".pill", { hasText: "🥰" })).toBeVisible();
  // Убрать настроение — вернуть как было
  await btn.click();
  await sheet(page).getByRole("button", { name: "Убрать" }).click();
  await expect(page.getByRole("button", { name: "Моё настроение" })).toBeVisible();
});

test("шторка «С какого дня вы вместе» открывается и сохраняет дату", async ({ page }) => {
  await open(page, 1);
  const card = page.getByText(/дн(ень|я|ей) вместе/).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(sheet(page).getByText("С какого дня вы вместе")).toBeVisible();
  const date = sheet(page).locator('input[type="date"]');
  await onScreen(page, date);
  await date.fill("2024-03-02");
  await onScreen(page, sheet(page).getByRole("button", { name: "Сохранить" }));
  await sheet(page).getByRole("button", { name: "Сохранить" }).click();
  await expect(sheet(page)).toHaveCount(0);
  // Вернуть как было, чтобы другие тесты видели ту же пару
  await card.click();
  await sheet(page).locator('input[type="date"]').fill("2024-03-01");
  await sheet(page).getByRole("button", { name: "Сохранить" }).click();
});

test("плашка «на экран Домой» видна и нажимается", async ({ page }) => {
  await open(page, 1, "&hs=1");
  await expect(page.getByText("Поставь «Вдвоём» на экран «Домой»")).toBeVisible();
  await expect(page.getByRole("button", { name: /Добавить на экран/ })).toBeVisible();
});

test("низ главной — дата без «Сегодня сегодня»; под сердцем в нижнем меню есть подпись", async ({ page }) => {
  await open(page, 1);
  await expect(page.getByText(/^Сегодня, \d+ \S+$/)).toBeVisible();
  await expect(page.getByText(/Сегодня сегодня/)).toHaveCount(0);
  const label = page.locator(".tabbar .tab-heart-label");
  await expect(label).toHaveText("Свайпы");
  await onScreen(page, label);
  await page.locator(".tabbar").getByRole("button", { name: "Свайпы" }).click();
  await expect(page.locator(".tabbar .tab-center.on")).toHaveCount(1);
});
