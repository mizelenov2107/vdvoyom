// Знакомство нового человека: профиль, согласие на обработку данных, приглашение.
// 11.10.2026: шага «Что вам нужно» больше нет (все разделы включены, выключают в
// «Ещё» → «Настроить разделы»); согласие — отдельная галочка, без неё «Дальше» неактивна;
// после отправки ссылки — понятный следующий шаг; второй в паре видит «Поехали»,
// а не «Присоединиться», и цвет половинки у него занят.
import { expect, test, type Page } from "@playwright/test";
import { open } from "./helpers.ts";

/** Запрос к API от имени тестового человека — из страницы, как это делает приложение. */
async function api(page: Page, id: number, path: string, body?: unknown) {
  const r = await page.evaluate(
    async ([who, url, data]) => {
      const res = await fetch(`/api${url}`, {
        method: data === undefined ? "GET" : "POST",
        headers: { authorization: `dev ${who}:${encodeURIComponent(`Тест ${who}`)}`, "content-type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { ok: res.ok, text: await res.text() };
    },
    [id, path, body] as const,
  );
  expect(r.ok, `${path}: ${r.text}`).toBeTruthy();
  return JSON.parse(r.text);
}

test("новый человек: согласие галочкой, без шага разделов, ссылка отправлена — «Готово, в приложение»", async ({ page }, info) => {
  const who = info.project.name === "chrome" ? 501 : 502; // у каждого движка свой новый человек
  await page.addInitScript(() => { window.open = () => null; }); // «Отправить ссылку» открыл бы t.me
  await open(page, who);
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByPlaceholder("Имя").fill("Аня");

  const consent = page.getByRole("checkbox", { name: /согласие на обработку/ });
  await expect(consent).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Дальше" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Согласие на обработку данных" })).toBeVisible();
  // Нажимается вся строка, а не только кружок 28×28
  expect((await consent.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await consent.click();
  await expect(consent).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Дальше" }).click();

  await expect(page.getByRole("heading", { name: "Позови половинку" })).toBeVisible();
  await expect(page.getByText("Что вам нужно")).toHaveCount(0);
  await expect(page.getByText("Шаг 2 из 2")).toBeVisible();
  // Шаг открывается сверху, заголовок не срезан
  expect(await page.locator(".screen").first().evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole("button", { name: /Отправить ссылку/ }).click();
  await expect(page.getByText("Ссылка у половинки.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Позову позже" })).toHaveCount(0);
  await page.getByRole("button", { name: "Готово, в приложение" }).click();
  await expect(page.locator(".tabbar")).toBeVisible();
});

test("второй по приглашению: «Поехали», цвет половинки занят, согласие обязательно", async ({ page }, info) => {
  const [a, b] = info.project.name === "chrome" ? [511, 512] : [521, 522];
  await open(page, a);
  await api(page, a, "/me", { name: "Артём", color: "violet" });
  const me = await api(page, a, "/me");
  await api(page, b, "/pair/join", { code: me.pair.invite });

  await page.goto(`/?dev=${b}&still=1&theme=light&promo=0`);
  await expect(page.getByRole("heading", { name: /Артём зовёт тебя/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Присоединиться" })).toHaveCount(0);
  await page.getByRole("button", { name: "Поехали" }).click();

  await expect(page.getByRole("button", { name: /фиолетовый, цвет Артёма/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "розовый", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Фиолетовый уже у Артёма", { exact: false })).toBeVisible();
  await page.getByPlaceholder("Имя").fill("Лиза");
  await expect(page.getByRole("button", { name: "Дальше" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /согласие на обработку/ }).click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await expect(page.getByRole("heading", { name: "Вы вдвоём 💞" })).toBeVisible();
  await page.getByRole("button", { name: "В приложение" }).click();
  await expect(page.locator(".tabbar")).toBeVisible();
  const her = await api(page, b, "/me");
  expect(her.me.consented).toBe(true);
  expect(her.me.color).toBe("rose");
});
