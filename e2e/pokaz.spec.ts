// Показ в окне, не проверка: `npm run pokaz`. Миша без «Вдвоём+» проходит весь
// путь бесплатного человека — акция с таймером на главной, тест с замком,
// экран «Вдвоём+» с тарифами, оплата через ЮKassa (тестовая страница) и
// шторка «Проверяем оплату», которая сама видит платёж. Паузы — чтобы успеть
// разглядеть. В обычном прогоне пропускается.
import { expect, test } from "@playwright/test";
import { sheet } from "./helpers.ts";

test("показ: бесплатный видит акцию и замки и покупает «Вдвоём+» навсегда", async ({ page, context }) => {
  test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
  test.setTimeout(240_000);
  const pause = (ms = 2000) => page.waitForTimeout(ms);
  // Кадры показа остаются в e2e/kadry — их можно переслать
  let n = 0;
  const snap = (name: string) => page.screenshot({ path: `e2e/kadry/${String(++n).padStart(2, "0")} ${name}.png` });

  // Вход: «Вдвоём+» выезжает во весь экран сам (раз в сутки, когда половинка уже в приложении)
  await page.goto("/?dev=1&theme=light&promo=1");
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
  await pause(4000);
  await snap("вход — продающий экран");
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 200);
    await pause(700);
  }
  await snap("что откроется и сравнение");
  await page.getByRole("button", { name: "Может позже" }).click();
  await pause(1500);

  // Главная: искорка «Вдвоём+» в шапке и акция с таймером
  await snap("главная — искорка и акция");
  await pause(2500);
  await page.locator(".tabbar").getByText("Ещё").click();
  await pause(1000);
  await page.getByText("Тесты на совместимость").first().click();
  const locked = page.locator(".screen.pushed button.card", { hasText: "Деньги без неловкости" });
  await expect(locked).toBeVisible();
  await pause(1500);
  await locked.click();
  await expect(sheet(page).getByText("Это во «Вдвоём+»")).toBeVisible();
  await pause(2500);
  await snap("тест с замком — шторка");
  await sheet(page).getByRole("button", { name: "Не сейчас" }).click();
  await page.locator(".screen.pushed").getByText("Назад").first().click();
  await page.locator(".tabbar").getByText("Главная").click().catch(() => {});
  await pause(800);
  await page.getByRole("button", { name: "Вдвоём+" }).click();
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
  await pause(1500);

  const forever = page.getByRole("button", { name: /Навсегда/ });
  await forever.scrollIntoViewIfNeeded();
  await pause(1200);
  await forever.click();
  await pause(1500);
  await snap("тарифы — выбран навсегда");
  await page.getByRole("button", { name: /^Открыть всё вдвоём · 1\s990/ }).click();

  // Основной путь — ЮKassa: почта для чека, дальше страница оплаты
  await expect(sheet(page).getByText("Куда прислать чек?")).toBeVisible();
  await pause(1500);
  await sheet(page).getByPlaceholder("Электронная почта").pressSequentially("misha@example.com", { delay: 60 });
  await pause(1000);
  await snap("ЮKassa — почта для чека");
  const [pay] = await Promise.all([context.waitForEvent("page"), sheet(page).getByRole("button", { name: "Перейти к оплате" }).click()]);
  await expect(pay.getByText(/Тестовая оплата 1\s?990 ₽ прошла/)).toBeVisible();
  await pay.waitForTimeout(3000); // в бою здесь страница ЮKassa: карта, СБП, SberPay
  await pay.close();
  await page.bringToFront();

  await expect(page.getByText("Ещё минутку… Проверяем оплату")).toBeVisible();
  await snap("проверяем оплату");
  await expect(page.getByText("Включён навсегда")).toBeVisible({ timeout: 20_000 });
  await page.mouse.wheel(0, -2000);
  await pause(3500);
  await snap("включён навсегда");

  // Замков больше нет
  await page.goBack().catch(() => {});
  await page.goto("/?dev=1&theme=light&go=tests");
  await expect(page.locator(".screen.pushed button.card", { hasText: "Деньги без неловкости" })).toBeVisible();
  await expect(page.getByText("во «Вдвоём+»")).toHaveCount(0);
  await pause(4000);
});

