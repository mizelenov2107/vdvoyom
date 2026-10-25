// «Вдвоём+» за рубли через ЮKassa.
//
// Оплата идёт на странице ЮKassa, которая открывается в браузере: картой, СБП,
// SberPay. Одна оплата включает «Вдвоём+» обоим в паре. Сама не продлевается:
// автоплатежи ЮKassa включает только после проверки магазина, а разовая
// покупка проще и честнее.
//
// Два правила из школы. Первое: доступ продлевается только после того, как мы
// сами спросили у ЮKassa состояние платежа. Уведомление может прислать кто
// угодно, подписи у него нет, поэтому оно лишь повод перепроверить. Второе: у
// каждого счёта ключ идемпотентности, и двойное нажатие «Оплатить» не
// выставляет второй счёт.
//
// Чек здесь не формируется. Самозанятый пробивает его сам в приложении «Мой
// налог» сразу после оплаты: ЮKassa с 29.12.2025 чеки самозанятым не делает и в
// «Мой налог» ничего не передаёт. Поэтому после каждой оплаты рублями бот пишет
// владельцу, какой чек пробить (receiptNote, routes/plus.ts → thank). Перейдёшь
// на УСН — добавь receipt в createPayment.
import { randomUUID } from "node:crypto";
import { all, get, run, tx } from "./db.ts";
import { env } from "./env.ts";
import { changed } from "./realtime.ts";
import { addDays, today } from "./time.ts";

// stars — цена в звёздах телеграма для оплаты картой иностранного банка:
// звёзды покупают картой любой страны, Apple Pay или Google Pay. Разработчику
// идёт $0,013 за звезду, то есть ~150 ₽ за месяц при курсе 80.
export const PLANS = {
  month: { rub: 199, stars: 150, days: 30, title: "«Вдвоём+» на месяц" },
  year: { rub: 1490, stars: 1100, days: 365, title: "«Вдвоём+» на год" },
  // Только пока идёт акция (offerOf): год по цене восьми месяцев
  year_offer: { rub: 990, stars: 750, days: 365, title: "«Вдвоём+» на год по акции" },
  // Одна оплата без срока (решение 27.09.2026): как 16 месяцев помесячно, чуть дороже года.
  // days здесь не счёт, а заглушка: срок ставит extend, см. FOREVER.
  forever: { rub: 1990, stars: 1500, days: 0, title: "«Вдвоём+» навсегда" },
} as const;

/** plus_until для покупки «навсегда»: дата, до которой никто не доживёт, и сравнение строк с today() работает. */
export const FOREVER = "9999-12-31";

/**
 * Акция для новых пар: 72 часа, один раз на пару. Таймер честный — хранится на
 * сервере и не сбрасывается; по окончании сервер не примет оплату по акционной
 * цене. По модели это главный рычаг конверсии: платят в первые дни, пока
 * приложение в новинку.
 *
 * С 11.10.2026 продаём после пользы, а не раньше (тест перед запуском: «пара ещё
 * ничего не сделала вместе, а ей уже продают»). Таймер заводится, только когда у
 * пары есть первая общая польза (benefitAt) и только по явному start: его шлёт
 * клиент в начале следующего захода (POST /plus/offer, App.tsx), а не в тот же
 * заход, когда польза случилась. Просто GET /me и /plus таймер не заводят.
 */
export const OFFER_HOURS = 72;

export function offerOf(pairId: number | null, start = false): { until: string; active: boolean } | null {
  if (!pairId || !env.plusOn) return null;
  const row = get<{ offer_until: string | null; plus_until: string | null }>("SELECT offer_until, plus_until FROM pairs WHERE id = ?", pairId);
  if (!row) return null;
  if (plusOf(pairId).active) return row.offer_until ? { until: row.offer_until, active: false } : null;
  let until = row.offer_until;
  if (!until) {
    if (!start) return null;
    const people = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE pair_id = ? AND id > 0", pairId)?.n ?? 0;
    if (people < 2 || !benefitAt(pairId)) return null;
    until = new Date(Date.now() + OFFER_HOURS * 3_600_000).toISOString();
    run("UPDATE pairs SET offer_until = ? WHERE id = ? AND offer_until IS NULL", until, pairId);
    until = get<{ offer_until: string }>("SELECT offer_until FROM pairs WHERE id = ?", pairId)!.offer_until;
  }
  return { until, active: Date.parse(until) > Date.now() };
}

