// «Вдвоём+»: кнопка ведёт прямо в ЮKassa (почта для чека), тестовая оплата и включение.
// В тестах магазина ЮKassa нет, поэтому счёт ведёт на /pay/dev — он «оплачивает» сразу.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("оплата картой российского банка: почта, счёт, «Вдвоём+» включён", async ({ page, context }) => {
  await open(page, 1, "&go=plus");
  await page.getByRole("button", { name: /^(Открыть всё вдвоём|Продлить за)/ }).click();
  // Основной путь — ЮKassa: без выбора способа, сразу почта; звёзды — ссылкой ниже
  await expect(sheet(page).getByText("Куда прислать чек?")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /Картой иностранного банка: \d/ })).toBeVisible();

  await sheet(page).getByPlaceholder("Электронная почта").fill("не почта");
  await sheet(page).getByRole("button", { name: "Перейти к оплате" }).click();
  await expect(page.getByText("Проверь почту: в ней ошибка")).toBeVisible();

  await sheet(page).getByPlaceholder("Электронная почта").fill("test@example.com");
  const [pay] = await Promise.all([context.waitForEvent("page"), sheet(page).getByRole("button", { name: "Перейти к оплате" }).click()]);
  await pay.waitForLoadState();
  expect(pay.url()).toContain("/pay/dev?id=");
  // Пока идёт акция, по умолчанию выбран год по акции
  await expect(pay.getByText(/Тестовая оплата (990|1\s?490) ₽ прошла/)).toBeVisible();
  await expect(page.getByText("Ещё минутку… Проверяем оплату")).toBeVisible();
  await pay.close();

  // Шторка «Проверяем оплату» сама замечает оплату и закрывается
  await expect(page.getByText("Ещё минутку… Проверяем оплату")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(/Включён до/)).toBeVisible();

  // Половинка узнаёт об этом и в приложении, а не только из бота: шторка один раз, без рода
  await page.goto("/?dev=2&still=1&theme=light");
  await expect(sheet(page).getByText("«Вдвоём+» теперь у вас двоих")).toBeVisible();
  await expect(sheet(page).getByText(/Спасибо Мише/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Позже" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Сейчас", { exact: true })).toBeVisible();
  await expect(page.getByText("«Вдвоём+» теперь у вас двоих")).toHaveCount(0);
});

test("тарифы как в макете: год выделен и подписан «с каждого», месяц виден сразу, кнопка «Открыть всё вдвоём»", async ({ page }) => {
  // Аня (3) без «Вдвоём+»
  await open(page, 3, "&go=plus");
  const yearCard = page.getByRole("button", { name: /^Год/ });
  await expect(yearCard).toHaveAttribute("aria-pressed", "true");
  await expect(yearCard).toContainText("выгоднее");
  await expect(yearCard).toContainText(/по (41|62) ₽ в месяц с каждого/);
  const month = page.getByRole("button", { name: /^Месяц/ });
  await expect(month).toContainText("199");
  await month.click();
  await expect(page.getByRole("button", { name: /^Открыть всё вдвоём · 199/ })).toBeVisible();
  await expect(page.getByText(/Платишь ты, откроется и у Бори · без автосписаний/)).toBeVisible();
  // Четыре причины, подробный список — раскрытием
  expect(await page.locator(".plus-reasons .plus-test").count()).toBeLessThanOrEqual(4);
  await page.getByRole("button", { name: "Что входит подробнее" }).click();
  await expect(page.getByText(/бесплатно — 5 фильмов/)).toBeVisible();
});

test("«навсегда»: тариф после года и месяца, после оплаты тарифов больше нет", async ({ page, context }, info) => {
  await open(page, info.project.name === "iphone" ? 7 : 5, "&go=plus");
  if (!(await page.getByText("Включён навсегда").count())) {
    const card = page.getByRole("button", { name: /Навсегда/ });
    await expect(card).toContainText("1 990 ₽");
    await expect(card).toContainText("одна оплата, без продлений");
    await card.click();
    await page.getByRole("button", { name: /^Открыть всё вдвоём · 1\s990/ }).click();
    await sheet(page).getByPlaceholder("Электронная почта").fill("test@example.com");
    const [pay] = await Promise.all([context.waitForEvent("page"), sheet(page).getByRole("button", { name: "Перейти к оплате" }).click()]);
    await expect(pay.getByText(/Тестовая оплата 1\s?990 ₽ прошла/)).toBeVisible();
    await pay.close();
  }
  await expect(page.getByText("Включён навсегда")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^(Открыть всё вдвоём|Продлить за)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Навсегда/ })).toHaveCount(0);
});
