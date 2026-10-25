// Что бесплатно, а что во «Вдвоём+» (решение 27.09.2026, образец — @TheCuteBot).
//
// Раскладка из экономической модели проекта: расти можно только бесплатно — пара из рекламы стоит ~400 ₽, а
// приносит ~20 ₽. Поэтому то, ради чего зовут половинку, бесплатно всегда:
// общее время, свайпы с мэтчами, календарь, хотелки, дела. Платное — объём
// сверх разумного (фото и постеры стоят места на сервере) и дополнительный
// контент, как наборы у «Между строк». Уже добавленное сверх лимита не
// пропадает: закрыто только новое.
import { HTTPException } from "hono/http-exception";
import { env } from "./env.ts";
import { plusOf } from "./plus.ts";

export const FREE = { films: 5, capsules: 1, goals: 2, wardrobe: 15 } as const;
/**
 * Тесты, открытые без «Вдвоём+»; остальные — с замком, но только когда платная
 * часть включена (PLUS=1). В бою PLUS выключен (закрытый тест, решение 27.09.2026),
 * и там открыто всё.
 *
 * Решение владельца 08.10.2026 (вечер): тесты — главное,
 * за что платят. Поэтому для новых тестов (бета, beta.ts) бесплатно только
 * первый раунд «Угадай меня», «Идеального свидания» и «Что мне приятно».
 * Во «Вдвоём+»: остальные пять тестов, новые раунды любого теста, «Шпаргалка»
 * дальше первых строк.
 * Старые тесты (не бета) — как были, см. FREE_TESTS_V1.
 */
export const FREE_TESTS = ["ugaday", "svidanie", "priyatno"];
/** Сколько строк «Шпаргалки» видно без «Вдвоём+»; остальные размыты, и сервер их не отдаёт. */
export const FREE_CHEAT = 3;

/** Старые тесты (не бета, см. beta.ts): как до 08.10.2026 — открыты «Языки любви» и «Это или то». */
export const FREE_TESTS_V1 = ["love", "thisorthat"];
export const TESTS_V1_TEXT = "Бесплатно открыты «Языки любви» и «Это или то»";

export type Feature = keyof typeof FREE | "tests" | "rounds" | "cheat";

export const FEATURE_TEXT: Record<Feature, string> = {
  films: `Бесплатно можно добавить ${FREE.films} своих фильмов`,
  capsules: "Бесплатно — одна капсула за раз",
  goals: `Бесплатно — ${FREE.goals} цели одновременно`,
  wardrobe: `В бесплатном гардеробе до ${FREE.wardrobe} вещей`,
  tests: "Бесплатно открыты «Угадай меня», «Идеальное свидание» и «Что мне приятно»",
  rounds: "Бесплатно — первый раунд каждого теста",
  cheat: `Бесплатно в шпаргалке видно первые ${FREE_CHEAT} строки`,
};

/** Платная часть включена (PLUS=1), а у пары «Вдвоём+» нет. Плюс — на пару: платит один, открыто обоим. */
export const paywalled = (pairId: number | null | undefined): boolean => env.plusOn && !plusOf(pairId ?? null).active;

/**
 * Пустить дальше или ответить 402 «это во «Вдвоём+»». Сообщение с приставкой
 * PLUS: разбирает app.onError, клиент по коду показывает свою шторку.
 */
export function needPlus(pairId: number, feature: Feature, used = 0, text = FEATURE_TEXT[feature]): void {
  if (!env.plusOn) return; // закрытый тест: всё открыто
  const limit = (FREE as Record<string, number>)[feature];
  if (limit !== undefined && used < limit) return;
  if (plusOf(pairId).active) return;
  throw new HTTPException(402, { message: `PLUS:${feature}:${text}` });
}

export const testLocked = (pairId: number, testId: string) => env.plusOn && !FREE_TESTS.includes(testId) && !plusOf(pairId).active;
export const testLockedV1 = (pairId: number, testId: string) => env.plusOn && !FREE_TESTS_V1.includes(testId) && !plusOf(pairId).active;