/**
 * Первая общая польза пары — самое раннее из: оба закончили раунд теста (новые
 * тесты: test_rounds.closed_at; старые: оба ответа в test_answers), мэтч в
 * свайпах, оба ответили на вопрос дня.
 * Считается запросом, без своей таблицы; наружу (в /home) уходит лишь «да/нет».
 * Время — ISO в UTC или null, если пользы ещё не было.
 */
export function benefitAt(pairId: number | null): string | null {
  if (!pairId) return null;
  const t = get<{ t: string | null }>(
    `SELECT MIN(t) AS t FROM (
       SELECT MIN(closed_at) AS t FROM test_rounds WHERE pair_id = ?1 AND closed_at IS NOT NULL
       UNION ALL
       SELECT MIN(done) FROM (SELECT MAX(finished_at) AS done FROM test_answers WHERE pair_id = ?1 AND user_id > 0 GROUP BY test_id HAVING COUNT(DISTINCT user_id) >= 2)
       UNION ALL
       SELECT MIN(created_at) FROM matches WHERE pair_id = ?1
       UNION ALL
       SELECT MIN(done) FROM (SELECT MAX(created_at) AS done FROM daily_answers WHERE pair_id = ?1 AND user_id > 0 GROUP BY date HAVING COUNT(DISTINCT user_id) >= 2)
     )`,
    pairId,
  )?.t;
  return t ? `${t.replace(" ", "T")}Z` : null;
}

export type Plan = keyof typeof PLANS;

const API = "https://api.yookassa.ru/v3";

export interface YooPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: { confirmation_url?: string };
  metadata?: Record<string, string>;
}

export function yookassaReady(): boolean {
  return !!(env.yookassaShopId && env.yookassaSecret);
}

/** Для разработки без магазина: DEV_AUTH и нет ключей — платёж «проходит» на нашей же странице. */
export function fakePayments(): boolean {
  return env.devAuth && !yookassaReady();
}

