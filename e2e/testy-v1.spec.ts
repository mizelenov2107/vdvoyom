// Бета новых тестов (08.10.2026, этап 4): новые тесты и «Шпаргалку» видит только
// пара владельца (ADMIN_IDS, server/src/beta.ts). Обычная пара живёт как до 08.10: старые семь
// тестов, старый экран и старые сообщения бота, а нового не видно ни на экранах, ни в API.
// Свои обычные пары у движков: 41+42 (chrome), 43+44 (iphone) — см. e2e/seed.ts.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers.ts";
import { genitive } from "../web/src/fmt.ts";

const BOT_LOG = process.env.E2E_BOT_LOG ?? "/tmp/vdvoyom-e2e-server.log";
const PAIRS: Record<string, [number, number, string, string]> = { chrome: [41, 42, "Жора", "Зоя"], iphone: [43, 44, "Илья", "Кира"] };

test.describe.configure({ mode: "serial" });

function pairOf(name: string) {
  const p = PAIRS[name];
  test.skip(!p, "только chrome и iphone");
  return p;
}

const top = (page: Page) => page.locator(".screen.pushed").last();
const cards = (page: Page) => page.locator(".screen.pushed button.card");
const logMark = () => (fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").length : 0);
const botTo = (id: number, from: number) =>
  (fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").slice(from) : "").split(/\n(?=\[)/).filter((l) => l.startsWith(`[бот → ${id}]`));

async function api(page: Page, id: number, method: string, path: string): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ([who, m, url]) => {
      const r = await fetch(`/api${url}`, {
        method: m,
        headers: { authorization: `dev ${who}:${encodeURIComponent(`Тест ${who}`)}`, ...(m === "GET" ? {} : { "content-type": "application/json" }) },
        body: m === "GET" ? undefined : JSON.stringify({ round: 1, answers: {}, agree: true }),
      });
      return { status: r.status, text: await r.text() };
    },
    [id, method, path] as const,
  );
}

/** Старый «Языки любви»: 30 пар, в каждой — нажать карточку; шаги «1 из 30» … «30 из 30». */
async function passLove(page: Page) {
  await expect(top(page).getByText("1 из 30")).toBeVisible();
  for (let i = 1; i <= 30; i++) {
    await expect(top(page).getByText(`${i} из 30`)).toBeVisible();
    await top(page).locator("button.card").nth(i % 2).click();
  }
}

test("обычная пара проходит старый тест «Языки любви», как раньше", async ({ page }, info) => {
  const [a, b, aName, bName] = pairOf(info.project.name);
  await open(page, a, "&go=tests");
  // Список — старые семь тестов, без новых
  await expect(cards(page).filter({ hasText: "Языки любви" })).toBeVisible();
  await expect(cards(page).filter({ hasText: "Насколько ты меня знаешь" })).toBeVisible();
  await expect(cards(page)).toHaveCount(7);
  for (const t of ["Угадай меня", "Идеальное свидание", "Шпаргалка"]) await expect(page.getByText(t)).toHaveCount(0);
  // Старый результат из test_answers виден, как раньше
  const tot = cards(page).filter({ hasText: "Это или то" });
  await expect(tot.getByText("результат готов")).toBeVisible();
  await tot.click();
  await expect(top(page).getByText(/совпали в \d+ из 40/)).toBeVisible();
  await top(page).getByRole("button", { name: "Назад" }).first().click();

  // Первый проходит «Языки любви»: профиль сразу, общий результат — когда пройдёт второй
  const mark = logMark();
  await cards(page).filter({ hasText: "Языки любви" }).click();
  await passLove(page);
  await expect(top(page).getByText(`Ждём ${genitive(bName)}`)).toBeVisible();
  await expect(top(page).getByText("Твой профиль уже готов")).toBeVisible();
  // Старое сообщение бота второму (он не в приложении)
  await expect.poll(() => botTo(b, mark).join("\n")).toContain(`${aName} проходит тест «Языки любви»`);

  // Второй открывает по старой ссылке из бота test:love — тот же старый тест
  await open(page, b, "&go=test:love");
  await passLove(page);
  await expect(top(page).getByText(`Как радовать ${genitive(aName)}`)).toBeVisible();
  await expect(top(page).getByText("Все языки")).toBeVisible();
  await expect(top(page).getByRole("button", { name: "Пройти заново" })).toBeVisible();
  await expect.poll(() => botTo(a, mark).join("\n")).toContain("Результаты готовы!");
});

