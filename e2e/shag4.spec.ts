// Шаг 4 проекта «Мини-апп Вдвоём»: восемь пунктов прогона на двух телефонах,
// переведённые в проверки на локальном экземпляре с тестовой базой. Два человека —
// два отдельных браузера (у каждого свой «телефон»), пара своя у каждого движка:
// 21+22 в chrome и 23+24 в iphone (e2e/seed.ts), поэтому прогоны не мешают друг другу.
//
// Сообщения бота: без BOT_TOKEN сервер пишет их в журнал строкой «[бот → id] текст»,
// playwright.config.ts копирует журнал в /tmp/vdvoyom-e2e-server.log. Это проверяет,
// что сервер отправил сообщение нужному человеку; дойдёт ли оно через Telegram,
// видно только на живых телефонах.
//
// Чего локально не проверить и что остаётся на живой прогон:
//  (б) нажатие кнопки «Иду» в самом чате (здесь — та же кнопка в приложении, тот же answerInvite);
//  (е) сверка с живым rasp.rea.ru для её группы (здесь страница в формате сайта идёт через parseWeek);
//  (ж) настоящие 8:30 (здесь минутный цикл крона вызывается с часами на 8:35 завтрашнего дня).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { open, sheet } from "./helpers.ts";

// Журнал бота: общий прогон — /tmp/vdvoyom-e2e-server.log, копия конфига может задать свой (BOT_LOG)
const BOT_LOG = process.env.BOT_LOG ?? "/tmp/vdvoyom-e2e-server.log";
// Сервер и база прогона: по умолчанию общие, копия конфига агента подставляет свои
const E2E_API = process.env.E2E_API ?? "http://localhost:3100";
const E2E_DB = process.env.E2E_DB ?? "/tmp/vdvoyom-e2e.db";
const E2E_SUFFIX = process.env.E2E_SUFFIX ?? "";
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");
// Те же сдвиги, что у пар «с сайта РЭУ» в e2e/seed.ts
const REA_DNI = [2, 5];

const pairOf = (info: TestInfo): [number, number] => (info.project.name === "iphone" ? [23, 24] : [21, 22]);
const NAMES: Record<number, string> = { 21: "Лёва", 22: "Нина", 23: "Митя", 24: "Оля" };

const mskToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Второй телефон: свой контекст браузера с теми же размерами и движком. */
async function phone(browser: Browser, info: TestInfo): Promise<Page> {
  const u = info.project.use;
  const ctx = await browser.newContext({
    viewport: u.viewport ?? undefined, userAgent: u.userAgent, isMobile: u.isMobile, hasTouch: u.hasTouch,
    deviceScaleFactor: u.deviceScaleFactor, locale: "ru-RU", timezoneId: "Europe/Moscow",
  });
  return ctx.newPage();
}

