import { test } from "node:test";
import assert from "node:assert/strict";
import { get, run } from "../src/db.ts";
import { env } from "../src/env.ts";
import { ensurePair } from "../src/pairs.ts";
import { checkout, plusOf, receiptNote, settle, type YooPayment } from "../src/plus.ts";
import { addDays, today } from "../src/time.ts";

// Магазин «есть»: ЮKassa подменена, чтобы проверить путь денег без сети
env.yookassaShopId = "test-shop";
env.yookassaSecret = "test-secret";

let answer: Partial<YooPayment> = {};
const calls: { url: string; key: string | null }[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, key: (init?.headers as Record<string, string>)?.["Idempotence-Key"] ?? null });
  const id = url.split("/payments/")[1] ?? answer.id ?? "p-new";
  return new Response(JSON.stringify({ id, status: "pending", paid: false, amount: { value: "199.00", currency: "RUB" }, ...answer }));
}) as typeof fetch;

run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9301, 'Платит', 1)");
const pairId = ensurePair(9301).id;

test("счёт, оплата и повтор уведомления", async () => {
  answer = { id: "p-month", confirmation: { confirmation_url: "https://yoomoney.ru/checkout/p-month" } };
  const url = await checkout(pairId, 9301, "month", "https://t.me/bot?startapp=plus", fakeFetch);
  assert.equal(url, "https://yoomoney.ru/checkout/p-month");
  assert.match(calls[0].key!, /^vdvoyom:\d+:9301:month:\d+$/, "ключ идемпотентности от двойного нажатия");
  assert.equal(get<{ status: string }>("SELECT status FROM payments WHERE id = 'p-month'")?.status, "pending");
  assert.equal(plusOf(pairId).active, false);

  answer = { status: "pending", paid: false };
  assert.equal(await settle("p-month", fakeFetch), "pending", "пока не оплачен — ничего не включаем");

  answer = { status: "succeeded", paid: true, amount: { value: "199.00", currency: "RUB" }, metadata: { pair_id: String(pairId) } };
  assert.equal(await settle("p-month", fakeFetch), "paid");
  assert.deepEqual(plusOf(pairId), { active: true, until: addDays(today(), 30), forever: false });
  assert.equal(await settle("p-month", fakeFetch), "already", "второе уведомление не продлевает ещё раз");
  assert.equal(plusOf(pairId).until, addDays(today(), 30));
});

test("год поверх оплаченного месяца прибавляется к концу", async () => {
  answer = { id: "p-year", confirmation: { confirmation_url: "https://yoomoney.ru/checkout/p-year" }, status: "pending", paid: false, amount: { value: "1490.00", currency: "RUB" } };
  await checkout(pairId, 9301, "year", "https://t.me/bot?startapp=plus", fakeFetch);
  answer = { status: "succeeded", paid: true, amount: { value: "1490.00", currency: "RUB" }, metadata: { pair_id: String(pairId) } };
  assert.equal(await settle("p-year", fakeFetch), "paid");
  assert.equal(plusOf(pairId).until, addDays(today(), 30 + 365));
});

test("чужая сумма или чужая пара не включают доступ, отмена закрывает счёт", async () => {
  answer = { id: "p-cheap", confirmation: { confirmation_url: "https://yoomoney.ru/checkout/p-cheap" }, status: "pending", paid: false };
  await checkout(pairId, 9301, "month", "https://t.me/bot?startapp=plus", fakeFetch);
  const before = plusOf(pairId).until;
  answer = { status: "succeeded", paid: true, amount: { value: "1.00", currency: "RUB" }, metadata: { pair_id: String(pairId) } };
  assert.equal(await settle("p-cheap", fakeFetch), "pending", "рубль вместо 199 ₽");
  answer = { status: "succeeded", paid: true, amount: { value: "199.00", currency: "RUB" }, metadata: { pair_id: "999999" } };
  assert.equal(await settle("p-cheap", fakeFetch), "pending", "платёж другой пары");
  assert.equal(plusOf(pairId).until, before);
  answer = { status: "canceled", paid: false };
  assert.equal(await settle("p-cheap", fakeFetch), "canceled");
  assert.equal(await settle("нет-такого", fakeFetch), "unknown");
});

