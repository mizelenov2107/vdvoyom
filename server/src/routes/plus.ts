// «Вдвоём+»: счёт, проверка после возврата и уведомление ЮKassa.
import { Hono } from "hono";
import { get } from "../db.ts";
import { bad, needPair, oneOf, router } from "../http.ts";
import { bot, botUsername, sendTo, thankForPlus } from "../bot.ts";
import { env } from "../env.ts";
import { checkout, fakePayments, offerOf, PLANS, pendingOf, plusOf, receiptNote, settle, starsPaid, starsPayment, yookassaReady, type PaymentRow, type Plan } from "../plus.ts";
import { FREE, FREE_CHEAT, FREE_TESTS, FREE_TESTS_V1 } from "../limits.ts";
import { tests, testsV1 } from "../content.ts";
import { isBeta } from "../beta.ts";
import type { UserRow } from "../model.ts";

/** Оплата рублями прошла: спасибо обоим и владельцу — какой чек пробить в «Мой налог». */
const thank = async (id: string) => {
  const row = get<PaymentRow & { method: string; email: string | null }>("SELECT * FROM payments WHERE id = ?", id);
  if (!row) return;
  await Promise.allSettled([thankForPlus(row), receiptToOwner(row)]);
};

/**
 * Владельцу (SUPPORT_CHAT_ID, иначе первый из ADMIN_IDS) — напоминание пробить чек.
 * Самозанятый обязан передать чек сразу после оплаты, а ЮKassa с 29.12.2025 чеки
 * самозанятым не формирует. Без токена бота sendTo пишет строку в журнал.
 */
async function receiptToOwner(row: PaymentRow & { method: string; email: string | null }): Promise<void> {
  const text = receiptNote(row);
  const owner = env.supportChatId ?? env.adminIds[0];
  if (!text || !owner) return;
  try {
    if (await sendTo(owner, text)) return;
    // sendTo пишет только тем, кто запускал бота как пользователь приложения; чат владельца может быть и не таким
    if (bot) await bot.api.sendMessage(owner, text, { parse_mode: "HTML" });
  } catch (e) {
    console.error("оплата: напоминание о чеке не ушло", row.id, (e as Error).message);
  }
}

export const plus = router();

plus.get("/plus", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const offer = offerOf(pairId);
  return c.json({
    ...plusOf(pairId),
    // Картой российского банка — ЮKassa, иностранной — звёзды телеграма
    card: yookassaReady() || fakePayments(),
    stars: !!bot || fakePayments(),
    receiptEmail: env.yookassaReceipts,
    support: env.support || null,
    plans: (["month", "year", "forever"] as const).map((key) => ({ key, rub: PLANS[key].rub, stars: PLANS[key].stars, days: PLANS[key].days, title: PLANS[key].title })),
    offer: offer?.active ? { key: "year_offer", until: offer.until, rub: PLANS.year_offer.rub, stars: PLANS.year_offer.stars, oldRub: PLANS.year.rub, oldStars: PLANS.year.stars } : null,
    // Что открывает «Вдвоём+» — те же числа, что проверяет сервер
    free: FREE,
    ...testsPitch(isBeta(u)),
    extras: extrasOf(u),
  });
});

/**
 * Завести акцию на 72 часа (plus.ts → offerOf). Шлёт клиент в начале захода, если
 * общая польза у пары уже была до этого захода (App.tsx). Без пользы, без
 * половинки или с «Вдвоём+» ничего не заводит. Повтор ничего не продлевает.
 */
plus.post("/plus/offer", (c) => {
  const pairId = needPair(c.get("user"));
  const offer = offerOf(pairId, true);
  return c.json({ offer: offer?.active ? { until: offer.until, rub: PLANS.year_offer.rub, oldRub: PLANS.year.rub } : null });
});

/**
 * Тесты на продающем экране. Бета (beta.ts) — новые тесты;
 * остальные пары — старые семь, как до 08.10.2026.
 */
function testsPitch(beta: boolean) {
  if (!beta) {
    const list = testsV1();
    return {
      freeTests: list.filter((t) => FREE_TESTS_V1.includes(t.id)).map((t) => t.title),
      tests: list.length,
      testList: list.map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, blurb: PITCH_V1[t.id] ?? t.description.split(/[.:]/)[0], free: FREE_TESTS_V1.includes(t.id) })),
    };
  }
  const list = tests();
  return {
    freeTests: list.filter((t) => FREE_TESTS.includes(t.id)).map((t) => t.title),
    tests: list.length,
    // Для продающего экрана: что именно откроется
    testList: list.map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, blurb: PITCH[t.id] ?? t.blurb, free: FREE_TESTS.includes(t.id) })),
  };
}

/** Что ещё даёт «Вдвоём+» в новых тестах (08.10.2026): раунды и «Шпаргалка». */
function extrasOf(u: UserRow) {
  if (!isBeta(u)) return [];
  return [
    { id: "rounds", emoji: "🔁", title: "Новые раунды", blurb: "Свежие вопросы в любом тесте, сколько захочется. Бесплатно — первый раунд" },
    { id: "cheat", emoji: "📝", title: "Шпаргалка целиком", blurb: `Всё, что не получилось угадать про партнёра. Бесплатно — первые ${FREE_CHEAT} строки` },
  ];
}

/** Подписи старых тестов (до 08.10.2026) — для пар не из беты. */
const PITCH_V1: Record<string, string> = {
  love: "На каком языке каждый из вас чувствует любовь",
  thisorthat: "Быстрые выборы: где совпали, где придётся договариваться",
  knowme: "Кто кого знает лучше: привычки и вкусы",
  money: "Траты, накопления и кто платит",
  life: "Уборка, режим, гости и личное пространство",
  future: "Город, карьера, свадьба и дети",
  dates: "Как каждый из вас любит отдыхать",
};

