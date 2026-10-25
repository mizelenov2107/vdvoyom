import { useApi } from "./api.ts";
import { colorOf } from "./ui/kit.tsx";
import type { Me, Person } from "./types.ts";

/** Кто я, кто половинка и их цвета. Если цвета совпали, половинка берёт запасной. */
export function useMe() {
  const q = useApi<Me>(["me"], "/me");
  const d = q.data;
  const me = d?.me ?? null;
  const partner = d?.partner ?? null;
  const meColor = colorOf(me);
  let theyColor = colorOf(partner ?? { color: "rose" });
  // Совпали цвета — половинку рисуем запасным, чтобы не путать, где чьё
  if (partner && colorOf(partner) === meColor) theyColor = meColor === colorOf({ color: "rose" }) ? colorOf({ color: "violet" }) : colorOf({ color: "rose" });
  const nameOf = (id: number | null | undefined): string => (id === me?.id ? "ты" : id === partner?.id ? partner!.name : "");
  const colorFor = (id: number | null | undefined): string => (id === partner?.id ? theyColor : meColor);
  const personFor = (id: number | null | undefined): Person | null => (id === partner?.id ? partner : me);
  const hidden = d?.prefs?.hidden ?? [];
  /** Раздел не убран в настройках. Пока профиль грузится, показываем всё. */
  const shown = (module: Module): boolean => !hidden.includes(module);
  /** Бета новых тестов (только пара владельца, 08.10.2026): иначе старые семь тестов, как до 08.10 */
  const beta = !!d?.beta;
  return { ...q, data: d, me, partner, pair: d?.pair ?? null, meColor, theyColor, nameOf, colorFor, personFor, shown, beta, prefs: { hidden: d?.prefs?.hidden ?? [], muted: d?.prefs?.muted ?? [] } };
}

/** Разделы, которые можно убрать у себя (тот же список, что MODULES на сервере). */
export const MODULES = [
  { key: "schedule", title: "Расписание и общие окна", sub: "пары, работа, «Когда свободны», статус «сейчас»" },
  { key: "tasks", title: "Дела", sub: "общий список с «Беру»" },
  { key: "goals", title: "Цели", sub: "к чему идёте вместе" },
  { key: "daily", title: "Вопрос дня", sub: "один вопрос на двоих каждый день" },
  { key: "wardrobe", title: "Что надеть", sub: "гардероб и парные луки" },
  { key: "tests", title: "Тесты", sub: "угадай меня, свидание, деньги и другие" },
  { key: "capsules", title: "Капсулы", sub: "письма в будущее" },
  { key: "votes", title: "Голосования", sub: "тайные, до ответа обоих" },
  { key: "cards", title: "Карты", sub: "скидочные на двоих" },
  { key: "notes", title: "Заметки", sub: "общий блокнот" },
] as const;
export type Module = (typeof MODULES)[number]["key"];

/** Подпись раздела «Тесты»: в бете — новые тесты, у остальных — старые, как до 08.10.2026. */
export const testsSub = (beta: boolean) => (beta ? "угадай меня, свидание, деньги и другие" : "языки любви и совместимость");

/** Напоминания бота, которые можно выключить. «Тесты» — только в бете новых тестов. */
export const NOTIFY = [
  { key: "morning", title: "Утренняя сводка", sub: "в 8:30: дела, события и окна на день" },
  { key: "daily", title: "Вопрос дня", sub: "в полдень, если ответа ещё нет" },
  { key: "weekly", title: "Окна на неделю", sub: "по воскресеньям вечером" },
  { key: "tomorrow", title: "События завтра", sub: "вечером накануне" },
  { key: "tests", title: "Тесты", sub: "партнёр ждёт или результаты открылись; не чаще раза в день" },
] as const;
