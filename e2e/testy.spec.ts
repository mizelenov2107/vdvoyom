// Тесты на совместимость, формат 2 (08.10.2026). Путь двух живых людей: начать раунд, ответить про себя и угадать,
// вернуться назад, пропустить, закрыть приложение посреди теста и продолжить с
// того же места; результат открывается только когда ответили оба; кнопка
// действия создаёт дело, событие или заметку; второй раунд не переписывает первый.
// Свои пары у движков: 29+30 (chrome), 31+32 (iphone) — см. e2e/seed.ts. Обе в бете новых
// тестов (ADMIN_IDS в playwright.config.ts): у обычных пар — старые тесты, e2e/testy-v1.spec.ts.
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { open, sheet } from "./helpers.ts";
import { genitive } from "../web/src/fmt.ts";

const BOT_LOG = process.env.E2E_BOT_LOG ?? "/tmp/vdvoyom-e2e-server.log";
const PAIRS: Record<string, [number, number, string, string]> = { chrome: [29, 30, "Ася", "Тимур"], iphone: [31, 32, "Яна", "Лев"] };

test.describe.configure({ mode: "serial" });

function pairOf(name: string) {
  const p = PAIRS[name];
  test.skip(!p, "только chrome и iphone");
  return p;
}

const logMark = () => (fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").length : 0);
function botTo(id: number, from: number): string[] {
  const log = fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").slice(from) : "";
  return log.split(/\n(?=\[)/).filter((l) => l.startsWith(`[бот → ${id}]`));
}

const question = (page: Page) => page.locator(".screen.pushed .title-lg").first();
const groups = (page: Page) => page.locator(".screen.pushed [role=radiogroup]");
/** Верхний открытый экран: под ним может лежать список тестов с теми же словами */
const top = (page: Page) => page.locator(".screen.pushed").last();

/** Один вопрос: ответ про себя, потом догадка; ждём, пока сменится вопрос или появится «Отправить». */
async function answerOne(page: Page, self: number, guess: number) {
  const before = await question(page).textContent();
  await groups(page).first().getByRole("radio").nth(self).click();
  await expect(page.getByRole("button", { name: /изменить/ })).toBeVisible();
  await groups(page).first().getByRole("radio").nth(guess).click();
  await expect
    .poll(async () => (await page.getByRole("button", { name: "Отправить ответы" }).isVisible()) || (await question(page).textContent()) !== before)
    .toBe(true);
}

async function answerRest(page: Page, self: number, guess: number) {
  for (let k = 0; k < 15; k++) {
    if (await page.getByRole("button", { name: "Отправить ответы" }).isVisible()) return;
    await answerOne(page, self, guess);
  }
}

async function apiGet(page: Page, id: number, path: string): Promise<string> {
  return page.evaluate(
    async ([who, url]) => {
      const r = await fetch(`/api${url}`, { headers: { authorization: `dev ${who}:${encodeURIComponent(`Тест ${who}`)}` } });
      return r.text();
    },
    [id, path] as const,
  );
}

test("раунд «Угадай меня»: назад, пропуск, черновик переживает перезагрузку, сообщение партнёру — только после отправки", async ({ page }, info) => {
  const [a, b, , bName] = pairOf(info.project.name);
  const mark = logMark();
  await open(page, a, "&go=test:ugaday");
  await expect(top(page).getByText(/На каждом вопросе — ответ про себя/)).toBeVisible();
  await page.getByRole("button", { name: "Начать" }).click();

  // Вопрос 1: ответ про себя → на том же экране догадка «А что выберет …»
  const q1 = await question(page).textContent();
  await groups(page).first().getByRole("radio").nth(0).click();
  await expect(groups(page).first()).toHaveAttribute("aria-label", new RegExp(bName));
  await groups(page).first().getByRole("radio").nth(0).click();
  await expect(question(page)).not.toHaveText(q1!);

  // Назад: ответ на первый вопрос на месте
  await page.getByRole("button", { name: "Назад" }).last().click();
  await expect(question(page)).toHaveText(q1!);
  await expect(page.getByRole("button", { name: /изменить/ })).toBeVisible();
  await groups(page).first().getByRole("radio").nth(0).click(); // та же догадка — дальше
  await expect(question(page)).not.toHaveText(q1!);

  // Пропуск: второй вопрос
  await page.getByRole("button", { name: /^Пропустить/ }).click();
  await expect(page.getByRole("button", { name: "Пропустить (ещё 1)" })).toBeVisible();
  await answerOne(page, 0, 0); // третий

  // Закрыли приложение посреди теста — черновик на сервере, продолжаем с четвёртого
  await page.waitForTimeout(800); // черновик уходит сразу после ответа
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Вопрос 1, отвечен" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Вопрос 2, пропущен" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Вопрос 3, отвечен" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Пропустить (ещё 1)" })).toBeVisible();
  expect(botTo(b, mark).filter((l) => l.includes("тест")), "пока тест не отправлен, бот о нём молчит").toEqual([]);

  await answerRest(page, 0, 0);
  await page.getByRole("button", { name: "Отправить ответы" }).click();
  await expect(top(page).getByText(`Ждём ответов ${genitive(bName)}`)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Напомнить ${bName.slice(0, 2)}`) })).toBeVisible();
  // Сообщение «ждёт тебя» — после отправки, без «проходит»
  await expect.poll(() => botTo(b, mark).join("\n")).toContain("ждёт тебя в тесте «Угадай меня»");
  expect(botTo(b, mark).join("\n")).not.toContain("проходит");
});

test("результат открывается только когда ответили оба; кнопка действия создаёт сущность", async ({ page }, info) => {
  const [a, b, aName, bName] = pairOf(info.project.name);
  // Второй: тест ждёт, ответы первого не видны
  await open(page, b, "&go=tests");
  await expect(page.locator(".screen.pushed button.card", { hasText: "Угадай меня" }).getByText(`${aName} ждёт тебя`)).toBeVisible();
  await page.locator(".screen.pushed button.card", { hasText: "Угадай меня" }).click();
  await expect(top(page).getByText(`${aName} уже ждёт`, { exact: false })).toBeVisible();
  const raw = await apiGet(page, b, "/tests/ugaday");
  expect(JSON.parse(raw).round.partner, "ответы первого не отдаются").toBeNull();
  await page.getByRole("button", { name: "Начать" }).click();
  // Всё иначе, чем у первого: про себя второй вариант, догадка тоже второй — сюрпризы
  await answerRest(page, 1, 1);
  await page.getByRole("button", { name: "Отправить ответы" }).click();
  // «0 совпали» больше нет (11.10.2026): плитка «одинаково», ноль — в конце и с нормальной фразой
  await expect(top(page).getByText("одинаково", { exact: true })).toBeVisible();
  await expect(top(page).getByText("совпали", { exact: true })).toHaveCount(0);
  await expect(top(page).getByText(/Ты угадываешь, что выберет/)).toBeVisible();

  // Первый видит тот же результат
  await open(page, a, "&go=test:ugaday");
  await expect(top(page).getByText("Сюрпризы: новое друг о друге")).toBeVisible();
  const card = page.getByTestId("diff-card").first();
  await expect(card.getByText(bName, { exact: true })).toBeVisible();
  // Кто кого угадал — словами: напротив ответа партнёра — про тебя, напротив твоего — про партнёра
  await expect(card.getByText("ты не угадываешь: новое")).toBeVisible();
  await expect(card.getByText(`${bName} не угадывает: новое`)).toBeVisible();
  await expect(card.getByText("✓ угадано")).toHaveCount(0);
  // Промах уже лежит в шпаргалке сам: у таких карточек вместо «＋ Запомнить» сразу «В шпаргалке · открыть» (проверка 08.10)
  const view = JSON.parse(await apiGet(page, a, "/tests/ugaday")).round as { questions: { id: string; self: string; act: { type: string } | null }[]; marks: { acts: Record<string, string> } };
  const auto = view.questions.filter((x) => x.act?.type === "cheat" && view.marks.acts[x.id] === "cheat");
  for (const x of auto) {
    const c = page.getByTestId("diff-card").filter({ hasText: x.self });
    if (await c.count()) await expect(c.getByRole("button", { name: /В шпаргалке · открыть/ })).toBeVisible();
  }
  // Действие: создаётся только по нажатию и ровно одно (если в раунде все действия — шпаргалка, проверять нечего)
  const withPlus = page.getByTestId("diff-card").filter({ has: page.getByRole("button", { name: /^＋/ }) }).first();
  if (await withPlus.count()) {
    // Карточку держим по тексту вопроса: после нажатия «＋» у неё уже нет
    const qText = (await withPlus.locator("div").first().textContent())!;
    const actCard = page.getByTestId("diff-card").filter({ hasText: qText });
    const act = actCard.getByRole("button", { name: /^＋/ });
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/tests/ugaday/act")), act.click()]);
    const { ref } = (await res.json()) as { ref: string };
    await expect(actCard.getByRole("button", { name: /открыть/ })).toBeVisible();
    const [kind, id] = ref.split(":");
    const lists: Record<string, string> = { task: "/tasks", event: "/events", wish: "/wishes", goal: "/goals", plan: "/plans", capsule: "/capsules", note: "/notes", cheat: "/cheatsheet" };
    const body = await apiGet(page, a, lists[kind]);
    if (kind === "cheat") expect(JSON.parse(body).entries.length).toBeGreaterThan(0);
    else expect(body, `${kind} создан`).toContain(`"id":${id}`);
  }
  // «Обсудили» видят оба
  await card.getByRole("button", { name: "Обсудили?" }).click();
  await expect(card.getByRole("button", { name: "Обсудили" })).toBeVisible();
  expect(JSON.parse(await apiGet(page, b, "/tests/ugaday")).round.marks.talked.length).toBe(1);
  // «Поговорить сейчас» — по одному расхождению
  await page.getByRole("button", { name: "Поговорить сейчас" }).click();
  await expect(sheet(page).getByText(/Поговорить сейчас · 1 из/)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("второй раунд — новые вопросы, первый результат остаётся в прошлых раундах", async ({ page }, info) => {
  const [a, b] = pairOf(info.project.name);
  await open(page, a, "&go=test:ugaday");
  const first = JSON.parse(await apiGet(page, a, "/tests/ugaday")).round;
  // «Новый раунд» — и рядом с итогом, на первом экране результата (раньше — в 4 700 px ниже)
  await expect(page.getByTestId("next-round-top")).toBeInViewport();
  await page.getByTestId("next-round-top").click();
  const q = await question(page).textContent();
  // Android 448×646, шаг догадки: «Назад» и «Пропустить» не уходят за нижний край
  await page.setViewportSize({ width: 448, height: 646 });
  await groups(page).first().getByRole("radio").nth(0).click();
  for (const name of [/^Назад$/, /^Пропустить/]) await expect(page.getByTestId("test-nav").getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /изменить/ })).toBeVisible();
  await groups(page).first().getByRole("radio").nth(1).click(); // догадка на первый вопрос
  await expect(question(page)).not.toHaveText(q!);
  expect(first.questions.map((x: { self: string }) => x.self), "вопросы не повторяются").not.toContain(q);
  await answerRest(page, 0, 1);
  await page.getByRole("button", { name: "Отправить ответы" }).click();
  await open(page, b, "&go=test:ugaday");
  await page.getByRole("button", { name: "Начать" }).click();
  await answerRest(page, 0, 0);
  await page.getByRole("button", { name: "Отправить ответы" }).click();
  await expect(top(page).getByText("Прошлые раунды")).toBeVisible();
  await page.getByRole("button", { name: /Раунд 1/ }).click();
  const old = JSON.parse(await apiGet(page, b, "/tests/ugaday/rounds/1")).round;
  expect(old.summary.counts).toEqual(first.summary.counts);
  expect(old.questions.map((x: { id: string }) => x.id)).toEqual(first.questions.map((x: { id: string }) => x.id));
  await expect(top(page).getByText(/^раунд 1 ·/)).toBeVisible();
});

test("«Идеальное свидание»: итог — свидание и идеи, «Запланировать» создаёт приглашение", async ({ page }, info) => {
  const [a, b] = pairOf(info.project.name);
  const pass = async (who: number, pick: number) => {
    await open(page, who, "&go=test:svidanie");
    await page.getByRole("button", { name: "Начать" }).click();
    for (let k = 0; k < 15; k++) {
      if (await page.getByRole("button", { name: "Отправить ответы" }).isVisible()) break;
      const before = await question(page).textContent();
      await groups(page).first().getByRole("radio").nth(pick).click();
      await expect.poll(async () => (await page.getByRole("button", { name: "Отправить ответы" }).isVisible()) || (await question(page).textContent()) !== before).toBe(true);
    }
    await page.getByRole("button", { name: "Отправить ответы" }).click();
  };
  await pass(a, 0);
  await pass(b, 1);
  await expect(top(page).getByText("Ваше свидание")).toBeVisible();
  const plan = page.getByRole("button", { name: "Запланировать на субботу" }).first();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/tests/svidanie/act")), plan.click()]);
  const { ref } = (await res.json()) as { ref: string };
  expect(ref).toMatch(/^event:\d+$/);
  const events = JSON.parse(await apiGet(page, b, "/events")).events as { id: number; kind: string; status: string }[];
  const ev = events.find((e) => `event:${e.id}` === ref)!;
  expect([ev.kind, ev.status]).toEqual(["date", "proposed"]);
  await expect(page.getByRole("button", { name: /В календаре · открыть/ })).toBeVisible();
});

test("старая ссылка на тест из бота (test:love) не роняет приложение", async ({ page }, info) => {
  const [a] = pairOf(info.project.name);
  await open(page, a, "&go=test:love");
  await expect(top(page).getByText("Этого теста больше нет")).toBeVisible();
  await page.getByRole("button", { name: "Все тесты" }).click();
  await expect(page.locator(".screen.pushed button.card", { hasText: "Угадай меня" })).toBeVisible();
});