// Проверка продающего экрана глазами: первый экран на трёх телефонах во весь экран
// телеграма (сверху часы и кнопки «Закрыть» и «⋯» — их отступы подставлены вручную).
for (const [name, width, height] of [["iPhone SE", 375, 667], ["iPhone 13", 390, 844], ["iPhone Pro Max", 430, 932]] as const) {
  test(`снимок: продающий экран на ${name}`, async ({ page }) => {
    test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
    await page.setViewportSize({ width, height });
    await page.goto("/?dev=3&still=1&theme=light&promo=1");
    await page.addStyleTag({ content: ":root{--tg-safe-area-inset-top:47px;--tg-content-safe-area-inset-top:46px;--tg-safe-area-inset-bottom:34px}" });
    await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `e2e/kadry/экран ${name}.png` });
    if (width !== 390) return;
    // Весь экран по частям: прокручиваем выдвинутый экран, кнопка покупки остаётся внизу
    for (let i = 1; i <= 4; i++) {
      await page.locator(".screen.pushed").evaluate((el, y) => el.scrollTo(0, y), i * 560);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/kadry/экран ${name} — ниже ${i}.png` });
    }
  });
}

test("снимок: кнопка и шторка отзыва", async ({ page }) => {
  test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
  await page.goto("/?dev=1&still=1&theme=light&promo=0");
  await expect(page.getByRole("button", { name: "Отзыв" })).toBeVisible();
  await page.screenshot({ path: "e2e/kadry/отзыв — кнопка на главной.png" });
  await page.getByRole("button", { name: "Отзыв" }).click();
  await sheet(page).getByRole("radio", { name: "🎨 Дизайн" }).click();
  await sheet(page).getByRole("textbox", { name: "Текст отзыва" }).fill("На главной слишком много плашек сверху, хочется сразу видеть «Сейчас»");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/kadry/отзыв — шторка.png" });
});

test("снимок: вопрос дня с реакцией и ответом на ответ", async ({ page }) => {
  test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
  const say = async (who: number, text: string) => {
    await page.goto(`/?dev=${who}&still=1&theme=light&promo=0&go=daily`);
    const box = page.getByPlaceholder("Твой ответ…");
    await expect(box.or(page.getByRole("button", { name: "Изменить" }))).toBeVisible();
    if (await box.count()) {
      await box.fill(text);
      await page.getByRole("button", { name: /^Ответить/ }).click();
    }
  };
  await say(1, "За то, что успели погулять до дождя и ты купила мне кофе");
  await say(2, "За вечер вдвоём и за то, что ты наконец выспался");
  await page.getByRole("button", { name: "🥺" }).click();
  await page.getByRole("textbox", { name: "Ответ на ответ" }).fill("Кофе был идеальный, повторим завтра?");
  await page.getByRole("button", { name: "Отправить" }).click();
  await page.goto("/?dev=1&still=1&theme=light&promo=0&go=daily");
  await page.getByRole("button", { name: "❤️" }).click();
  await page.getByRole("textbox", { name: "Ответ на ответ" }).fill("Повторим 💞");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText("Повторим 💞")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/kadry/вопрос дня — реакции и ответы.png" });
});

test("снимок: лупа на главной, поиск и календарь телефона", async ({ page }) => {
  test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
  await page.goto("/?dev=1&still=1&theme=light&promo=0");
  await expect(page.getByRole("button", { name: "Поиск" })).toBeVisible();
  await page.getByRole("button", { name: "Поиск" }).click();
  await sheet(page).getByRole("searchbox", { name: "Что найти" }).fill("фото");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/kadry/поиск.png" });
  await page.goto("/?dev=1&still=1&theme=light&promo=0&go=calendar");
  await page.getByRole("button", { name: "В календарь телефона" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/kadry/календарь телефона.png" });
});

// Тесты на совместимость, формат 2 (08.10.2026): все экраны на самом узком телефоне
// (iPhone SE, 375×667) во весь экран телеграма. Снимок экрана и всей страницы целиком;
// и проверка, что ничего не уезжает за правый край.
test("снимок: тесты на iPhone SE", async ({ page }) => {
  test.skip(!process.env.POKAZ, "только для показа: npm run pokaz");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 667 });
  const shots: string[] = [];
  const snap = async (name: string) => {
    await page.waitForTimeout(500);
    // Ничего не шире экрана: ни строка, ни кнопка, ни чип
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".screen.pushed *")]
        .filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".scroll-x, .pills.scroll"))
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}: ${(e.innerText || "").slice(0, 40)}`),
    );
    expect(wide, `${name}: за правым краем`).toEqual([]);
    await page.screenshot({ path: `e2e/kadry/тесты SE — ${name}.png` });
    await page.locator(".screen.pushed").last().evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/kadry/тесты SE — ${name}, низ.png` });
    shots.push(name);
  };
  const go = async (where: string) => {
    await page.goto(`/?dev=1&still=1&theme=light&promo=0&go=${where}`);
    await page.addStyleTag({ content: ":root{--tg-safe-area-inset-top:47px;--tg-content-safe-area-inset-top:46px;--tg-safe-area-inset-bottom:34px}" });
  };
  await go("tests");
  await expect(page.locator(".screen.pushed button.card", { hasText: "Угадай меня" })).toBeVisible();
  await snap("список");
  await go("test:priyatno");
  await expect(page.getByText("Что приятнее всего: Алина")).toBeVisible();
  await snap("результат «Что мне приятно»");
  await page.getByRole("button", { name: "Поговорить сейчас" }).click();
  await snap("поговорить сейчас");
  await go("cheatsheet");
  await expect(page.getByRole("heading", { name: "Шпаргалка" })).toBeVisible();
  await snap("шпаргалка");
  await go("test:ugaday");
  await page.getByRole("button", { name: "Начать" }).click();
  await snap("вопрос");
  await page.locator(".screen.pushed [role=radiogroup]").first().getByRole("radio").nth(0).click();
  await expect(page.getByRole("button", { name: /изменить/ })).toBeVisible();
  await snap("вопрос и догадка");
  await go("test:svidanie");
  await expect(page.locator(".screen.pushed [role=radiogroup]")).toBeVisible();
  await snap("это или то");
  expect(shots.length).toBe(7);
});
