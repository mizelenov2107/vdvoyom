// Жанры в колоде фильмов. Регрессия 03.10.2026: «не работает кнопка жанров».
// Шторка открывалась и сохраняла, но колода не менялась: перезагрузка после
// смены жанров молча пропускалась, если в этот момент шла подгрузка следующих
// карточек — а она идёт почти всё время, пока человек свайпает. Старый тест
// менял жанры на полной колоде, где гонки не бывает, поэтому её не видел.
// Здесь подгрузка нарочно зависает, пока человек выбирает жанр.
import { expect, test, type Page } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

const WHO: Record<string, number> = { chrome: 5, iphone: 7, android: 3 };
const topGenres = (page: Page) => page.locator(".swipe-card").last().locator(".chip").allTextContents();

test("жанры: выбор виден на кнопке и меняет колоду, даже если шла подгрузка", async ({ page }, info) => {
  const who = WHO[info.project.name] ?? 5;
  await open(page, who, "&go=movies");
  await expect(page.locator(".swipe-card").last()).toBeVisible();
  const genresBtn = page.getByRole("button", { name: /^Жанры/ });
  await expect(genresBtn).toHaveText(/Жанры/);

  // Подгрузка «ещё карточек» зависает на 3 секунды — как на медленном мобильном интернете
  let hold = true;
  await page.route("**/api/deck/movie*", async (route) => {
    if (hold) {
      hold = false;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await route.continue();
  });
  // Свайпаем, пока в очереди не останется меньше шести карточек: стартует подгрузка
  for (let i = 0; i < 16; i++) await page.getByRole("button", { name: "не хочу", exact: true }).click();

  await genresBtn.click();
  const s = sheet(page);
  await s.getByRole("button", { name: "комедия", exact: true }).click();
  await expect(s.getByRole("button", { name: "Показать: комедия" })).toBeVisible();
  await s.getByRole("button", { name: "Показать: комедия" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByText(/В колоде \d+ (фильм|фильма|фильмов) под ваш выбор/)).toBeVisible({ timeout: 10_000 });

  // Кнопка показывает выбор; первые пять карточек — с комедией среди жанров, хотя у человека
  // 30 сохранёнок-драм (seed). Мимо фильтра — только то, что половинка предложила сама.
  await expect(page.getByRole("button", { name: "Жанры: комедия" })).toHaveText(/комедия/);
  for (let i = 0; i < 5; i++) {
    const card = page.locator(".swipe-card").last();
    if (!(await card.getByText(/предлагает/).count())) expect(await topGenres(page), `карточка ${i + 1} не комедия`).toContain("комедия");
    await page.getByRole("button", { name: "хочу", exact: true }).click();
  }

  // Сброс возвращает «всё подряд»
  await page.getByRole("button", { name: "Жанры: комедия" }).click();
  await sheet(page).getByRole("button", { name: "Сбросить выбор" }).click();
  await sheet(page).getByRole("button", { name: "Показать всё подряд" }).click();
  await expect(page.getByRole("button", { name: "Жанры", exact: true })).toBeVisible();
});

test("жанры: закрыть шторку без изменений — колода та же, лишних запросов нет", async ({ page }, info) => {
  await open(page, WHO[info.project.name] ?? 5, "&go=movies");
  const before = await page.locator(".swipe-card").last().locator(".title-lg").textContent();
  let saves = 0;
  page.on("request", (r) => r.url().includes("/api/movies/prefs") && saves++);
  await page.getByRole("button", { name: /^Жанры/ }).click();
  await sheet(page).getByRole("button", { name: "Готово" }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(saves).toBe(0);
  await expect(page.locator(".swipe-card").last().locator(".title-lg")).toHaveText(before ?? "");
});
