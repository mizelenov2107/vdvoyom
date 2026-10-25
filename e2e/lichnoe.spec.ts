// Личные дела «Только я» (08.10.2026, просьба владельца: «у меня маникюр, спортзал —
// чтобы можно было так добавлять»). Своё дело добавляется той же шторкой, что и общее
// событие: видно у обоих в календаре, общее окно его обходит, его можно поменять и
// удалить; «Зал» каждую неделю стоит и через неделю. Пары 25+26 (chrome) и 27+28
// (iphone) без расписания: весь день свободен, окно рвёт только маникюр.
import { expect, test, type Page } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

const mskToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

async function pickDay(page: Page, d: string) {
  const months = (Number(d.slice(0, 4)) - Number(mskToday().slice(0, 4))) * 12 + Number(d.slice(5, 7)) - Number(mskToday().slice(5, 7));
  for (let i = 0; i < months; i++) await page.getByRole("button", { name: "Позже" }).click();
  await page.locator(".month button.day:not(.out)", { hasText: new RegExp(`^${Number(d.slice(8))}$`) }).first().click();
}

async function calendarOn(page: Page, who: number, d: string) {
  await open(page, who, "&go=calendar");
  await pickDay(page, d);
}

async function addSolo(page: Page, preset: string, from: string, to: string, weekly = false) {
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Только я", exact: true }).click();
  await sheet(page).getByRole("button", { name: preset, exact: true }).click();
  await expect(sheet(page).getByPlaceholder("Маникюр")).toHaveValue(preset);
  await sheet(page).getByLabel("С", { exact: true }).fill(from);
  await sheet(page).getByLabel("До", { exact: true }).fill(to);
  if (weekly) await sheet(page).getByRole("button", { name: /^каждую неделю/ }).click();
  await sheet(page).getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
}

test("«Только я»: маникюр завтра виден у обоих, окно его обходит; меняется и удаляется", async ({ page }, info) => {
  const [a, b] = info.project.name === "iphone" ? [27, 28] : [25, 26];
  const aName = a === 27 ? "Уля" : "Сева";
  const tomorrow = addDays(mskToday(), 1);
  const nail = page.locator(".card", { hasText: "Маникюр" });

  await calendarOn(page, a, tomorrow);
  await expect(page.getByText("Оба свободны 10:00–23:00")).toBeVisible();
  await addSolo(page, "Маникюр", "15:00", "16:00");
  await expect(nail).toContainText("15:00–16:00");
  await expect(nail).toContainText("у тебя");
  // Занятость учтена: общее окно разрезано маникюром
  await expect(page.getByText("Оба свободны 10:00–15:00")).toBeVisible();
  await expect(page.getByText("Оба свободны 16:00–23:00")).toBeVisible();
  await expect(page.getByText("Оба свободны 10:00–23:00")).toHaveCount(0);

  // У партнёра: то же дело с именем владельца, окна те же
  await calendarOn(page, b, tomorrow);
  await expect(nail).toContainText("15:00–16:00");
  await expect(nail).toContainText(aName);
  await expect(page.getByText("Оба свободны 16:00–23:00")).toBeVisible();
  // И в «Когда свободны»
  await open(page, b, "&go=windows");
  await page.getByRole("button", { name: "Общие окна", exact: true }).click();
  await expect(page.getByText("16:00 – 23:00").first()).toBeVisible();

  // Владелец открывает дело, переносит на 17:00 и удаляет
  await calendarOn(page, a, tomorrow);
  await nail.click();
  await sheet(page).getByRole("button", { name: "Изменить", exact: true }).click();
  await sheet(page).getByLabel("С", { exact: true }).fill("17:00");
  await sheet(page).getByLabel("До", { exact: true }).fill("18:00");
  await sheet(page).getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(nail).toContainText("17:00–18:00");
  await expect(page.getByText("Оба свободны 10:00–17:00")).toBeVisible();
  await nail.click();
  await sheet(page).getByRole("button", { name: /Удалить/ }).click();
  await expect(nail).toHaveCount(0);
  await expect(page.getByText("Оба свободны 10:00–23:00")).toBeVisible();
});

test("«Только я» каждую неделю: зал стоит и через неделю, у обоих", async ({ page }, info) => {
  const [a, b] = info.project.name === "iphone" ? [27, 28] : [25, 26];
  const aName = a === 27 ? "Уля" : "Сева";
  const first = addDays(mskToday(), 2);
  const gym = page.locator(".card", { hasText: "Зал" });

  await calendarOn(page, a, first);
  await addSolo(page, "Зал", "19:00", "21:00", true);
  await expect(gym).toContainText("19:00–21:00");
  await expect(gym).toContainText("каждую неделю");

  await calendarOn(page, a, addDays(first, 7));
  await expect(gym).toContainText("у тебя");
  await calendarOn(page, b, addDays(first, 7));
  await expect(gym).toContainText(aName);
  await expect(gym).toContainText("каждую неделю");
  // В другие дни недели зала нет
  await calendarOn(page, b, addDays(first, 3));
  await expect(gym).toHaveCount(0);
});

// Тест 11.10.2026: пока половинки нет, календарь писал «Оба свободны … Позвать», а «Позвать»
// открывало шторку свидания. Теперь — «Свободно …» и приглашение в приложение.
test("один, без половинки: «Свободно …» и «Позвать половинку» ведёт к приглашению", async ({ page }, info) => {
  const who = info.project.name === "iphone" ? 542 : 541;
  await open(page, who);
  const ok = await page.evaluate(async (id) => {
    const r = await fetch("/api/me", {
      method: "POST",
      headers: { authorization: `dev ${id}:${encodeURIComponent(`Тест ${id}`)}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Артём", consent: true, onboarded: true }),
    });
    return r.ok;
  }, who);
  expect(ok).toBeTruthy();
  await calendarOn(page, who, addDays(mskToday(), 1));
  await expect(page.getByText(/^Свободно \d\d:\d\d–\d\d:\d\d$/).first()).toBeVisible();
  await expect(page.getByText(/Оба свободны/)).toHaveCount(0);
  await page.getByRole("button", { name: "Позвать половинку" }).first().click();
  await expect(sheet(page).getByText("Позови половинку")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: /Отправить ссылку в Телеграм/ })).toBeVisible();
});