test("обычная пара не видит ничего нового: ни на экранах, ни в API (новое — 404)", async ({ page }, info) => {
  const [a] = pairOf(info.project.name);
  await open(page, a, "&go=settings");
  await expect(page.getByText("Разделы", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("языки любви и совместимость")).toBeVisible();
  await expect(page.getByText(/Шпаргалка про партнёра/)).toHaveCount(0);
  // В напоминаниях бота пункта «Тесты» нет
  await expect(page.getByText("Утренняя сводка")).toBeVisible();
  await expect(page.getByText(/партнёр ждёт или результаты открылись/)).toHaveCount(0);

  // Свайпы: подпись старых тестов
  await open(page, a);
  await page.locator(".tabbar").getByRole("button", { name: "Свайпы" }).click();
  await expect(page.getByText("Языки любви, «Это или то», насколько ты знаешь половинку")).toBeVisible();
  // Поиск: старая строка тестов, «шпаргалки» нет
  await page.locator(".tabbar").getByText("Главная").click();
  await page.getByRole("button", { name: "Поиск" }).first().click();
  const q = page.getByLabel("Что найти");
  await q.fill("шпаргалка");
  await expect(page.locator(".sheet").getByText("Тесты на совместимость")).toHaveCount(0);
  await q.fill("тест");
  await expect(page.locator(".sheet").getByText("языки любви, деньги, быт, будущее")).toBeVisible();

  // Ссылки на новое ведут в старый список тестов
  for (const go of ["cheatsheet"]) {
    await open(page, a, `&go=${go}`);
    await expect(cards(page).filter({ hasText: "Языки любви" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Шпаргалка" })).toHaveCount(0);
  }

  // API: новых маршрутов нет — 404, как у несуществующего адреса (не 403)
  const unknown = await api(page, a, "GET", "/net-takogo-adresa");
  for (const [m, path] of [
    ["GET", "/cheatsheet"], ["POST", "/tests/ugaday/round"], ["PUT", "/tests/ugaday/draft"], ["GET", "/tests/ugaday/rounds/1"],
  ] as const) {
    const r = await api(page, a, m, path);
    expect(r.status, `${m} ${path}`).toBe(404);
    if (unknown.status === 404) expect(r.text, `${m} ${path}`).toBe(unknown.text);
  }
  expect((await api(page, a, "GET", "/tests/ugaday")).status).toBe(404);
  const list = JSON.parse((await api(page, a, "GET", "/tests")).text).tests.map((t: { id: string }) => t.id);
  expect(list).toEqual(["love", "thisorthat", "knowme", "money", "life", "future", "dates"]);
  const me = JSON.parse((await api(page, a, "GET", "/me")).text);
  expect(me.beta).toBe(false);
  expect(JSON.parse((await api(page, a, "GET", "/home")).text).testWaiting).toBeNull();
  const plus = JSON.parse((await api(page, a, "GET", "/plus")).text);
  expect(plus.testList.map((t: { id: string }) => t.id)).toEqual(list);
});

test("бета-пара (владелец) видит новые тесты и «Шпаргалку»", async ({ page }, info) => {
  test.skip(info.project.name !== "chrome", "только чтение чужих данных — один раз");
  // Алина (2) — не админ, но в паре с владельцем: новые тесты есть
  await open(page, 2, "&go=tests");
  await expect(cards(page).filter({ hasText: "Угадай меня" })).toBeVisible();
  await expect(cards(page).filter({ hasText: "Языки любви" })).toHaveCount(0);
  const me = JSON.parse((await api(page, 2, "GET", "/me")).text);
  expect(me.beta).toBe(true);
  expect((await api(page, 2, "GET", "/cheatsheet")).status).toBe(200);
  await open(page, 2, "&go=settings");
  await expect(page.getByText(/партнёр ждёт или результаты открылись/)).toBeVisible();
});
