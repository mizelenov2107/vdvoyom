import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function flag(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true";
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  /** Адрес, по которому телеграм открывает мини-приложение. Без слеша на конце. */
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  botToken: process.env.BOT_TOKEN ?? "",
  /**
   * Как бот получает апдейты. polling — сам ходит к телеграму: с российского
   * хостинга входящие соединения от телеграма иногда рвутся, а исходящие по
   * IPv6 проходят. webhook — телеграм стучится к нам.
   */
  botMode: (process.env.BOT_MODE ?? "polling") as "polling" | "webhook",
  /** Секрет в заголовке вебхука и подпись ссылок на фото. */
  webhookSecret: process.env.WEBHOOK_SECRET ?? "",
  dbPath: process.env.DB_PATH ?? path.join(root, "dev.db"),
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  /** Фото пары. На проде — том /data, чтобы пересборка образа их не трогала. */
  photosDir: process.env.PHOTOS_DIR ?? path.join(path.dirname(process.env.DB_PATH ?? path.join(root, "dev.db")), "photos"),
  /** Рейтинги IMDb — отдельная база рядом с основной: скачивается заново, в копии не идёт. */
  imdbDbPath: process.env.IMDB_DB_PATH ?? path.join(path.dirname(process.env.DB_PATH ?? path.join(root, "dev.db")), "imdb-ratings.db"),
  /** Постеры фильмов, которые пары добавили сами. Отдаются открыто по /film-posters/. */
  filmPostersDir: process.env.FILM_POSTERS_DIR ?? path.join(path.dirname(process.env.DB_PATH ?? path.join(root, "dev.db")), "film-posters"),
  /** Магазин ЮKassa для «Вдвоём+». Пусто — оплата не подключена, кнопка честно это говорит. */
  yookassaShopId: process.env.YOOKASSA_SHOP_ID ?? "",
  yookassaSecret: process.env.YOOKASSA_SECRET_KEY ?? "",
  /** Продавец для страницы условий: «ИП Иванов Иван Иванович, ИНН …» и почта для вопросов. */
  /**
   * Чеки 54-ФЗ через ЮKassa («Чеки от ЮKassa»): 1 — передавать чек с почтой
   * покупателя. На налоге для самозанятых чек выбивает «Мой налог», тогда 0.
   */
  yookassaReceipts: flag("YOOKASSA_RECEIPTS"),
  /** Контакт поддержки для описания бота и экрана оплаты, например @vdvoyom_help */
  support: process.env.SUPPORT ?? "",
  /** Куда бот пересылает обращения /paysupport (id чата владельца). Пусто — только ответ человеку. */
  supportChatId: Number(process.env.SUPPORT_CHAT_ID ?? 0) || null,
  seller: process.env.SELLER ?? "",
  sellerEmail: process.env.SELLER_EMAIL ?? "",
  webDist: process.env.WEB_DIST ?? path.join(root, "..", "web", "dist"),
  /**
   * Вход без телеграма, заголовком `Authorization: dev <id>:<имя>`.
   * Только для локальной разработки: на проде это открытая дверь.
   */
  devAuth: flag("DEV_AUTH"),
  /**
   * Платная часть: лимиты, замки на тестах, акция, продающий экран, оплата.
   * Решение 27.09.2026: пока идёт закрытый тест, в бою всё открыто всем, а
   * «Вдвоём+» обкатывается только локально и в тестах (PLUS=1). Включая в бою,
   * сбрось акцию: UPDATE pairs SET offer_until = NULL — иначе у пар, открывших
   * приложение 27.09, она уже сгорела.
   */
  plusOn: flag("PLUS"),
  /** Ключ для /admin: отзывы читает бот «Ассистент» владельца. Пусто — /admin выключен */
  adminToken: process.env.ADMIN_TOKEN ?? "",
  /**
   * Распознавание расписания (28.09.2026): ключ сервисного аккаунта Yandex Cloud
   * (роли ai.languageModels.user и ai.vision.user) и каталог. Нет ключа — кнопки нет.
   */
  yandexApiKey: process.env.YANDEX_API_KEY ?? "",
  yandexFolder: process.env.YANDEX_FOLDER_ID ?? "",
  /** Модель: yandexgpt/latest — YandexGPT Pro; дешевле — yandexgpt-lite/latest */
  scheduleModel: process.env.SCHEDULE_AI_MODEL ?? "yandexgpt/latest",
  /** OCR: page (0,13 ₽ за картинку) или table (1,22 ₽, лучше для сеток) */
  ocrModel: process.env.OCR_MODEL ?? "page",
  /** Тарифы для учёта, ₽ с НДС: за картинку OCR и за 1000 токенов на входе и выходе (сентябрь 2026) */
  priceOcr: Number(process.env.PRICE_OCR ?? 0.1321),
  priceIn: Number(process.env.PRICE_IN ?? 0.4),
  priceOut: Number(process.env.PRICE_OUT ?? 0.4),
  /** Потолок трат на ИИ в месяц, ₽: дальше распознавание на паузе до следующего месяца */
  aiMonthLimitRub: Number(process.env.AI_MONTH_LIMIT_RUB ?? 1000),
  /** Разработка и e2e: ответ без Яндекса (только вместе с DEV_AUTH) */
  aiFake: flag("AI_FAKE"),
  /** Кто видит админку в приложении: ADMIN_IDS через запятую, иначе владелец (SUPPORT_CHAT_ID) */
  adminIds: (process.env.ADMIN_IDS ?? process.env.SUPPORT_CHAT_ID ?? "").split(",").map(Number).filter(Boolean),
  /** Сколько живёт initData. Телеграм выдаёт её при открытии и не обновляет. */
  initDataTtlSec: Number(process.env.INIT_DATA_TTL_SEC ?? 7 * 24 * 3600),
};

if (env.devAuth && process.env.NODE_ENV === "production") {
  throw new Error("DEV_AUTH нельзя включать на проде");
}