test("звёзды: проверка перед списанием, зачёт и повтор", async () => {
  const { starsPayment, starsPrecheck, starsPaid } = await import("../src/plus.ts");
  const before = plusOf(pairId).until;
  const pay = starsPayment(pairId, 9301, "month");
  assert.equal(pay.stars, 150);
  assert.equal(starsPrecheck(pay.id, 150, "XTR"), null, "свой счёт на свою сумму проходит");
  assert.match(starsPrecheck(pay.id, 1, "XTR")!, /Сумма/, "одна звезда вместо 150 — отказ");
  assert.match(starsPrecheck("stars-чужой", 150, "XTR")!, /не найден/);
  assert.equal(starsPaid(pay.id, 1, "tg-charge-0"), null, "списали не столько — не зачитываем");
  assert.ok(starsPaid(pay.id, 150, "tg-charge-1"), "оплачено");
  assert.equal(plusOf(pairId).until, addDays(before!, 30), "месяц прибавился к концу оплаченного срока");
  assert.equal(starsPaid(pay.id, 150, "tg-charge-1"), null, "повторное сообщение телеграма не продлевает ещё раз");
  assert.match(starsPrecheck(pay.id, 150, "XTR")!, /уже оплачен/);
});

test("«навсегда»: срок больше не кончается, поверх него ничего не прибавляется и не покупается", async () => {
  const { FOREVER } = await import("../src/plus.ts");
  answer = { id: "p-forever", confirmation: { confirmation_url: "https://yoomoney.ru/checkout/p-forever" }, status: "pending", paid: false, amount: { value: "1990.00", currency: "RUB" } };
  await checkout(pairId, 9301, "forever", "https://t.me/bot?startapp=plus", fakeFetch);
  answer = { status: "succeeded", paid: true, amount: { value: "1990.00", currency: "RUB" }, metadata: { pair_id: String(pairId) } };
  assert.equal(await settle("p-forever", fakeFetch), "paid");
  assert.deepEqual(plusOf(pairId), { active: true, until: FOREVER, forever: true });
  // Счёт на месяц, выставленный раньше и оплаченный позже, срок не ломает
  answer = { id: "p-late", confirmation: { confirmation_url: "https://yoomoney.ru/checkout/p-late" }, status: "pending", paid: false };
  await checkout(pairId, 9301, "month", "https://t.me/bot?startapp=plus", fakeFetch);
  answer = { status: "succeeded", paid: true, amount: { value: "199.00", currency: "RUB" }, metadata: { pair_id: String(pairId) } };
  assert.equal(await settle("p-late", fakeFetch), "paid");
  assert.equal(plusOf(pairId).until, FOREVER, "не 10000-01-30, которое строкой меньше сегодняшней даты");
  assert.equal(plusOf(pairId).active, true);
});

test("чек самозанятого: владельцу — сумма, дата по Москве и услуга, без имён; звёзды и неоплаченное — без чека", () => {
  const note = receiptNote({ id: "p-r", plan: "year_offer", amount: 990, status: "succeeded", paid_at: "2026-10-11 21:30:00", method: "yookassa", email: "a@b.ru" })!;
  assert.match(note, /Пробей чек в «Мой налог»/);
  assert.match(note, /Сумма: 990 ₽/);
  assert.match(note, /Дата: 12\.10\.2026, 00:30 \(МСК\)/, "дата по Москве, а не по UTC");
  assert.match(note, /Услуга: Доступ к «Вдвоём\+» на 1 год/);
  assert.match(note, /a@b\.ru/, "почта покупателя — чтобы отправить ему чек");
  assert.match(receiptNote({ id: "p-f", plan: "forever", amount: 1990, status: "succeeded", paid_at: null, method: "yookassa" })!, /Бессрочный доступ/);
  assert.equal(receiptNote({ id: "s", plan: "month", amount: 150, status: "succeeded", paid_at: null, method: "stars" }), null);
  assert.equal(receiptNote({ id: "p", plan: "month", amount: 199, status: "pending", paid_at: null, method: "yookassa" }), null);
});
