// Расписание по фото или сырому тексту прямо в приложении (28.09.2026), без
// чужого чата с ИИ. Фото → Yandex Vision OCR → текст по строкам таблицы →
// YandexGPT приводит к формату «ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ» → разбор
// parseScheduleText. Если разбор спотыкается, модель один раз правит свои строки.
//
// Почему Яндекс: сервер в России, Claude и OpenAI отсюда недоступны по правилам,
// данные остаются в РФ (152-ФЗ), оплата по факту без минимального платежа
// (у GigaChat для ИП — от 600 ₽ в месяц). Картинки у нас не хранятся.
//
// Деньги: каждый вызов пишется в ai_usage с ценой; сверх AI_MONTH_LIMIT_RUB в
// месяц и 10 распознаваний на человека в сутки кнопка честно просит подождать.
import { all, get, run } from "./db.ts";
import { env } from "./env.ts";
import { addDays } from "./time.ts";
import { parseScheduleText } from "./schedText.ts";

const OCR_URL = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText";
const LLM_URL = "https://llm.api.cloud.yandex.net/v1/chat/completions";
export const AI_PER_DAY = 10;

export const aiFake = () => env.devAuth && env.aiFake;
export const aiReady = () => aiFake() || !!(env.yandexApiKey && env.yandexFolder);

/** Сколько потрачено в этом месяце, ₽. */
export function spentThisMonth(): number {
  return get<{ rub: number | null }>("SELECT SUM(rub) rub FROM ai_usage WHERE at >= datetime('now', 'start of month')")?.rub ?? 0;
}

/** Правила формата — те же, что в подсказке для своего чата (web/src/screens/Calendar.tsx, schedulePrompt). */
export function scheduleRules(today: string, weekdayName: string): string {
  return `Ты переносишь расписание человека в приложение «Вдвоём». Сегодня ${today}, ${weekdayName}.
Ответь только строками расписания, без пояснений и без кода, по одной строке на занятие:
ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ

Правила:
• ДЕНЬ — пн, вт, ср, чт, пт, сб или вс. Можно диапазон «пн-пт» или список «вт,чт».
• Если занятие идёт не каждую неделю (по чётным или нечётным неделям, по отдельным датам), вместо дня пиши дату ГГГГ-ММ-ДД — отдельной строкой на каждую дату с ${today} по ${addDays(today, 56)}.
• ВРЕМЯ — начало и конец в 24-часовом формате: 09:30-10:50. Если указан только номер пары, не выдумывай время — пропусти строку.
• ЧТО — короткое название без фамилий преподавателей.
• ТИП — одно слово: пара, работа, занятия, спорт или другое. Онлайн — допиши «онлайн»: «пара онлайн».
• ГДЕ — аудитория или адрес, можно пусто.
• Не выдумывай то, чего нет в исходном расписании. Повторы одного занятия в разные дни — отдельными строками.

Пример:
пн | 09:30-10:50 | Матанализ, лекция | пара | R405
вт,чт | 10:00-19:00 | Работа | работа | офис
ср | 18:10-19:30 | Английский | пара онлайн |`;
}

interface OcrLine {
  text: string;
  x: number;
  y: number;
  h: number;
}
interface OcrAnswer {
  result?: OcrAnswer;
  textAnnotation?: {
    fullText?: string;
    blocks?: { lines?: { text?: string; boundingBox?: { vertices?: { x?: string; y?: string }[] } }[] }[];
    tables?: { cells?: { text?: string; rowIndex?: string; columnIndex?: string }[] }[];
  };
}

/**
 * Текст картинки по строкам: строки OCR с близкой высотой на странице — одна
 * строка таблицы, слева направо через « | ». Так модели видна сетка расписания,
 * а не столбцы вперемешку, как в fullText. Таблицы (модель table) — по ячейкам.
 */
export function layoutText(a: OcrAnswer): string {
  const t = (a.result ?? a).textAnnotation;
  if (!t) return "";
  const out: string[] = [];
  for (const table of t.tables ?? []) {
    const rows = new Map<number, string[]>();
    for (const c of table.cells ?? []) {
      const r = Number(c.rowIndex ?? 0);
      const row = rows.get(r) ?? [];
      row[Number(c.columnIndex ?? 0)] = (c.text ?? "").replace(/\s+/g, " ").trim();
      rows.set(r, row);
    }
    for (const r of [...rows.keys()].sort((x, y) => x - y)) out.push(Array.from(rows.get(r)!, (v) => v ?? "").join(" | "));
  }
  const lines: OcrLine[] = [];
  for (const b of t.blocks ?? []) {
    for (const l of b.lines ?? []) {
      const v = l.boundingBox?.vertices ?? [];
      const ys = v.map((p) => Number(p.y ?? 0));
      const xs = v.map((p) => Number(p.x ?? 0));
      if (!l.text?.trim() || !ys.length) continue;
      lines.push({ text: l.text.trim(), x: Math.min(...xs), y: (Math.min(...ys) + Math.max(...ys)) / 2, h: Math.max(...ys) - Math.min(...ys) || 10 });
    }
  }
  lines.sort((p, q) => p.y - q.y);
  let row: OcrLine[] = [];
  const flush = () => {
    if (row.length) out.push(row.sort((p, q) => p.x - q.x).map((l) => l.text).join(" | "));
    row = [];
  };
  for (const l of lines) {
    if (row.length && Math.abs(l.y - row[0].y) > Math.max(row[0].h, l.h) * 0.6) flush();
    row.push(l);
  }
  flush();
  return out.join("\n") || t.fullText || "";
}

