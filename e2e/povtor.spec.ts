// Повтор событий (07.10.2026, разбор отзывов на You&Me, Paired и Between: «нет повторяющихся
// событий» — самая частая просьба к You&Me). Событие «каждую неделю» стоит и через неделю,
// и через две; у половинки тоже. Пары 21+22 (chrome) и 23+24 (iphone), как в shag4.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

const mskToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

async function pickDay(page: Page, d: string) {
  const months = (Number(d.slice(0, 4)) - Number(mskToday().slice(0, 4))) * 12 + Number(d.slice(5, 7)) - Number(mskToday().slice(5, 7));
  for (let i = 0; i < months; i++) await page.getByRole("button", { name: "Позже" }).click();
  await page.locator(".month button.day:not(.out)", { hasText: new RegExp(`^${Number(d.slice(8))}$`) }).first().click();
}

test("событие «каждую неделю» стоит через неделю и через две — у обоих", async ({ page }, info) => {
  const [a, b] = info.project.name === "iphone" ? [23, 24] : [21, 22];
  const title = `Бассейн ${info.project.name} ${Date.now() % 100000}`;
  await open(page, a, "&go=calendar");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await sheet(page).getByPlaceholder("Ужин у мамы").fill(title);
  await sheet(page).getByRole("button", { name: "каждую неделю", exact: true }).click();
  await sheet(page).getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator(".card", { hasText: title })).toContainText("каждую неделю");

  for (const [who, shift] of [[a, 7], [b, 14]] as const) {
    await open(page, who, "&go=calendar");
    await pickDay(page, addDays(mskToday(), shift));
    await expect(page.locator(".card", { hasText: title })).toContainText("каждую неделю");
  }
  // А через три дня его нет: повтор не размазывается по всем дням
  await open(page, a, "&go=calendar");
  await pickDay(page, addDays(mskToday(), 3));
  await expect(page.locator(".card", { hasText: title })).toHaveCount(0);
});
