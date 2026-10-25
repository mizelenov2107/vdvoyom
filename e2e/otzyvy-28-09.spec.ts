// Правки по первым отзывам закрытого теста (28.09.2026, все от Матео):
// #2 письмо-сюрприз, #3 поиск по разделам, #4 календарь телефона.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("#2 письмо-сюрприз: половинка не видит его до даты открытия", async ({ page }, info) => {
  const [a, b] = info.project.name === "iphone" ? [7, 8] : [5, 6];
  const title = `Тайное ${info.project.name} ${Date.now()}`;
  await open(page, a, "&go=capsules");
  await page.locator(".screen.pushed").getByRole("button", { name: "Написать", exact: true }).click();
  const s = sheet(page);
  await s.getByPlaceholder("Прочитай, когда будет год").fill(title);
  await s.getByPlaceholder("Привет из прошлого…").fill("Сюрприз!");
  await s.getByRole("switch", { name: "Сюрприз: не уведомлять" }).click();
  await s.getByRole("button", { name: /Запечатать/ }).click();
  await expect(page.getByText("Запечатано тайно 🤫")).toBeVisible();
  await expect(page.getByText(/сюрприз 🤫/).first()).toBeVisible();

  await open(page, b, "&go=capsules");
  await expect(page.locator(".screen.pushed")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByText(/запечатано/)).toHaveCount(0);
});

test("#3 поиск: слово ведёт прямо в раздел", async ({ page }) => {
  await open(page, 1);
  await page.getByRole("button", { name: "Поиск" }).click();
  await sheet(page).getByRole("searchbox", { name: "Что найти" }).fill("письмо");
  await expect(sheet(page).getByText("Капсулы")).toBeVisible();
  await sheet(page).getByRole("searchbox", { name: "Что найти" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Капсулы" })).toBeVisible();

  await open(page, 1, "&go=more");
  await page.getByRole("button", { name: "Поиск" }).click();
  await sheet(page).getByRole("searchbox", { name: "Что найти" }).fill("когда свободны");
  await sheet(page).getByText("Когда оба свободны").click();
  await expect(page.getByText(/Запас до встречи/)).toBeVisible();
});

test("#4 календарь телефона: ссылка на подписку отдаёт .ics с событиями пары", async ({ page }) => {
  await open(page, 1, "&go=calendar");
  await page.getByRole("button", { name: "В календарь телефона" }).click();
  await expect(sheet(page).getByRole("button", { name: /Подключить календарь/ })).toBeEnabled();
  const link = await page.request.get("/api/calendar/link", { headers: { authorization: `dev 1:${encodeURIComponent("Миша")}` } });
  const { https } = (await link.json()) as { https: string };
  const ics = await page.request.get(new URL(https).pathname.replace(/^/, "http://localhost:3100"));
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = await ics.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("X-WR-CALNAME:Вдвоём");
});
