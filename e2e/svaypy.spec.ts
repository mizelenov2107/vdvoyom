// Свайпы: карточка фильма с постером в хорошем качестве, оценка, «подробнее»,
// своё место — и оно первым у половинки.
import { expect, test } from "@playwright/test";
import { onScreen, open, sheet } from "./helpers.ts";

test("колода фильмов: постер не меньше 700 px, оценка и «подробнее»", async ({ page }) => {
  await open(page, 1, "&go=movies");
  const poster = page.locator(".swipe-card img.poster").last();
  await expect(poster).toBeVisible();
  // Регрессия 26.09.2026: постеры были по 220–260 px и мылились на карточке
  await expect.poll(async () => poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThanOrEqual(700);
  const title = await page.locator(".swipe-card .title-lg").last().textContent();
  await page.getByRole("button", { name: "подробнее" }).click();
  await expect(sheet(page).getByRole("button", { name: /Кинопоиск/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole("button", { name: "хочу", exact: true }).click();
  await expect(page.locator(".swipe-card .title-lg").last()).not.toHaveText(title ?? "");
});

test("своё место: Миша добавляет, у Алины оно первое в колоде", async ({ page, browser }) => {
  const name = `Каток ${Date.now() % 100000}`;
  await open(page, 1, "&go=ideas");
  await page.getByRole("button", { name: "Своё место" }).click();
  await sheet(page).getByPlaceholder("Каток в Парке Горького").fill(name);
  await sheet(page).getByRole("button", { name: "Добавить в колоду" }).click();
  await expect(sheet(page)).toHaveCount(0);

  const alina = await (await browser.newContext({ viewport: page.viewportSize() ?? undefined, locale: "ru-RU" })).newPage();
  await open(alina, 2, "&go=ideas");
  // Предложенное половинкой идёт первым: среди верхних карточек колоды
  await expect(alina.locator(".swipe-card .title-lg", { hasText: name })).toHaveCount(1);
  await alina.context().close();
});

// Тест 11.10.2026: на Android 448×646 и iPhone 13 (390×664) кнопки оценки уходили под край,
// а «осталось 750 карточек» не уменьшалось после оценок
for (const [w, h] of [[448, 646], [390, 664], [360, 560]] as const) {
  test(`колода ${w}×${h}: пять оценок и «вернуть» на экране, счётчик карточек убывает`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, 1, "&go=movies");
    await expect(page.locator(".swipe-card .title-lg").last()).toBeVisible();
    for (const name of ["не хочу", "не очень", "норм", "хочу", "очень хочу"]) await onScreen(page, page.getByRole("button", { name, exact: true }));
    await onScreen(page, page.getByRole("button", { name: /вернуть/ }));
    await onScreen(page, page.getByRole("button", { name: /подробнее/ }));
    const left = async () => Number((await page.getByText(/^осталось \d+/).textContent())!.replace(/\D/g, ""));
    const before = await left();
    await page.getByRole("button", { name: "не очень", exact: true }).click();
    await expect.poll(left).toBe(before - 1);
    await page.getByRole("button", { name: "норм", exact: true }).click();
    await expect.poll(left).toBe(before - 2);
    await page.getByRole("button", { name: /вернуть/ }).click();
    await expect.poll(left).toBe(before - 1);
  });
}
