// Вопрос дня: реакция смайликом на ответ половинки и переписка «ответ на ответ».
// Пары 5+6 (chrome) и 7+8 (iphone): движки идут параллельно, общая пара мешала бы.
import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test("вопрос дня: оба ответили — реакция и ответ на ответ видны второму", async ({ page }, info) => {
  const [a, b] = info.project.name === "iphone" ? [7, 8] : [5, 6];
  const answer = async (who: number, text: string) => {
    await open(page, who, "&go=daily");
    const box = page.getByPlaceholder("Твой ответ…");
    // Ждём, пока экран загрузится: либо поле ответа, либо уже данный ответ
    await expect(box.or(page.getByRole("button", { name: "Изменить" }))).toBeVisible();
    if (await box.count()) {
      await box.fill(text);
      await page.getByRole("button", { name: /^Ответить/ }).click();
    }
    await expect(page.getByText(text)).toBeVisible();
  };
  await answer(a, "На море, конечно");
  // До ответа второго реакций нет
  await expect(page.getByRole("group", { name: /Реакция на ответ/ })).toHaveCount(0);
  await answer(b, "В горы!");

  // Второй реагирует на ответ первого и отвечает на него
  const heart = page.getByRole("button", { name: "❤️" });
  if ((await heart.getAttribute("aria-pressed")) !== "true") await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  const reply = `Море в следующий раз 😄 ${Date.now()}`;
  await page.getByRole("textbox", { name: "Ответ на ответ" }).fill(reply);
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText(reply)).toBeVisible();

  // Первый видит смайлик на своём ответе и сообщение
  await open(page, a, "&go=daily");
  await expect(page.getByLabel(/Реакция .*: ❤️/).first()).toBeVisible();
  await expect(page.getByText(reply)).toBeVisible();
  // Свою реакцию можно снять повторным нажатием
  const own = page.getByRole("button", { name: "😂" });
  await own.click();
  await expect(own).toHaveAttribute("aria-pressed", "true");
  await own.click();
  await expect(own).toHaveAttribute("aria-pressed", "false");
});
