// Бесплатные лимиты, акция и экран «Вдвоём+» при входе — на паре Аня (3) и Боря (4), у неё «Вдвоём+» нет.
import { expect, test, type Page } from "@playwright/test";
import { onScreen, open, sheet } from "./helpers.ts";

// Продаём после пользы (11.10.2026): пока пара ничего не сделала вместе, нет ни экрана
// «Вдвоём+» при входе, ни акции. Польза — оба ответили на вопрос дня. В тот же заход
// продажи всё ещё нет, со следующего — экран при входе и акция, время датой, без секунд.
const as = (id: number, name: string) => ({ authorization: `dev ${id}:${encodeURIComponent(name)}` });

test("«Вдвоём+» при входе и акция — только после общей пользы и со следующего захода; время датой, акция не первой карточкой", async ({ page }) => {
  await page.goto("/?dev=3&still=1&theme=light");
  await expect(page.getByText("Сейчас", { exact: true })).toBeVisible();
  const before = await (await page.request.get("/api/home", { headers: as(3, "Аня") })).json();
  // Вторым движком пара уже с пользой: этот заход и есть «следующий», экран уже выехал
  if (!before.benefit) {
    await page.waitForTimeout(800);
    await expect(page.getByRole("heading", { name: /Узнайте/ })).toHaveCount(0);
    await expect(page.locator(".offer")).toHaveCount(0);

    // Оба ответили на вопрос дня — первая общая польза
    await page.request.get("/api/daily", { headers: as(3, "Аня") });
    for (const [id, name] of [[3, "Аня"], [4, "Боря"]] as const) {
      expect((await page.request.post("/api/daily", { headers: as(id, name), data: { text: "Море" } })).ok()).toBeTruthy();
    }
    // Тот же заход: по-прежнему не продаём
    await page.locator(".tabbar").getByText("Календарь").click();
    await page.locator(".tabbar").getByText("Главная").click();
    await expect(page.getByText("Сейчас", { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator(".offer")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Узнайте/ })).toHaveCount(0);
    // Следующий заход
    await page.reload();
  }

  // Заход после пользы: «Вдвоём+» во весь экран, акция датой, без бегущих секунд
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
  const line = page.getByText(/Цена года для новых пар (до|сегодня)/);
  await expect(line).toBeVisible();
  expect(await line.textContent(), "без секунд").not.toMatch(/\d:\d\d:\d\d/);
  const cta = page.getByRole("button", { name: /^Открыть всё вдвоём · 990/ });
  await onScreen(page, cta);
  const later = page.getByRole("button", { name: "Может позже" });
  expect((await later.boundingBox())!.height, "«Может позже» — не меньше 44 px").toBeGreaterThanOrEqual(44);
  await later.click();
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toHaveCount(0);

  // Главная: акция ниже вопроса дня, спокойной карточкой, без таймера
  const offer = page.locator(".offer");
  await expect(offer.getByText(/на год за 990/)).toBeVisible();
  await expect(offer.getByText(/1\s?490/)).toBeVisible();
  await expect(offer.getByText(/по 41\s₽ в месяц с каждого/)).toBeVisible();
  await expect(offer.locator(".offer-timer")).toHaveCount(0);
  const daily = page.getByText("Вопрос дня", { exact: true });
  expect((await offer.boundingBox())!.y, "акция ниже вопроса дня").toBeGreaterThan((await daily.boundingBox())!.y);
  const t1 = await offer.textContent();
  await page.waitForTimeout(1500);
  expect(await offer.textContent(), "ничего не тикает").toBe(t1);
  await offer.getByRole("button", { name: "Посмотреть" }).click();
  await expect(page.getByRole("button", { name: /^Год/ })).toContainText("990");
  await page.getByRole("button", { name: "Назад" }).click();

  // Ещё один заход в те же сутки — сразу главная
  await page.reload();
  await expect(page.getByText("Сейчас", { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toHaveCount(0);

  // Искорка в шапке ведёт туда же; кнопка остаётся на экране при прокрутке
  await page.getByRole("button", { name: "Вдвоём+" }).click();
  await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
  await page.getByText("А если не понравится?").scrollIntoViewIfNeeded();
  await onScreen(page, cta);
});

test("закрытый тест с замком открывает шторку «Это во «Вдвоём+»»", async ({ page }) => {
  // Аня и Боря (3+4) — обычная пара, не бета новых тестов: старые тесты, как до 08.10.2026
  await open(page, 3, "&go=tests");
  const locked = page.locator(".screen.pushed button.card", { hasText: "Насколько ты меня знаешь" });
  await expect(locked.getByText("во «Вдвоём+»")).toBeVisible();
  await locked.click();
  await expect(sheet(page).getByText("Это во «Вдвоём+»")).toBeVisible();
  await expect(sheet(page).getByText(/цена для новых пар (до|сегодня)/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Не сейчас" }).click();
  // Бесплатный тест открывается как обычно
  // Под экраном тестов лежит «Ещё» со своей карточкой «Тесты на совместимость» — ищем только в тестах
  await page.locator(".screen.pushed button.card", { hasText: "Языки любви" }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test("третья цель упирается в бесплатный лимит — сервер отвечает шторкой, а не ошибкой", async ({ page }) => {
  await open(page, 3, "&go=goals");
  await page.getByRole("button", { name: "Новая цель" }).click();
  await sheet(page).locator(".tile", { hasText: "30 фильмов вместе" }).click();
  await expect(page.getByText("Это во «Вдвоём+»")).toBeVisible();
  await expect(page.getByText(/Бесплатно — 2 цели одновременно/)).toBeVisible();
});

// ——— Новые тесты без «Вдвоём+» (08.10.2026) ———
// Бета-пары без «Вдвоём+»: 47+48 (chrome) и 49+50 (iphone), см. e2e/seed.ts. Первый раунд
// «Угадай меня» уже закрыт. Путь живого человека: второй раунд упирается в шторку,
// шпаргалка — три строки и размытое; потом партнёр покупает «Вдвоём+» — и у первого
// открыто всё: шпаргалка целиком и новые раунды.
test.describe("бета без «Вдвоём+»: раунды и шпаргалка", () => {
  test.describe.configure({ mode: "serial" });
  const PAIRS: Record<string, [number, number, string]> = { chrome: [47, 48, "Никита"], iphone: [49, 50, "Рустам"] };
  const pairOf = (name: string) => {
    const p = PAIRS[name];
    test.skip(!p, "только chrome и iphone");
    return p;
  };
  const top = (page: Page) => page.locator(".screen.pushed").last();

  test("второй раунд — шторка «Вдвоём+», шпаргалка — первые три строки, остальное размыто", async ({ page }, info) => {
    const [a, , name] = pairOf(info.project.name);
    await open(page, a, "&go=tests");
    await top(page).locator("button.card", { hasText: "Угадай меня" }).click();
    // Результат первого раунда виден, новый раунд — с замком
    // Агент A 11.10.2026: «совпали» → «одинаково», кнопка раунда — «Ещё 10 вопросов · Вдвоём+» (и под счётом, и внизу)
    await expect(top(page).getByText("одинаково", { exact: true })).toBeVisible();
    const next = top(page).getByTestId("next-round-top");
    await expect(next).toContainText("Вдвоём+");
    await next.click();
    await expect(sheet(page).getByText("Это во «Вдвоём+»")).toBeVisible();
    await expect(sheet(page).getByText(/первый раунд каждого теста/)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Не сейчас" }).click();
    await expect(top(page).getByText(/[Рр]аунд 1/).first()).toBeVisible();

    await open(page, a, "&go=tests");
    await top(page).locator("button.card", { hasText: `Шпаргалка: ${name}` }).click();
    await expect(top(page).getByTestId("cheat-entry")).toHaveCount(3);
    await expect(top(page).getByTestId("cheat-blur")).toBeVisible();
    await top(page).getByRole("button", { name: "Открыть во Вдвоём+" }).click();
    await expect(page.getByRole("heading", { name: /Узнайте/ })).toBeVisible();
  });

  test("партнёр покупает «Вдвоём+» — у обоих открыто всё: шпаргалка и новые раунды", async ({ page, context }, info) => {
    const [a, b] = pairOf(info.project.name);
    await open(page, b, "&go=plus");
    await page.getByRole("button", { name: /^Открыть всё вдвоём/ }).click();
    await sheet(page).getByPlaceholder("Электронная почта").fill("test@example.com");
    const [pay] = await Promise.all([context.waitForEvent("page"), sheet(page).getByRole("button", { name: "Перейти к оплате" }).click()]);
    await pay.waitForLoadState();
    await expect(pay.getByText(/Тестовая оплата .* прошла/)).toBeVisible();
    await pay.close();
    await expect(page.getByText(/Включён до/)).toBeVisible({ timeout: 15_000 });

    // Первый из пары ничего не покупал — а всё открыто
    await open(page, a, "&go=tests");
    await top(page).locator("button.card", { hasText: "Шпаргалка" }).click();
    // Четвёртая строка и дальше — уже настоящие, без размытия
    await expect(top(page).getByTestId("cheat-entry").nth(3)).toBeVisible();
    await expect(top(page).getByTestId("cheat-blur")).toHaveCount(0);

    await open(page, a, "&go=tests");
    await top(page).locator("button.card", { hasText: "Угадай меня" }).click();
    const next = top(page).getByTestId("next-round-top");
    await expect(next).not.toContainText("Вдвоём+");
    await next.click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(top(page).getByText(/[Рр]аунд 2/).first()).toBeVisible();
  });
});