async function call<T>(path: string, init: RequestInit & { idempotence?: string }, fetcher: typeof fetch): Promise<T> {
  const { idempotence, ...rest } = init;
  const res = await fetcher(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.yookassaShopId}:${env.yookassaSecret}`).toString("base64")}`,
      "content-type": "application/json",
      ...(idempotence ? { "Idempotence-Key": idempotence } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ЮKassa ответила ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/**
 * Счёт на «Вдвоём+». Ключ идемпотентности один на человека, тариф и десять минут:
 * повторное нажатие вернёт тот же счёт, а через десять минут будет новый.
 */
export async function checkout(pairId: number, userId: number, plan: Plan, returnUrl: string, fetcher: typeof fetch = fetch, email: string | null = null): Promise<string> {
  const p = PLANS[plan];
  if (fakePayments()) {
    const id = `dev-${randomUUID()}`;
    run("INSERT INTO payments (id, pair_id, user_id, plan, amount, status, email) VALUES (?, ?, ?, ?, ?, 'pending', ?)", id, pairId, userId, plan, p.rub, email);
    return `${env.publicUrl}/pay/dev?id=${id}`;
  }
  if (!yookassaReady()) throw new Error("Оплата ещё не подключена");
  const payment = await call<YooPayment>(
    "/payments",
    {
      method: "POST",
      idempotence: `vdvoyom:${pairId}:${userId}:${plan}:${Math.floor(Date.now() / 600_000)}`,
      body: JSON.stringify({
        amount: { value: p.rub.toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl },
        description: p.title,
        metadata: { pair_id: String(pairId), user_id: String(userId), plan },
        // Чек по 54-ФЗ уходит на почту покупателя, если магазин подключён к «Чекам от ЮKassa»
        ...(env.yookassaReceipts && email
          ? {
              receipt: {
                customer: { email },
                items: [{ description: p.title, quantity: "1.00", amount: { value: p.rub.toFixed(2), currency: "RUB" }, vat_code: 1, payment_subject: "service", payment_mode: "full_payment" }],
              },
            }
          : {}),
      }),
    },
    fetcher,
  );
  run(
    "INSERT OR IGNORE INTO payments (id, pair_id, user_id, plan, amount, status, email) VALUES (?, ?, ?, ?, ?, ?, ?)",
    payment.id, pairId, userId, plan, p.rub, payment.status, email,
  );
  const url = payment.confirmation?.confirmation_url;
  if (!url) throw new Error("ЮKassa не дала ссылку на оплату");
  return url;
}

export interface PaymentRow {
  id: string;
  pair_id: number;
  user_id: number;
  plan: Plan;
  amount: number;
  status: string;
  created_at: string;
  paid_at: string | null;
}

/**
 * Свести платёж: спросить ЮKassa и, если он прошёл, продлить «Вдвоём+».
 * Повторный вызов по уже зачтённому платежу ничего не меняет.
 */
export async function settle(id: string, fetcher: typeof fetch = fetch, fake?: YooPayment): Promise<"paid" | "already" | "pending" | "canceled" | "unknown"> {
  const row = get<PaymentRow>("SELECT * FROM payments WHERE id = ?", id);
  if (!row) return "unknown";
  if (row.status === "succeeded") return "already";
  const p = fake ?? (await call<YooPayment>(`/payments/${encodeURIComponent(id)}`, { method: "GET" }, fetcher));
  if (p.status === "canceled") {
    run("UPDATE payments SET status = 'canceled' WHERE id = ?", id);
    return "canceled";
  }
  if (p.status !== "succeeded" || !p.paid) return "pending";
  // Сверяем, что оплачено ровно то, что мы выставляли, а не другой счёт с чужими метаданными
  const plan = PLANS[row.plan];
  if (!plan || Number(p.amount.value) !== plan.rub || p.amount.currency !== "RUB" || p.metadata?.pair_id !== String(row.pair_id)) {
    console.error("оплата: платёж не сходится со счётом", id, p.amount, p.metadata);
    return "pending";
  }
  const done = tx(() => {
    const fresh = get<{ status: string }>("SELECT status FROM payments WHERE id = ?", id);
    if (fresh?.status === "succeeded") return false;
    run("UPDATE payments SET status = 'succeeded', paid_at = datetime('now') WHERE id = ?", id);
    extend(row.pair_id, row.plan);
    return true;
  });
  if (!done) return "already";
  changed(row.pair_id, "pair");
  return "paid";
}

/**
 * Продлить от сегодняшнего дня или от конца уже оплаченного срока, что позже.
 * «Навсегда» ставит FOREVER, и поверх него срок уже не прибавляется: addDays
 * от 9999-12-31 дал бы год 10000, а строка «10000-…» меньше сегодняшней.
 */
function extend(pairId: number, plan: Plan): void {
  const cur = get<{ plus_until: string | null }>("SELECT plus_until FROM pairs WHERE id = ?", pairId)?.plus_until;
  if (cur === FOREVER) return;
  if (plan === "forever") {
    run("UPDATE pairs SET plus_until = ? WHERE id = ?", FOREVER, pairId);
    return;
  }
  const from = cur && cur > today() ? cur : today();
  run("UPDATE pairs SET plus_until = ? WHERE id = ?", addDays(from, PLANS[plan].days), pairId);
}

export function plusOf(pairId: number | null): { active: boolean; until: string | null; forever: boolean } {
  if (!pairId) return { active: false, until: null, forever: false };
  const until = get<{ plus_until: string | null }>("SELECT plus_until FROM pairs WHERE id = ?", pairId)?.plus_until ?? null;
  return { active: !!until && until >= today(), until, forever: until === FOREVER };
}

// ——— звёзды телеграма ———

/**
 * Счёт в звёздах: заводим строку платежа, её id — payload инвойса. Телеграм
 * вернёт его в pre_checkout_query и successful_payment, по нему и зачтём.
 */
export function starsPayment(pairId: number, userId: number, plan: Plan): { id: string; stars: number; title: string } {
  const p = PLANS[plan];
  const id = `stars-${randomUUID()}`;
  run("INSERT INTO payments (id, pair_id, user_id, plan, amount, status, method) VALUES (?, ?, ?, ?, ?, 'pending', 'stars')", id, pairId, userId, plan, p.stars);
  return { id, stars: p.stars, title: p.title };
}

/** Перед списанием телеграм спрашивает: счёт наш, не оплачен и сумма та же? */
export function starsPrecheck(payload: string, stars: number, currency: string): string | null {
  const row = get<PaymentRow & { method: string }>("SELECT * FROM payments WHERE id = ?", payload);
  if (!row || row.method !== "stars") return "Счёт не найден, открой оплату заново";
  if (row.status === "succeeded") return "Этот счёт уже оплачен";
  if (currency !== "XTR" || stars !== row.amount) return "Сумма не совпадает со счётом";
  return null;
}

/** Звёзды списаны: продлеваем «Вдвоём+». Повторное сообщение ничего не меняет. */
export function starsPaid(payload: string, stars: number, chargeId: string): PaymentRow | null {
  const row = get<PaymentRow & { method: string }>("SELECT * FROM payments WHERE id = ?", payload);
  if (!row || row.method !== "stars" || stars !== row.amount) {
    console.error("оплата звёздами: платёж не сходится", payload, stars);
    return null;
  }
  const done = tx(() => {
    const fresh = get<{ status: string }>("SELECT status FROM payments WHERE id = ?", payload);
    if (fresh?.status === "succeeded") return false;
    run("UPDATE payments SET status = 'succeeded', paid_at = datetime('now'), charge_id = ? WHERE id = ?", chargeId, payload);
    extend(row.pair_id, row.plan);
    return true;
  });
  if (!done) return null;
  changed(row.pair_id, "pair");
  return row;
}

/** Незакрытые счета пары за последние сутки: их перепроверяем, когда человек вернулся из оплаты. */
export function pendingOf(pairId: number): PaymentRow[] {
  return all<PaymentRow>(
    "SELECT * FROM payments WHERE pair_id = ? AND method = 'yookassa' AND status IN ('pending', 'waiting_for_capture') AND created_at > datetime('now', '-1 day') ORDER BY created_at DESC LIMIT 5",
    pairId,
  );
}

// ——— чек самозанятого ———

const SERVICE: Record<Plan, string> = {
  month: "Доступ к «Вдвоём+» на 1 месяц",
  year: "Доступ к «Вдвоём+» на 1 год",
  year_offer: "Доступ к «Вдвоём+» на 1 год",
  forever: "Бессрочный доступ к «Вдвоём+»",
};

/**
 * Напоминание владельцу: какой чек пробить в «Мой налог» после оплаты рублями.
 * Без имён и без пары — только то, что нужно для чека: сумма, дата и время
 * оплаты по Москве, название услуги, покупатель-физлицо и почта, куда отправить
 * чек (по 54-ФЗ его нужно передать покупателю). null — платёж не рублёвый или
 * ещё не прошёл.
 */
export function receiptNote(pay: Pick<PaymentRow, "id" | "plan" | "amount" | "status" | "paid_at"> & { method?: string; email?: string | null }): string | null {
  if (pay.status !== "succeeded" || (pay.method && pay.method !== "yookassa")) return null;
  const at = pay.paid_at ? new Date(`${pay.paid_at.replace(" ", "T")}Z`) : new Date();
  const when = at.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return [
    "🧾 <b>Пробей чек в «Мой налог»</b>",
    "",
    `Сумма: ${pay.amount.toLocaleString("ru-RU")} ₽`,
    `Дата: ${when} (МСК)`,
    `Услуга: ${SERVICE[pay.plan] ?? "Доступ к «Вдвоём+»"}`,
    "Покупатель: физическое лицо",
    ...(pay.email ? [`Чек отправь на почту: ${pay.email.replace(/[<>&]/g, "")}`] : []),
    "",
    `<i>Платёж ${pay.id}. Чек нужно пробить сразу: ЮKassa его за самозанятых не делает.</i>`,
  ].join("\n");
}
