// Админка владельца: новый человек, его действия, блокировка и возврат доступа.
// Миша (1) — админ (ADMIN_IDS=1 в playwright.config). Новый человек у каждого движка свой.
import { expect, test } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

test("админка: новый человек виден с первым входом, блокировка закрывает ему приложение", async ({ page }, info) => {
  const who = info.project.name === "iphone" ? 12 : 11;
  // Первый вход: ждём ответ /api/me (живой канал /api/stream не даёт сети «затихнуть»)
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/me")), page.goto(`/?dev=${who}&still=1&theme=light&promo=0`)]);

  await open(page, 1, "&go=admin");
  await expect(page.getByText("Людей всего")).toBeVisible();
  await page.getByRole("button", { name: "Люди", exact: true }).click();
  await page.locator("button.card", { hasText: `Тест ${who}` }).first().click();
  const s = sheet(page);
  await expect(s.getByText("🆕 первый вход").first()).toBeVisible();
  await s.getByRole("button", { name: "Заблокировать" }).click();
  await expect(page.getByText("Доступ закрыт", { exact: true })).toBeVisible();

  await page.goto(`/?dev=${who}&still=1&theme=light&promo=0`);
  await expect(page.getByText("Доступ к «Вдвоём» закрыт")).toBeVisible();

  await open(page, 1, "&go=admin");
  await page.getByRole("button", { name: "Люди", exact: true }).click();
  await page.locator("button.card", { hasText: `Тест ${who}` }).first().click();
  await sheet(page).getByRole("button", { name: "Вернуть доступ" }).click();
  await expect(page.getByText("Доступ возвращён")).toBeVisible();
});

test("у обычного человека админки нет, а сервер её не отдаёт", async ({ page }) => {
  await open(page, 2, "&go=more");
  await expect(page.getByText("Написать отзыв")).toBeVisible();
  await expect(page.getByText("Админка")).toHaveCount(0);
  const r = await page.request.get("/api/admin/overview", { headers: { authorization: `dev 2:${encodeURIComponent("Алина")}` } });
  expect(r.status()).toBe(403);
});

// Воронка, блогеры и подарок «Вдвоём+» (11.10.2026). Новый человек приходит по ссылке
// блогера (?startapp=b_<код> — в браузере уходит на сервер как start_param), владелец
// видит его метку в воронке, заводит блогера и дарит паре «Вдвоём+» навсегда.
const SHOTS = "issledovanie/pochinka-2026-10-11/D";

test("админка: источник прихода в воронке, блогер в справочнике, подарок «Вдвоём+»", async ({ page }, info) => {
  const who = info.project.name === "iphone" ? 92 : 91;
  const code = `e2e${who}`;
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/me")), page.goto(`/?dev=${who}&still=1&theme=light&promo=0&startapp=b_${code}`)]);

  await open(page, 1, "&go=admin");
  await page.getByRole("button", { name: "Воронка", exact: true }).click();
  await expect(page.getByText("Старты", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".admin-table").first().getByText(`b_${code}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/voronka-shagi-${info.project.name}.png` });

  // Блогер в справочник: строка воронки получает имя
  await page.getByRole("button", { name: "Добавить блогера" }).click();
  const s = sheet(page);
  await s.getByPlaceholder("anya_dima").fill(code);
  await s.getByPlaceholder("Аня и Дима").fill(`Блогер ${who}`);
  await s.getByPlaceholder("инстаграм").fill("инстаграм");
  await s.getByRole("button", { name: "Добавить" }).click();
  await expect(page.getByText("Блогер добавлен")).toBeVisible();
  await expect(page.locator(".admin-table").first().getByText(`Блогер ${who}`)).toBeVisible();
  await expect(page.getByText(`b_${code} · инстаграм`)).toBeVisible();
  await page.getByText("По источникам").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector(".section")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2500); // тост «Блогер добавлен» уходит
  await page.screenshot({ path: `${SHOTS}/voronka-tablicy-${info.project.name}.png` });

  // Подарок «Вдвоём+» из карточки человека — в его паре
  await page.getByRole("button", { name: "Люди", exact: true }).click();
  await page.locator("button.card", { hasText: `Тест ${who}` }).first().click();
  const card = sheet(page);
  await expect(card.getByText(`метка прихода: b_${code}`)).toBeVisible();
  await expect(card.getByText(/источник: Блогер/)).toBeVisible();
  await card.getByRole("button", { name: "Навсегда", exact: true }).click();
  await card.getByRole("button", { name: "Выдать «Вдвоём+» навсегда" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); // пилюля срока перекрашивается с переходом
  await page.screenshot({ path: `${SHOTS}/podarok-forma-${info.project.name}.png` });
  await card.getByRole("button", { name: "Выдать «Вдвоём+» навсегда" }).click();
  await expect(page.getByText("«Вдвоём+» выдан навсегда")).toBeVisible();
  await expect(card.getByText("🎁 подарок, навсегда")).toBeVisible();
  await expect(card.getByRole("button", { name: /Выдать/ })).toHaveCount(0);
  await card.getByText("«Вдвоём+»", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/podarok-${info.project.name}.png` });

  // Сам человек видит «Вдвоём+» навсегда
  const r = await page.request.get("/api/plus", { headers: { authorization: `dev ${who}:${encodeURIComponent(`Тест ${who}`)}` } });
  expect((await r.json()).forever).toBe(true);
});
