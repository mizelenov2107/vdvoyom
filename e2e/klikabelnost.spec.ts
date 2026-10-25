// Кликабельность всех экранов (04.10.2026, после «не работает кнопка жанров»).
// Смотрим на кнопки так, как их видит палец, а не тестовый скрипт:
//  • у каждой есть имя — текст или aria-label (иначе непонятно, что она делает,
//    и её не найдёт ни читалка экрана, ни тест);
//  • размер касания не меньше 24 px (WCAG 2.5.8) — жёстко; меньше 40 px (Apple HIG — 44,
//    закон Фиттса: мелкая цель — промахи) — в отчёт e2e/kadry/klikabelnost.json;
//  • кнопку ничто не перекрывает, когда до неё долистали: ни нижнее меню, ни «Отзыв»,
//    ни кнопки телеграма в полноэкранном режиме (верх экрана закрыт полосой-заглушкой);
//  • кнопка не уезжает за правый край (кроме горизонтально прокручиваемых рядов).
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { onScreen, open } from "./helpers.ts";

// Третий элемент — кто открывает (по умолчанию Миша, 1)
const SCREENS: [string, string, number?][] = [
  ["Главная", ""], ["Календарь", "&go=calendar"], ["Когда свободны", "&go=windows"], ["Расписание", "&go=schedule"],
  ["Фильмы", "&go=movies"], ["Места", "&go=places"], ["Мэтчи", "&go=matches"], ["Тесты", "&go=tests"],
  ["Хотелки", "&go=wishes"], ["Ещё", "&go=more"], ["Настройки", "&go=settings"], ["Вопрос дня", "&go=daily"],
  ["Дела", "&go=tasks"], ["Капсулы", "&go=capsules"], ["Цели", "&go=goals"],
  ["Что надеть", "&go=wardrobe"], ["Голосования", "&go=votes"], ["Карты", "&go=cards"], ["Заметки", "&go=notes"], ["Админка", "&go=admin"],
  // Тесты, формат 2 (08.10.2026): начало, вопрос (черновик), результат и шпаргалка — см. e2e/seed.ts
  ["Тест: начало", "&go=test:ugaday"], ["Тест: вопрос", "&go=test:svidanie"], ["Тест: результат", "&go=test:priyatno"], ["Шпаргалка", "&go=cheatsheet"],
  // Обычная пара (не бета новых тестов, этап 4): старый список тестов и старый тест — Аня (3)
  ["Тесты: старые", "&go=tests", 3], ["Тест: старый", "&go=test:love", 3], ["Настройки: обычная пара", "&go=settings", 3],
];

interface Problem { screen: string; name: string; why: string }


