// Ошибки сервера — владельцу в телеграм (11.10.2026): необработанные исключения и
// ответы 5xx. Одинаковое сообщение — не чаще раза в 10 минут. В тексте нет ни тела
// запроса, ни данных людей, кроме id.
// Без BOT_TOKEN (разработка, e2e) сообщение уходит в журнал строкой «[бот → …]».
import type { Context, Next } from "hono";
import { bot, esc } from "./bot.ts";
import { env } from "./env.ts";
import { failures } from "./http.ts";

export interface Fault {
  kind: "request" | "uncaught" | "rejection" | "bot";
  status?: number;
  method?: string;
  /** Шаблон маршрута («/api/events/:id») или путь без query */
  route?: string;
  userId?: number | null;
  error?: unknown;
}

export const ALARM_GAP_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

function errorBits(e: unknown): { name: string; message: string; where: string } {
  if (!(e instanceof Error)) return { name: "Ошибка", message: typeof e === "string" ? e : "", where: "" };
  // Где упало: первая строка стека из нашего кода, без пути до папки проекта
  const frame = (e.stack ?? "").split("\n").find((l) => l.includes("/src/") && !l.includes("node_modules"));
  const where = frame ? (/\/(src\/[^\s)]+)/.exec(frame)?.[1] ?? "") : "";
  return { name: e.name || "Error", message: (e.message ?? "").split("\n")[0].slice(0, 160), where };
}

const TITLE: Record<Fault["kind"], string> = {
  request: "Ошибка сервера",
  uncaught: "Необработанное исключение, сервер перезапускается",
  rejection: "Необработанный отказ промиса",
  bot: "Ошибка в боте",
};

/** Ключ для «не чаще раза в 10 минут»: вид, код, маршрут и сама ошибка, но не человек. */
export function faultKey(f: Fault): string {
  const { name, message } = errorBits(f.error);
  return [f.kind, f.status ?? "", f.method ?? "", f.route ?? "", name, message].join("|");
}

/** Текст сообщения владельцу. */
export function faultText(f: Fault): string {
  const { name, message, where } = errorBits(f.error);
  const lines = [`⚠️ <b>${TITLE[f.kind]}</b>`];
  if (f.method || f.route || f.status) lines.push([f.status, f.method, f.route].filter(Boolean).map((x) => esc(String(x))).join(" "));
  if (f.error !== undefined) lines.push(`<code>${esc(name)}${message ? `: ${esc(message)}` : ""}</code>`);
  if (where) lines.push(esc(where));
  if (f.userId) lines.push(`id ${f.userId}`);
  return lines.join("\n");
}

/** Куда писать: чат поддержки владельца, иначе первый админ. */
const ownerChat = (): number | null => env.supportChatId ?? env.adminIds[0] ?? null;

/** Сообщить владельцу. true — отправили (или записали в журнал), false — такое уже было за 10 минут. */
export async function alarm(f: Fault, now = Date.now()): Promise<boolean> {
  const key = faultKey(f);
  const prev = lastSent.get(key);
  if (prev !== undefined && now - prev < ALARM_GAP_MS) return false;
  lastSent.set(key, now);
  // Старые ключи не копим: при сотне разных ошибок карта не растёт бесконечно
  if (lastSent.size > 500) for (const [k, t] of lastSent) if (now - t >= ALARM_GAP_MS) lastSent.delete(k);
  const text = faultText(f);
  const chat = ownerChat();
  if (!bot || !chat) {
    console.log(`[бот → ${chat ?? "владельцу"}] ${text}`);
    return true;
  }
  try {
    await bot.api.sendMessage(chat, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    console.error("alarm: владельцу не ушло", (e as Error).message);
  }
  return true;
}

/** Для тестов: забыть, что уже отправляли. */
export function resetAlarms(): void {
  lastSent.clear();
}


/**
 * Посредник для всего сервера: ответ 5xx — владельцу. Тело запроса не читаем,
 * из данных человека — только id (если запрос прошёл вход в /api).
 */
export async function alarmOn5xx(c: Context, next: Next): Promise<void> {
  await next();
  if (c.res.status < 500) return;
  const route = [...c.req.matchedRoutes].reverse().find((r) => r.method !== "ALL")?.path ?? c.req.path;
  const user = (c.get as (k: string) => { id: number } | undefined)("user");
  void alarm({ kind: "request", status: c.res.status, method: c.req.method, route, userId: user?.id ?? null, error: failures.get(c.req.raw) });
}
