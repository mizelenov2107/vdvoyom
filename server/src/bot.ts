import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, type Context } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.ts";
import { all, get, run } from "./db.ts";
import { displayName, type UserRow } from "./model.ts";
import { joinPair } from "./pairs.ts";
import { changed, isOnline } from "./realtime.ts";
import { plusOf, starsPaid, starsPrecheck, type PaymentRow } from "./plus.ts";
import { dayMonth } from "./time.ts";
import { FEEDBACK_KINDS, type FeedbackRow } from "./feedback.ts";
import { isNewUser, setSource } from "./track.ts";
import { alarm } from "./alarm.ts";
import { track } from "./adminData.ts";

// Таймаут запроса 60 с вместо 500 с по умолчанию: с российского сервера соединение
// с телеграмом иногда виснет, и запуск бота ждал бы восемь минут. Длинный опрос
// getUpdates держит 30 с, так что запас есть.
export const bot = env.botToken ? new Bot(env.botToken, { client: { timeoutSeconds: 60 } }) : null;
// Настоящее имя приходит из getMe при старте; до этого — это, а не выдуманное
export let botUsername = process.env.BOT_USERNAME ?? "vdvoyom_app_bot";

/** Ссылка на экран мини-приложения. Хеш занят параметрами телеграма, поэтому экран — в query. */
export function appUrl(go?: string): string {
  return go ? `${env.publicUrl}/?go=${encodeURIComponent(go)}` : `${env.publicUrl}/`;
}

/**
 * Ссылка-приглашение открывает мини-приложение сразу (главное приложение
 * включено в BotFather 24.09.2026). Код пары приходит в start_param, и
 * /api/me соединяет пару при первом же открытии. Старые ссылки вида
 * ?start=pair_… по-прежнему работают через /start в чате.
 */
export function inviteLink(code: string): string {
  return `https://t.me/${botUsername}?startapp=pair_${code}`;
}

function openButton(text = "Открыть «Вдвоём»", go?: string) {
  return new InlineKeyboard().webApp(text, appUrl(go));
}

/**
 * Картинка к сообщению: файл с нашего диска (постер, фото места)
 * или ссылка на чужую картинку (хотелка из магазина). Свои файлы загружаем
 * сами, а не ссылкой: входящие соединения от телеграма к российскому серверу
 * рвутся, так что забрать картинку по нашему адресу он может не суметь.
 */
export type Photo = { path: string } | { url: string };

/** Картинки, которые телеграм уже хранит: тот же постер второй раз не грузим. */
const fileIds = new Map<string, string>();

/** Картинка приветствия /start: data/bot/welcome.jpg. */
export const welcomePhoto = (): Photo => ({ path: path.join(env.dataDir, "bot", "welcome.jpg") });

async function deliver(userId: number, text: string, markup: InlineKeyboard | undefined, photo?: Photo | null): Promise<void> {
  if (photo && ("url" in photo || fs.existsSync(photo.path))) {
    const key = "path" in photo ? photo.path : photo.url;
    try {
      const m = await bot!.api.sendPhoto(userId, fileIds.get(key) ?? ("path" in photo ? new InputFile(photo.path) : photo.url), {
        caption: text.slice(0, 1024),
        parse_mode: "HTML",
        reply_markup: markup,
      });
      const id = m.photo?.at(-1)?.file_id;
      if (id) fileIds.set(key, id);
      return;
    } catch (e) {
      if ((e as { error_code?: number }).error_code === 403) throw e;
      // Картинка не прошла (формат, чужой сайт не отдал) — сообщение важнее, шлём текстом
      console.warn("бот: картинка не ушла, шлю текстом", key, (e as Error).message);
    }
  }
  await bot!.api.sendMessage(userId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: markup });
}

/**
 * Сообщение в личку от бота. Телеграм с российского сервера иногда рвёт
 * соединение, поэтому до трёх попыток; без токена просто пишем в лог.
 */