/**
 * Подписи тестов на продающем экране — о чём тест, без числа вопросов:
 * «12 утверждений» подсказывали «пройдём всё за вечер» (критик экрана, 27.09.2026).
 */
const PITCH: Record<string, string> = {
  ugaday: "Привычки, реакции и мелочи: что нового узнать друг о друге",
  svidanie: "Ваше свидание и три идеи, куда сходить",
  priyatno: "Какие жесты заботы радуют каждого из вас",
  dengi: "Кто платит, долги, подарки и накопления",
  "zhit-vmeste": "Посуда, гости, режим и личное пространство",
  budushchee: "Город, стажировки, съезд, свадьба и дети",
  ssory: "Что нужно каждому в ссоре и как мириться",
  revnost: "Бывшие, телефон, друзья и вечеринки",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

plus.post("/plus/checkout", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ plan: string; method?: string; email?: string }>();
  if (!env.plusOn) bad("Сейчас закрытый тест: всё открыто бесплатно, платить не нужно", 409);
  const key = oneOf(b.plan, Object.keys(PLANS) as Plan[]);
  const method = oneOf(b.method ?? "card", ["card", "stars"] as const);
  if (key === "year_offer" && !offerOf(pairId)?.active) bad("Акция закончилась, обычная цена года — 1 490 ₽", 409);
  if (plusOf(pairId).forever) bad("У вас «Вдвоём+» уже навсегда, платить больше не нужно", 409);
  if (method === "stars") {
    const pay = starsPayment(pairId, u.id, key);
    if (!bot) {
      if (!fakePayments()) bad("Бот не подключён", 409);
      return c.json({ url: `${env.publicUrl}/pay/dev?id=${pay.id}` });
    }
    const link = await bot.api.createInvoiceLink(
      pay.title,
      `Для вас обоих, ${key === "forever" ? "навсегда, одной оплатой" : `${PLANS[key].days} дней`}. Всё бесплатное остаётся бесплатным.`,
      pay.id,
      "",
      "XTR",
      [{ label: pay.title, amount: pay.stars }],
    );
    return c.json({ invoice: link, id: pay.id });
  }
  if (!yookassaReady() && !fakePayments()) bad("Оплата картой российского банка ещё не подключена", 409);
  const email = typeof b.email === "string" ? b.email.trim().slice(0, 120) : "";
  if (email && !EMAIL.test(email)) bad("Проверь почту: в ней ошибка");
  if (env.yookassaReceipts && !email) bad("Нужна почта: туда придёт чек");
  // После оплаты ЮKassa вернёт человека прямо в мини-приложение, на экран «Вдвоём+»
  const url = await checkout(pairId, u.id, key, `https://t.me/${botUsername}?startapp=plus`, fetch, email || null);
  return c.json({ url });
});

/** Человек вернулся со страницы оплаты: перепроверяем его свежие счета, не дожидаясь уведомления. */
plus.post("/plus/check", async (c) => {
  const pairId = needPair(c.get("user"));
  let paid = false;
  for (const p of pendingOf(pairId)) {
    if (p.id.startsWith("dev-")) continue;
    try {
      if ((await settle(p.id)) === "paid") {
        paid = true;
        void thank(p.id);
      }
    } catch (e) {
      console.error("оплата: проверка", p.id, (e as Error).message);
    }
  }
  return c.json({ paid, ...plusOf(pairId) });
});

/**
 * Публичная часть без входа: уведомление ЮKassa и заглушка оплаты для
 * разработки. Уведомлению не верим, берём из него только id и спрашиваем
 * ЮKassa сами. Отвечаем 200 почти всегда: на другой ответ ЮKassa шлёт
 * уведомление снова, а мы и так перепроверяем.
 */
export const pay = new Hono();

pay.post("/yookassa", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { object?: { id?: string } } | null;
  const id = body?.object?.id;
  if (!id || typeof id !== "string" || id.length > 64) return c.json({ ok: true });
  try {
    if ((await settle(id)) === "paid") void thank(id);
  } catch (e) {
    console.error("оплата: уведомление", id, (e as Error).message);
  }
  return c.json({ ok: true });
});

// Только при DEV_AUTH без ключей: «оплата» проходит одной кнопкой, чтобы проверить путь целиком
pay.get("/dev", async (c) => {
  if (!fakePayments()) return c.body(null, 404);
  const id = c.req.query("id") ?? "";
  const row = get<PaymentRow>("SELECT * FROM payments WHERE id = ?", id);
  if (!row) return c.text("Нет такого счёта", 404);
  // Звёзды в разработке проводим тем же путём, что и в бою
  if (id.startsWith("stars-")) {
    const paid = starsPaid(id, row.amount, `dev-${Date.now()}`);
    if (paid) void thankForPlus(paid);
    return c.html(`<meta name="viewport" content="width=device-width"><body style="font:18px system-ui;padding:40px;text-align:center">Тестовая оплата ${row.amount} ⭐ прошла.<br><br>Вернись во «Вдвоём».</body>`);
  }
  const r = await settle(id, fetch, { id, status: "succeeded", paid: true, amount: { value: row.amount.toFixed(2), currency: "RUB" }, metadata: { pair_id: String(row.pair_id) } });
  if (r === "paid") void thank(id);
  return c.html(`<meta name="viewport" content="width=device-width"><body style="font:18px system-ui;padding:40px;text-align:center">Тестовая оплата ${row.amount} ₽ прошла (${r}).<br><br>Вернись во «Вдвоём».</body>`);
});
