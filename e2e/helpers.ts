import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Открыть приложение от имени тестового человека: 1 — Миша, 2 — Алина,
 * остальные — новые. ?still=1 выключает анимации, светлая тема для ровных снимков.
 * Диалоги подтверждения («Удалить?») сразу принимаем.
 */
export async function open(page: Page, who: number, extra = ""): Promise<void> {
  page.on("dialog", (d) => void d.accept());
  // promo=0: «Вдвоём+» во весь экран при входе закрыл бы то, что проверяет тест
  await page.goto(`/?dev=${who}&still=1&theme=light&promo=0${extra}`);
  await expect(page.locator(".screen").first()).toBeVisible();
}

/** Элемент целиком на экране: не уехал ни вниз, ни под нижнее меню. */
export async function onScreen(page: Page, el: Locator): Promise<void> {
  const box = await el.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box, "элемент не нарисован").not.toBeNull();
  expect(box!.y, "уехал вверх за край").toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, "уехал вниз за край экрана").toBeLessThanOrEqual(vh + 1);
}

export const sheet = (page: Page) => page.locator(".sheet");