export async function sendTo(userId: number, text: string, button?: { text: string; go?: string }, photo?: Photo | null): Promise<boolean> {
  if (!bot) {
    console.log(`[бот → ${userId}]${photo ? ` [фото ${"path" in photo ? path.basename(photo.path) : photo.url}]` : ""} ${text}`);
    return true;
  }
  const u = get<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  if (!u?.chat_ok) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await deliver(userId, text, button ? openButton(button.text, button.go) : undefined, photo);
      return true;
    } catch (e) {
      const code = (e as { error_code?: number }).error_code;
      // 403 — пользователь заблокировал бота; повторять бессмысленно
      if (code === 403) {
        run("UPDATE users SET chat_ok = 0 WHERE id = ?", userId);
        return false;
      }
      if (attempt === 3) console.error("sendTo", userId, e);
      else await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  return false;
}

/**
 * Уведомить половинку. quietIfOnline: если она сейчас в приложении и увидит
 * изменение вживую, в чат не пишем — иначе бот превращается в спам.
 */
export async function notifyPartner(
  me: UserRow,
  text: string,
  opts: { button?: { text: string; go?: string }; quietIfOnline?: boolean; photo?: Photo | null } = {},
): Promise<void> {
  if (!me.pair_id) return;
  const partner = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ?", me.pair_id, me.id);
  if (!partner) return;
  if (opts.quietIfOnline && isOnline(me.pair_id, partner.id)) return;
  await sendTo(partner.id, text, opts.button, opts.photo);
}

/** Сообщение со своей клавиатурой (например, кнопки ответа на приглашение). */
export async function sendRaw(userId: number, text: string, keyboard: InlineKeyboard, photo?: Photo | null): Promise<boolean> {
  if (!bot) {
    console.log(`[бот → ${userId}]${photo ? " [фото]" : ""} ${text}`);
    return true;
  }
  const u = get<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  if (!u?.chat_ok) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await deliver(userId, text, keyboard, photo);
      return true;
    } catch (e) {
      if ((e as { error_code?: number }).error_code === 403) return false;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  return false;
}

export function inviteKeyboard(eventId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("💞 Иду", `rsvp:${eventId}:1`)
    .text("Не получится", `rsvp:${eventId}:0`)
    .row()
    .webApp("Открыть календарь", appUrl("calendar"));
}

/**
 * Ответ на приглашение — из чата кнопкой или из приложения. Отвечать может
 * только половинка, а не тот, кто позвал.
 */
export async function answerInvite(eventId: number, userId: number, yes: boolean): Promise<{ ok: boolean; error?: string; title?: string }> {
  const ev = get<{ id: number; pair_id: number; author_id: number; title: string; status: string | null; date: string; start_min: number | null }>(
    "SELECT id, pair_id, author_id, title, status, date, start_min FROM events WHERE id = ?",
    eventId,
  );
  const u = get<UserRow>("SELECT * FROM users WHERE id = ?", userId);
  if (!ev || !u || u.pair_id !== ev.pair_id) return { ok: false, error: "Приглашение не нашлось" };
  if (ev.author_id === userId) return { ok: false, error: "Это твоё приглашение" };
  run("UPDATE events SET status = ? WHERE id = ?", yes ? "accepted" : "declined", ev.id);
  changed(ev.pair_id, "events");
  const name = esc(displayName(u));
  await sendTo(
    ev.author_id,
    yes
      ? `🎉 <b>${name} идёт!</b>\n\n💞 ${esc(ev.title)}\nУже в календаре у обоих 🗓`
      : `😔 <b>${name} не получится</b>\n\n${esc(ev.title)}\nПосмотрите другое общее окно 👇`,
    { text: yes ? "Календарь" : "Общие окна", go: yes ? "calendar" : "windows" },
  );
  return { ok: true, title: ev.title };
}

const WELCOME =
  "💞 <b>Привет! Это «Вдвоём»</b>, общее пространство для пары прямо в Телеграме.\n\n" +
  "🗓 <b>Когда вы оба свободны</b>: по двум расписаниям, с дорогой\n" +
  "🍿 <b>Фильм и место на вечер</b>: свайпаете, совпало — мэтч\n" +
  "🎁 <b>Хотелки, копилки и дела</b>: всё общее в одном месте\n" +
  "💬 <b>Вопрос дня и тесты</b>: узнавать друг друга дальше\n\n" +
  "Открывай и зови половинку ссылкой 👇";

/**
 * Описания бота: короткое видно в профиле и при пересылке ссылки, длинное — в
 * пустом чате до «Старт». Меняем, только если текст другой: телеграм
 * ограничивает частоту таких вызовов.
 */