for (const [screen, go, who = 1] of SCREENS) {
  test(`кликабельность: ${screen}`, async ({ page }, info) => {
    await open(page, who, go);
    // Полноэкранный телеграм: сверху часы и кнопки «Закрыть» и «⋯» поверх приложения
    await page.addStyleTag({ content: ":root{--tg-safe-area-inset-top:47px;--tg-content-safe-area-inset-top:46px;--tg-safe-area-inset-bottom:34px}" });
    await page.evaluate(() => {
      const bar = document.createElement("div");
      bar.id = "tg-zaglushka";
      bar.style.cssText = "position:fixed;left:0;right:0;top:0;height:93px;z-index:2147483647;pointer-events:auto";
      document.body.appendChild(bar);
    });
    await page.waitForTimeout(700);
    const found = await page.evaluate(() => {
      const out: { name: string; why: string; size: number }[] = [];
      // Только верхний слой: открытый экран, а без него — вкладка, нижнее меню и «Отзыв»
      const pushed = [...document.querySelectorAll<HTMLElement>(".screen.pushed")].at(-1);
      const root: ParentNode = pushed ?? document;
      const els = [...root.querySelectorAll<HTMLElement>("button, a[href], [role=switch], [role=radio], input:not([type=hidden]), textarea, select")]
        .filter((e) => !e.closest(".sheet") && !e.closest("#tg-zaglushka") && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && !e.hidden);
      for (const el of els) {
        if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
        const labels = [...((el as HTMLInputElement).labels ?? [])].map((l) => l.innerText).join(" ");
        const name = (el.getAttribute("aria-label") || el.innerText || labels || el.getAttribute("title") || (el as HTMLInputElement).placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (!name) out.push({ name: el.outerHTML.slice(0, 60), why: "нет имени (ни текста, ни aria-label)", size: 0 });
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const size = Math.min(r.width, r.height);
        if (size < 24) out.push({ name, why: `касание ${Math.round(r.width)}×${Math.round(r.height)} меньше 24 px`, size });
        else if (size < 40) out.push({ name, why: `мелко: ${Math.round(r.width)}×${Math.round(r.height)}`, size });
        const inScrollRow = !!el.closest(".pills.scroll, .scroll-x, [data-scroll-x]");
        if (!inScrollRow && r.right > innerWidth + 1) out.push({ name, why: `уезжает за правый край на ${Math.round(r.right - innerWidth)} px`, size });
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const cy = r.top + r.height / 2;
        if (cy < 0 || cy > innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== el && !el.contains(hit) && !(el as HTMLLabelElement).control) {
          const who = hit.id === "tg-zaglushka" ? "кнопки телеграма сверху" : `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}`;
          out.push({ name, why: `перекрыта: ${who}`, size });
        }
      }
      return out;
    });
    const hard = found.filter((p) => !p.why.startsWith("мелко"));
    const small: Problem[] = found.filter((p) => p.why.startsWith("мелко")).map((p) => ({ screen, name: p.name, why: p.why }));
    fs.mkdirSync("e2e/kadry/klikabelnost", { recursive: true });
    fs.writeFileSync(`e2e/kadry/klikabelnost/${info.project.name} — ${screen}.json`, JSON.stringify({ small, hard: found.filter((p) => !p.why.startsWith("мелко")) }, null, 2));
    expect(hard.map((p) => `${p.name}: ${p.why}`), `${screen}: кнопки, по которым трудно или нельзя попасть`).toEqual([]);
  });
}

/** Показать «Мэтч!» по первому фильму колоды — тем же модулем store, что у приложения. */
async function showMatch(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    // После правок vite дописывает к модулю ?t=…: берём ровно тот адрес, что загрузило приложение
    const url = (m: string) => performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes(`/src/${m}`)) ?? `/src/${m}`;
    const { api } = await import(/* @vite-ignore */ url("api.ts"));
    const { store } = await import(/* @vite-ignore */ url("store.ts"));
    const r = await api("/deck/movie?limit=1");
    store.showMatch({ deck: "movie", item: r.items[0], by: 2 });
  });
  await expect(page.getByRole("heading", { name: "Мэтч!" })).toBeVisible();
}

// Блокер теста 11.10.2026: на Android 448×646 «Свайпать дальше» лежала за нижним краем,
// заголовок — за верхним, прокрутки не было, тап по фону не закрывал — выйти было нельзя.
for (const [w, h] of [[448, 646], [360, 560]] as const) {
  test(`мэтч ${w}×${h}: «Свайпать дальше» целиком на экране, выход крестиком, фоном и Escape`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, 1, "&go=movies");
    await expect(page.locator(".swipe-card .title-lg").last()).toBeVisible();
    await showMatch(page);
    await page.waitForTimeout(900); // пружины появления
    // На холодном старте vite перезагружает страницу после оптимизации зависимостей — мэтч пропадает
    if (!(await page.locator(".match").count())) {
      await expect(page.locator(".swipe-card .title-lg").last()).toBeVisible();
      await showMatch(page);
      await page.waitForTimeout(900);
    }
    await onScreen(page, page.getByRole("button", { name: "Свайпать дальше" }));
    await onScreen(page, page.getByRole("heading", { name: "Мэтч!" }));
    await onScreen(page, page.getByRole("button", { name: "Закрыть" }));
    // Тап по пустому месту у края — закрывает
    await page.mouse.click(6, Math.round(h / 2));
    await expect(page.locator(".match")).toHaveCount(0);
    // Крестик
    await showMatch(page);
    await page.getByRole("button", { name: "Закрыть" }).click();
    await expect(page.locator(".match")).toHaveCount(0);
    // Escape (в телеграме — кнопка «Назад»)
    await showMatch(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".match")).toHaveCount(0);
    // «Свайпать дальше» тоже закрывает, а колода на месте
    await showMatch(page);
    await page.getByRole("button", { name: "Свайпать дальше" }).click();
    await expect(page.locator(".match")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "хочу", exact: true })).toBeVisible();
  });
}