/** Строки журнала бота для человека, появившиеся после отметки `from` (длина журнала в байтах). */
function botTo(id: number, from: number): string[] {
  const log = fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").slice(from) : "";
  // сообщение многострочное: новое начинается со строки «[бот → …]» или другой записи журнала
  return log.split(/\n(?=\[)/).filter((l) => l.startsWith(`[бот → ${id}]`));
}
const logMark = () => (fs.existsSync(BOT_LOG) ? fs.readFileSync(BOT_LOG, "utf8").length : 0);

/** Картинка заданного цвета, нарисованная самим браузером: JPEG, как с камеры. */
async function jpeg(page: Page, color: string): Promise<Buffer> {
  const b64 = await page.evaluate((c) => {
    const cv = document.createElement("canvas");
    cv.width = 600;
    cv.height = 800;
    const g = cv.getContext("2d")!;
    g.fillStyle = c;
    g.fillRect(0, 0, 600, 800);
    return cv.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, color);
  return Buffer.from(b64, "base64");
}

test.describe("шаг 4: прогон пары", () => {
  test("(а) фильмы: оба ставят «хочу» одному фильму — у обоих мэтч на весь экран", async ({ page, browser }, info) => {
    const [a, b] = pairOf(info);
    const her = await phone(browser, info);
    await open(page, a, "&go=movies");
    await open(her, b, "&go=movies");
    const top = (p: Page) => p.locator(".swipe-card .title-lg").last();
    await expect(top(page)).toBeVisible();
    const film = (await top(page).textContent())!.trim();
    await page.getByRole("button", { name: "хочу", exact: true }).click();
    await expect(top(page)).not.toHaveText(film);

    // У неё тот же фильм в колоде: свежая пара, порядок колоды общий
    await expect(top(her)).toBeVisible();
    for (let i = 0; i < 10 && (await top(her).textContent())!.trim() !== film; i++) {
      await her.getByRole("button", { name: "не хочу", exact: true }).click();
    }
    await expect(top(her)).toHaveText(film);
    await her.getByRole("button", { name: "хочу", exact: true }).click();

    // Мэтч на весь экран у неё (ответ на свайп) и у него (живой канал)
    for (const p of [her, page]) {
      await expect(p.getByRole("heading", { name: "Мэтч!" })).toBeVisible();
      await expect(p.locator(".match")).toContainText(film);
    }
    await her.context().close();
  });

  test("(б) «Когда свободны»: позвать в общее окно — у неё сообщение, «Иду», событие у обоих", async ({ page, browser }, info) => {
    const [a, b] = pairOf(info);
    const mark = logMark();
    const title = `Свидание e2e ${info.project.name} ${Date.now() % 100000}`;
    await open(page, a, "&go=windows");
    await page.getByRole("button", { name: "Общие окна" }).click();
    const win = page.locator(".screen.pushed button.card").filter({ hasText: /\d\d:\d\d – \d\d:\d\d/ }).first();
    await expect(win).toBeVisible();
    await win.click();
    await expect(sheet(page).getByText("Позвать на свидание")).toBeVisible();
    const dayText = (await sheet(page).locator(".caps").first().textContent())!.trim();
    await sheet(page).locator("input").first().fill(title);
    await sheet(page).getByRole("button", { name: /^Позвать / }).click();
    await expect(page.getByText("Приглашение отправлено 💌")).toBeVisible();

    // Ей ушло сообщение с кнопками (сервер строит их inviteKeyboard: «💞 Иду» и «Не получится»)
    await expect.poll(() => botTo(b, mark).find((l) => l.includes("зовёт на свидание") && l.includes(title))).toBeTruthy();
    await expect.poll(() => botTo(b, mark).join("\n")).toContain("Ответь кнопкой");

    // Она отвечает «Иду»: в приложении та же кнопка, что в чате
    const her = await phone(browser, info);
    const event = async (p: Page, who: number) => {
      await open(p, who, "&go=calendar");
      const res = await p.request.get(`${E2E_API}/api/events`, { headers: { authorization: `dev ${who}:${encodeURIComponent(NAMES[who])}` } });
      const ev = ((await res.json()) as { events: { title: string; date: string }[] }).events.find((e) => e.title === title)!;
      expect(ev, `событие «${title}» есть в календаре`).toBeTruthy();
      if (ev.date.slice(0, 7) !== mskToday().slice(0, 7)) await p.getByRole("button", { name: "Позже" }).click();
      await p.locator(".month button.day:not(.out)", { hasText: new RegExp(`^${Number(ev.date.slice(8))}$`) }).first().click();
      return p.locator(".card", { hasText: title });
    };
    const card = await event(her, b);
    await expect(card).toContainText("ждём ответа");
    await card.getByRole("button", { name: "💞 Иду" }).click();
    await expect(card).toContainText("идёте 💞");
    expect(dayText.length).toBeGreaterThan(0);

    // У него событие тоже стоит как принятое
    const mine = await event(page, a);
    await expect(mine).toContainText("идёте 💞");
    await her.context().close();
  });

  test("(в) «Скучаю» доходит до половинки сообщением бота", async ({ page }, info) => {
    const [a, b] = pairOf(info);
    const mark = logMark();
    await open(page, a);
    const miss = page.getByRole("button", { name: /Скучаю/ });
    await miss.scrollIntoViewIfNeeded();
    await miss.click();
    await expect(page.getByText("💭 Отправлено")).toBeVisible();
    await expect.poll(() => botTo(b, mark).find((l) => l.includes(`${NAMES[a]} скучает по тебе`))).toBeTruthy();
  });

  test("(г) вопрос дня: ответ половинки открывается, только когда ответили оба", async ({ page, browser }, info) => {
    const [a, b] = pairOf(info);
    const mine = `Мой ответ ${info.project.name} ${Date.now() % 100000}`;
    const hers = `Её ответ ${info.project.name} ${Date.now() % 100000}`;
    await open(page, a, "&go=daily");
    await page.getByPlaceholder("Твой ответ…").fill(mine);
    await page.getByRole("button", { name: /^Ответить/ }).click();
    await expect(page.getByText(mine)).toBeVisible();
    await expect(page.getByText(`Ждём ответ`)).toBeVisible();

    const her = await phone(browser, info);
    await open(her, b, "&go=daily");
    // До своего ответа она его ответа не видит, но знает, что он ждёт
    await expect(her.getByText(/уже ждёт 👀/)).toBeVisible();
    await expect(her.getByText(mine)).toHaveCount(0);
    await her.getByPlaceholder("Твой ответ…").fill(hers);
    await her.getByRole("button", { name: "Ответить и увидеть ответ" }).click();
    await expect(her.getByText(mine)).toBeVisible();
    await expect(her.getByText(hers)).toBeVisible();

    // И у него её ответ появляется сам, без перезахода (живой канал)
    await expect(page.getByText(hers)).toBeVisible();
    await her.context().close();
  });

  // (д) «фото в альбоме видно обоим» — альбом убран 08.10.2026, проверка в e2e/foto.spec.ts

  test("(е) обзор 14 дней: её пары с сайта РЭУ стоят на своих датах", async ({ page }, info) => {
    const [a] = pairOf(info);
    await open(page, a, "&go=windows");
    await expect(page.getByRole("button", { name: "Вся картина" })).toBeVisible();
    const want: [number, RegExp][] = [
      [REA_DNI[0], /пары 08:30–11:40/],
      [REA_DNI[1], /пары 14:00–15:30/],
    ];
    const partner = NAMES[a + 1];
    for (const [shift, pary] of want) {
      const d = addDays(mskToday(), shift);
      const row = page.locator(".week-day").filter({ has: page.locator(".week-label .muted", { hasText: new RegExp(`^${Number(d.slice(8))}$`) }) });
      await row.locator(".week-row").click();
      const her = row.locator(".week-detail div", { hasText: new RegExp(`^${partner}`) }).first();
      await expect(her).toContainText(pary);
    }
  });

  test("(ж) утренняя сводка в 8:30 приходит обоим", async ({}, info) => {
    const [a, b] = pairOf(info);
    const day = addDays(mskToday(), 1);
    const [y, m, d] = day.split("-").map(Number);
    // Минутный цикл крона с часами на 8:35 по Москве завтрашнего дня, на той же тестовой базе
    const script = `
      import { run } from "./src/db.ts";
      import { tick } from "./src/cron.ts";
      run("DELETE FROM sent WHERE key IN ('morning:${a}:${day}', 'morning:${b}:${day}')");
      await tick(Date.UTC(${y}, ${m - 1}, ${d}, 5, 35));
      process.exit(0);`;
    const out = execFileSync("node", ["--input-type=module", "-e", script], {
      cwd: SERVER,
      env: { ...process.env, DB_PATH: E2E_DB, IMDB_DB_PATH: `/tmp/vdvoyom-e2e-imdb${E2E_SUFFIX}.db`, FILM_POSTERS_DIR: `/tmp/vdvoyom-e2e-posters${E2E_SUFFIX}`, PLUS: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });
    const msgs = out.split(/\n(?=\[)/);
    for (const who of [a, b]) {
      const morning = msgs.find((s) => s.startsWith(`[бот → ${who}]`) && s.includes("Доброе утро"));
      expect(morning, `сводка ушла ${NAMES[who]}`).toBeTruthy();
      expect(morning).toContain("У тебя:");
    }
  });

  test("(з) гардероб: у каждого вещи с фото, парный лук собирается", async ({ page, browser }, info) => {
    const [a, b] = pairOf(info);
    const add = async (p: Page, color: string, what: string) => {
      await p.getByRole("button", { name: /Добавить вещь/ }).click();
      await sheet(p).locator('input[type="file"]:not([capture])').setInputFiles({ name: "vesch.jpg", mimeType: "image/jpeg", buffer: await jpeg(p, color) });
      await sheet(p).getByRole("button", { name: what, exact: true }).click();
      await sheet(p).getByRole("button", { name: "Готово" }).click();
      await expect(sheet(p)).toHaveCount(0);
    };
    const fill = async (p: Page, who: number, items: [string, string][]) => {
      await open(p, who, "&go=wardrobe");
      await p.getByRole("button", { name: /^Мои/ }).click();
      for (const [color, what] of items) await add(p, color, what);
      await expect(p.getByRole("button", { name: new RegExp(`^Мои · ${items.length}`) })).toBeVisible();
    };
    await fill(page, a, [["#f4f1ea", "Верх"], ["#3b5b8a", "Низ"], ["#1c1c1c", "Обувь"]]);
    const her = await phone(browser, info);
    await fill(her, b, [["#efe6d6", "Верх"], ["#2a2a2a", "Низ"], ["#8a5a3c", "Обувь"]]);

    await her.getByRole("button", { name: "Парные луки", exact: true }).click();
    await expect(her.getByRole("button", { name: /Сохранить лук/ }).first()).toBeVisible();
    await expect(her.locator(".look-col img").first()).toBeVisible();
    await her.context().close();
  });
});