async function describeBot(): Promise<void> {
  if (!bot) return;
  const short = env.support
    ? `Приложение для пары 💞 Поддержка ${env.support}`
    : "Общее пространство для пары: когда вы оба свободны, фильм и место на вечер, хотелки и планы 💞";
  const long =
    "💞 «Вдвоём» — приложение для пары прямо в Телеграме.\n\n" +
    "🗓 Находит, когда вы оба свободны, по двум расписаниям\n" +
    "🍿 Фильм на вечер и места свайпами: совпало — мэтч\n" +
    "🎁 Хотелки, копилки, общие дела и цели\n" +
    "💬 Вопрос дня, тесты и письма в будущее\n\n" +
    "Нажми «Старт», а потом позови половинку ссылкой." +
    (env.support ? `\n\nПоддержка: ${env.support}` : "");
  try {
    if ((await bot.api.getMyShortDescription()).short_description !== short) await bot.api.setMyShortDescription(short);
    if ((await bot.api.getMyDescription()).description !== long) await bot.api.setMyDescription(long);
  } catch (e) {
    console.warn("бот: описание не обновилось", (e as Error).message);
  }
}

/** Спасибо обоим: платит один, «Вдвоём+» включается у двоих. */
export async function thankForPlus(pay: PaymentRow): Promise<void> {
  const { until, forever } = plusOf(pay.pair_id);
  const payer = get<UserRow>("SELECT * FROM users WHERE id = ?", pay.user_id);
  const other = get<UserRow>("SELECT * FROM users WHERE pair_id = ? AND id != ? AND id > 0", pay.pair_id, pay.user_id);
  const till = forever ? " навсегда" : until ? ` до ${dayMonth(until)}` : "";
  await sendTo(pay.user_id, `💞 <b>«Вдвоём+» включён${till}</b>\n\nСпасибо, что поддерживаешь приложение!`, { text: "Открыть", go: "plus" });
  if (other && payer) await sendTo(other.id, `💞 <b>${esc(displayName(payer))} включает «Вдвоём+» для вас обоих${till}</b>`, { text: "Открыть", go: "plus" });
}

/**
 * Отзыв из приложения — владельцу (SUPPORT_CHAT_ID): текст с тем, кто и откуда
 * написал, скриншоты ответом на него. id сообщения запоминаем: реплай владельца
 * на него бот перешлёт автору (обработчик ниже, перед общим ответом на сообщения).
 */
export async function feedbackToOwner(id: number): Promise<void> {
  const f = get<FeedbackRow>("SELECT * FROM feedback WHERE id = ?", id);
  if (!f) return;
  const u = get<UserRow>("SELECT * FROM users WHERE id = ?", f.user_id);
  const who = `${esc(u ? displayName(u) : "?")}${u?.username ? ` @${esc(u.username)}` : ""}, id ${f.user_id}${f.pair_id ? `, пара ${f.pair_id}` : ""}`;
  const text =
    `💬 <b>Отзыв · ${FEEDBACK_KINDS[f.kind]}</b>\nот ${who}\nэкран: ${esc(f.screen ?? "?")} · ${esc(f.platform ?? "?")}\n\n${esc(f.text)}` +
    `\n\n<i>Ответь на это сообщение — ответ уйдёт автору.</i>`;
  const photos: string[] = f.photos ? JSON.parse(f.photos) : [];
  // С 28.09.2026 новые отзывы присылает «Ассистент» (он читает /admin по ключу) — здесь не дублируем
  if (env.adminToken) return;
  if (!bot || !env.supportChatId) {
    console.log(`[отзыв ${id} → владельцу]${photos.length ? ` [скриншотов: ${photos.length}]` : ""} ${text}`);
    return;
  }
  const m = await bot.api.sendMessage(env.supportChatId, text, { parse_mode: "HTML" });
  run("UPDATE feedback SET tg_message = ? WHERE id = ?", m.message_id, id);
  const files = photos.map((p) => path.join(env.photosDir, p)).filter((p) => fs.existsSync(p));
  const reply_parameters = { message_id: m.message_id };
  if (files.length === 1) await bot.api.sendPhoto(env.supportChatId, new InputFile(files[0]), { reply_parameters });
  else if (files.length > 1) await bot.api.sendMediaGroup(env.supportChatId, files.map((p) => InputMediaBuilder.photo(new InputFile(p))), { reply_parameters });
}

