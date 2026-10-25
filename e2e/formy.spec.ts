// Формы в шторках: то, на что чаще всего жалуются в чужих приложениях для пар
// (разбор отзывов You&Me, Paired и Between, 07.10.2026: «в капсуле клавиатура
// закрывает текст, писать невозможно», «поле ввода скрыто клавиатурой»).
import { expect, test, type Page } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

/**
 * Экранная клавиатура телефона: в браузере её нет, поэтому visualViewport
 * подменяется — как в Telegram на айфоне, видимая часть страницы становится
 * ниже на высоту клавиатуры, а сама страница (и position: fixed) — нет.
 */
async function withKeyboard(page: Page) {
  await page.addInitScript(() => {
    const vv = new EventTarget() as EventTarget & Record<string, unknown>;
    let kb = 0;
    Object.defineProperty(vv, "height", { get: () => window.innerHeight - kb });
    Object.defineProperty(vv, "width", { get: () => window.innerWidth });
    Object.defineProperty(vv, "offsetTop", { get: () => 0 });
    Object.defineProperty(vv, "scale", { get: () => 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => vv });
    (window as unknown as { keyboard: (h: number) => void }).keyboard = (h: number) => {
      kb = h;
      vv.dispatchEvent(new Event("resize"));
    };
  });
}

test("письмо в будущее: клавиатура не закрывает поле письма", async ({ page }) => {
  await withKeyboard(page);
  await open(page, 1, "&go=capsules");
  await page.locator(".screen.pushed").getByRole("button", { name: "Написать", exact: true }).click();
  const letter = sheet(page).getByPlaceholder("Привет из прошлого…");
  await letter.click();
  const KB = 340;
  await page.evaluate((h) => (window as unknown as { keyboard: (h: number) => void }).keyboard(h), KB);
  const vh = page.viewportSize()!.height;
  // Верх поля, где стоит курсор, виден над клавиатурой и не уехал за верх экрана
  await expect
    .poll(async () => {
      const b = (await letter.boundingBox())!;
      return b.y >= 0 && b.y + 48 <= vh - KB;
    })
    .toBe(true);
  // Кнопка «Запечатать» тоже достаётся: шторка прокручивается над клавиатурой
  const seal = sheet(page).getByRole("button", { name: /Запечатать/ });
  await seal.scrollIntoViewIfNeeded();
  const s = (await seal.boundingBox())!;
  expect(s.y + s.height, "кнопка под клавиатурой").toBeLessThanOrEqual(vh - KB + 1);
  // Клавиатуру убрали — шторка снова у нижнего края
  await page.evaluate(() => (window as unknown as { keyboard: (h: number) => void }).keyboard(0));
  await expect.poll(async () => Math.round((await sheet(page).boundingBox())!.y + (await sheet(page).boundingBox())!.height)).toBe(vh);
});

test("подпись поля не нажимает первую кнопку и не становится её именем", async ({ page }) => {
  await open(page, 1, "&go=wardrobe");
  await page.getByRole("button", { name: /^Мои/ }).click();
  await page.getByRole("button", { name: /Добавить вещь/ }).click();
  const jpg = Buffer.from(
    await page.evaluate(() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 300;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#3b5b8a";
      g.fillRect(0, 0, 300, 300);
      return cv.toDataURL("image/jpeg", 0.9).split(",")[1];
    }),
    "base64",
  );
  await sheet(page).locator('input[type="file"]:not([capture])').setInputFiles({ name: "vesch.jpg", mimeType: "image/jpeg", buffer: jpg });
  // У каждой кнопки своё имя: «Верх», а не «Что это Низ Платье …»
  await expect(sheet(page).getByRole("button", { name: "Верх", exact: true })).toBeVisible();
  // Касание подписи «Что это» ничего не выбирает
  await sheet(page).getByText("Что это", { exact: true }).click();
  await expect(sheet(page).getByRole("button", { name: "Готово" })).toBeDisabled();
  await expect(sheet(page).getByText("Выбери, что это за вещь")).toBeVisible();
});