async function yandex<T>(url: string, body: unknown, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(url, {
    method: "POST",
    headers: { Authorization: `Api-Key ${env.yandexApiKey}`, "x-folder-id": env.yandexFolder, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Яндекс ответил ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

interface Chat {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Только строки расписания: без ```-обёрток и пояснений вокруг. */
export function onlyRows(s: string): string {
  return s
    .replace(/```[a-z]*\n?/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("|"))
    .join("\n");
}

export interface AiResult {
  text: string;
  entries: number;
  errors: number;
  rub: number;
}

/**
 * Распознать: картинки (до двух) и/или сырой текст → строки формата. Лимиты
 * проверяет вызывающий (маршрут), здесь — только работа и учёт денег.
 */
export async function recognizeSchedule(
  input: { images: { buf: Buffer; mime: string }[]; text: string },
  today: string,
  weekdayName: string,
  userId: number,
  fetcher: typeof fetch = fetch,
): Promise<AiResult> {
  if (aiFake()) {
    const text = "пн | 09:30-10:50 | Матанализ, лекция | пара | R405\nср | 18:10-19:30 | Английский | пара онлайн |\nвт,чт | 10:00-19:00 | Работа | работа | офис";
    return { text, ...count(text, today), rub: 0 };
  }
  let pages = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const parts: string[] = [];
  for (const img of input.images) {
    const a = await yandex<OcrAnswer>(OCR_URL, { content: img.buf.toString("base64"), mimeType: img.mime, languageCodes: ["ru", "en"], model: env.ocrModel }, fetcher);
    pages++;
    parts.push(layoutText(a));
  }
  if (input.text.trim()) parts.push(input.text.trim());
  const source = parts.filter(Boolean).join("\n\n— следующая страница —\n\n").slice(0, 20_000);

  const messages: { role: string; content: string }[] = [
    { role: "system", content: scheduleRules(today, weekdayName) },
    { role: "user", content: `Вот расписание (распознанный текст, строки таблицы через « | »):\n\n${source}` },
  ];
  const ask = async () => {
    const r = await yandex<Chat>(LLM_URL, { model: `gpt://${env.yandexFolder}/${env.scheduleModel}`, messages, temperature: 0.1, max_tokens: 4000 }, fetcher);
    tokensIn += r.usage?.prompt_tokens ?? 0;
    tokensOut += r.usage?.completion_tokens ?? 0;
    return onlyRows(r.choices?.[0]?.message?.content ?? "");
  };
  let text = "";
  let res = { entries: 0, errors: 0 };
  try {
    if (source.trim().length >= 5) {
      text = await ask();
      res = count(text, today);
      // Разбор споткнулся — даём модели её же ошибки и просим переписать все строки
      if (res.errors > 0 && res.errors * 3 >= res.entries) {
        const bad = parseScheduleText(text, today).errors.slice(0, 8).map((e) => `строка ${e.line}: ${e.reason} — ${e.text}`).join("\n");
        messages.push({ role: "assistant", content: text }, { role: "user", content: `Эти строки не разобрались:\n${bad}\n\nИсправь их по правилам и пришли заново все строки расписания.` });
        const second = await ask();
        const r2 = count(second, today);
        if (r2.entries - r2.errors > res.entries - res.errors) [text, res] = [second, r2];
      }
    }
  } finally {
    const rub = pages * env.priceOcr + (tokensIn / 1000) * env.priceIn + (tokensOut / 1000) * env.priceOut;
    run("INSERT INTO ai_usage (user_id, kind, pages, tokens_in, tokens_out, rub) VALUES (?, 'schedule', ?, ?, ?, ?)", userId, pages, tokensIn, tokensOut, Math.round(rub * 100) / 100);
  }
  const rub = all<{ rub: number }>("SELECT rub FROM ai_usage WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId)[0]?.rub ?? 0;
  return { text, ...res, rub };
}

function count(text: string, today: string) {
  const p = parseScheduleText(text, today);
  return { entries: p.entries.length, errors: p.errors.length };
}