/** Ответ владельца автору отзыва: из реплая в этом боте или из «Ассистента» через /admin. */
export async function replyToFeedback(f: FeedbackRow, answer: string): Promise<boolean> {
  const quote = f.text.length > 300 ? `${f.text.slice(0, 300)}…` : f.text;
  const ok = await sendTo(f.user_id, `💬 <b>Ответ на твой отзыв</b>\n\n<blockquote>${esc(quote)}</blockquote>\n${esc(answer)}`, { text: "Открыть «Вдвоём»" });
  run("UPDATE feedback SET reply = ? WHERE id = ?", answer, f.id);
  return ok;
}

/** Кто написал /paysupport и когда: его следующее сообщение уходит в поддержку. */
const supportWaiting = new Map<number, number>();

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (bot) {
  // Бот рассчитан только на личку: если его добавили в группу или канал — тихо выходит
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type !== "private" && ["member", "administrator"].includes(ctx.myChatMember.new_chat_member.status)) {
      await ctx.leaveChat().catch(() => {});
    }
  });
  bot.drop((ctx) => ctx.chat?.type !== undefined && ctx.chat.type !== "private");

  bot.command("start", async (ctx: Context) => {
    const from = ctx.from!;
    const fresh = isNewUser(from.id);
    run(
      `INSERT INTO users (id, first_name, username, chat_ok) VALUES (?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET chat_ok = 1, first_name = excluded.first_name, username = excluded.username`,
      from.id,
      from.first_name,
      from.username ?? null,
    );
    const payload = (ctx.match as string | undefined)?.trim() ?? "";
    // Ссылка блогера t.me/<бот>?start=b_<код> и любая другая метка — источник прихода.
    // Только при первом знакомстве: кто уже был, тому первое касание не переписываем
    if (fresh) {
      track(from.id, null, "JOIN");
      setSource(from.id, payload);
    }
    // Ссылка «Написать в поддержку» со шторки оплаты
    if (payload === "paysupport") return askPaySupport(ctx);
    if (payload.startsWith("pair_")) {
      const result = joinPair(from.id, payload.slice(5));
      if (result.ok && result.already) {
        await ctx.reply(`💞 Вы уже вдвоём с ${esc(displayName(result.partner!))}. Открывай 👇`, { parse_mode: "HTML", reply_markup: openButton() });
        return;
      }
      if (result.ok) {
        const partner = result.partner!;
        await sendTo(from.id, `💞 <b>Готово, теперь вы вдвоём с ${esc(displayName(partner))}!</b>\n\nВсё общее уже в приложении: календарь, хотелки, фильм на вечер. Загляни 👇`, { text: "Открыть «Вдвоём»" }, welcomePhoto());
        const me = get<UserRow>("SELECT * FROM users WHERE id = ?", from.id)!;
        changed(me.pair_id!, "pair");
        await sendTo(partner.id, `🎉 <b>${esc(displayName(me))} теперь с тобой во «Вдвоём»!</b>\n\nВсё, что уже было в приложении, стало общим 💞`, { text: "Открыть" });
        return;
      }
      await ctx.reply(`😕 ${result.error ?? "Не получилось присоединиться."}\n\nПопроси половинку прислать свежую ссылку из приложения.`, { reply_markup: openButton() });
      return;
    }
    await sendTo(from.id, WELCOME, { text: "Открыть «Вдвоём»" }, welcomePhoto());
  });

  bot.command("app", (ctx) => ctx.reply("📱 Открывай «Вдвоём» 👇", { reply_markup: openButton() }));

  bot.command("help", (ctx) =>
    ctx.reply(
      "💞 <b>Как устроено «Вдвоём»</b>\n\n" +
        "1️⃣ Открой приложение кнопкой ниже и заполни профиль\n" +
        "2️⃣ Позови половинку ссылкой, и пространство станет общим\n" +
        "3️⃣ Добавь расписание: РЭУ подтянется само, любое другое вставляется скриншотом через чат с ИИ\n\n" +
        "<b>Команды</b>\n/app — открыть приложение\n/miss — сказать, что скучаешь 💭\n\n" +
        `🔒 Как мы храним данные: ${env.publicUrl}/privacy\n🗑 Удалить аккаунт: «Ещё» → «Настройки»`,
      { parse_mode: "HTML", reply_markup: openButton(), link_preview_options: { is_disabled: true } },
    ),
  );

  bot.command("miss", async (ctx) => {
    const me = get<UserRow>("SELECT * FROM users WHERE id = ?", ctx.from!.id);
    if (!me?.pair_id) return ctx.reply("Сначала пригласи половинку в приложении.", { reply_markup: openButton() });
    run("INSERT INTO pings (pair_id, from_id, kind) VALUES (?, ?, 'miss')", me.pair_id, me.id);
    await notifyPartner(me, `💭 <b>${esc(displayName(me))} скучает по тебе</b>\n\nОтветь чем-нибудь тёплым 🤗`, { button: { text: "Ответить", go: "home" } });
    changed(me.pair_id, "pings");
    return ctx.reply("💌 Передал, что ты скучаешь");
  });

  bot.callbackQuery(/^rsvp:(\d+):([01])$/, async (ctx) => {
    const [, id, yes] = ctx.match as RegExpMatchArray;
    const r = await answerInvite(Number(id), ctx.from.id, yes === "1");
    await ctx.answerCallbackQuery({ text: r.ok ? (yes === "1" ? "Отлично, записал в календарь 💞" : "Передам") : r.error });
    if (r.ok) {
      await ctx
        // Приглашение могло прийти с картинкой: тогда правим подпись, а не текст
        .editMessageText(yes === "1" ? `💞 <b>Ты идёшь!</b>\n\n${esc(r.title ?? "")}\nЗаписал в календарь 🗓` : `🙈 <b>Ты не сможешь</b>\n\n${esc(r.title ?? "")}\nПередал, выберите другое окно`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().webApp("Открыть календарь", appUrl("calendar")),
        })
        .catch(() =>
          ctx
            .editMessageCaption({
              caption: yes === "1" ? `💞 <b>Ты идёшь!</b>\n\n${esc(r.title ?? "")}\nЗаписал в календарь 🗓` : `🙈 <b>Ты не сможешь</b>\n\n${esc(r.title ?? "")}\nПередал, выберите другое окно`,
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().webApp("Открыть календарь", appUrl("calendar")),
            })
            .catch(() => {}),
        );
    }
  });

  // Оплата звёздами: перед списанием телеграм спрашивает, в силе ли счёт
  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const err = starsPrecheck(q.invoice_payload, q.total_amount, q.currency);
    await ctx.answerPreCheckoutQuery(!err, err ? { error_message: err } : undefined);
  });

  // Звёзды списаны — продлеваем «Вдвоём+». Стоит раньше общего ответа на сообщения
  bot.on("message:successful_payment", async (ctx) => {
    const p = ctx.message.successful_payment;
    const row = starsPaid(p.invoice_payload, p.total_amount, p.telegram_payment_charge_id);
    if (row) await thankForPlus(row);
  });

  // Помощь с оплатой — Телеграм требует от ботов со звёздами отвечать на /paysupport.
  // Следующее сообщение человека после команды пересылаем владельцу вместе с его платежами.
  bot.command("paysupport", (ctx) => askPaySupport(ctx));

}

/** Помощь с оплатой: и командой /paysupport, и ссылкой t.me/<бот>?start=paysupport со шторки оплаты. */
async function askPaySupport(ctx: Context): Promise<void> {
  supportWaiting.set(ctx.from!.id, Date.now());
  await ctx.reply(
      "💳 <b>Помощь с оплатой</b>\n\nОпиши одним сообщением, что случилось: деньги списались, а «Вдвоём+» не включился, или хочешь вернуть оплату. Ответим в течение суток и, если нужно, вернём деньги или звёзды." +
        (env.support ? `\n\nМожно написать и напрямую: ${env.support}` : ""),
      { parse_mode: "HTML" },
    );
}

if (bot) {
  // Реплай владельца на «💬 Отзыв» уходит автору отзыва от имени бота
  bot.on("message", async (ctx, next) => {
    const to = ctx.message.reply_to_message?.message_id;
    if (!to || !env.supportChatId || ctx.chat.id !== env.supportChatId) return next();
    const f = get<FeedbackRow>("SELECT * FROM feedback WHERE tg_message = ?", to);
    if (!f) return next();
    const answer = ctx.message.text?.trim();
    if (!answer) {
      await ctx.reply("Ответ на отзыв уходит только текстом");
      return;
    }
    const ok = await replyToFeedback(f, answer);
    await ctx.reply(ok ? "✅ Ответ ушёл автору" : "⚠️ Не дошло: автор не запускал чат с ботом", { reply_parameters: { message_id: ctx.message.message_id } });
  });

  bot.on("message", async (ctx) => {
    const since = supportWaiting.get(ctx.from.id);
    if (since && Date.now() - since < 30 * 60_000) {
      supportWaiting.delete(ctx.from.id);
      if (env.supportChatId) {
        const pays = all<{ id: string; plan: string; amount: number; method: string; status: string; created_at: string }>(
          "SELECT id, plan, amount, method, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
          ctx.from.id,
        );
        const who = `${esc(ctx.from.first_name)}${ctx.from.username ? ` @${esc(ctx.from.username)}` : ""}, id ${ctx.from.id}`;
        const list = pays.map((p) => `• ${p.created_at.slice(0, 16)} ${p.plan} ${p.amount} ${p.method === "stars" ? "⭐" : "₽"} — ${p.status}`).join("\n");
        await sendTo(env.supportChatId, `💳 <b>/paysupport</b> от ${who}\n\n${esc(ctx.message.text ?? "(не текст)")}\n\n${list || "платежей нет"}`);
        await ctx.forwardMessage(env.supportChatId).catch(() => {});
      }
      await ctx.reply("🙏 Передал. Ответим в течение суток.");
      return;
    }
    await ctx.reply("🙈 Я не читаю переписку: всё общее живёт в приложении 👇", { reply_markup: openButton() });
  });

  bot.catch((err) => {
    console.error("bot error", err.error);
    void alarm({ kind: "bot", error: err.error, userId: err.ctx.from?.id ?? null });
  });
}

let polling = false;

/** При старте: узнать имя бота, повесить кнопку меню и команды. Ошибки не роняют сервер. */
export async function initBot(): Promise<void> {
  if (!bot) return;
  try {
    await bot.init();
    botUsername = bot.botInfo.username;
    await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Вдвоём", web_app: { url: appUrl() } } });
    await bot.api.setMyCommands([
      { command: "app", description: "Открыть приложение" },
      { command: "miss", description: "Сказать, что скучаешь" },
      { command: "help", description: "Как это работает и данные" },
      { command: "paysupport", description: "Помощь с оплатой" },
    ]);
    await describeBot();
    if (env.botMode === "webhook" && env.webhookSecret) {
      await bot.api.setWebhook(`${env.publicUrl}/tg/webhook`, {
        secret_token: env.webhookSecret,
        allowed_updates: ["message", "callback_query", "my_chat_member", "pre_checkout_query"],
        drop_pending_updates: false,
      });
    } else if (!polling) {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      polling = true;
      // Не ждём: start живёт, пока жив процесс. Сетевые сбои grammY переживает сам.
      void bot.start({ allowed_updates: ["message", "callback_query", "my_chat_member", "pre_checkout_query"], onStart: () => console.log("бот слушает телеграм сам") });
      process.once("SIGTERM", () => void bot.stop());
      process.once("SIGINT", () => void bot.stop());
    }
    console.log(`бот @${botUsername} готов`);
  } catch (e) {
    console.error("initBot: телеграм не ответил, повторю через минуту", e);
    setTimeout(() => void initBot(), 60_000);
  }
}

/** Все пары, у которых оба в сборе, — для крона. */
export function fullPairs(): { pair_id: number; a: UserRow; b: UserRow }[] {
  const users = all<UserRow>("SELECT * FROM users WHERE pair_id IS NOT NULL ORDER BY pair_id, id");
  const out: { pair_id: number; a: UserRow; b: UserRow }[] = [];
  for (let i = 0; i + 1 < users.length; i++) {
    if (users[i].pair_id === users[i + 1].pair_id) {
      out.push({ pair_id: users[i].pair_id!, a: users[i], b: users[i + 1] });
      i++;
    }
  }
  return out;
}
