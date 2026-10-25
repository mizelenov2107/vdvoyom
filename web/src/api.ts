import { QueryClient, useMutation, useQuery, type QueryKey } from "@tanstack/react-query";
import { authHeader } from "./tg.ts";
import { store } from "./store.ts";

export class ApiError extends Error {
  status: number;
  /** Тело ответа с ошибкой */
  data: unknown;
  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: {
      Authorization: authHeader(),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 402 && data?.plus) {
    // Упёрлись в бесплатный лимит: вместо тоста — шторка с ценой и акцией
    store.paywall({ feature: data.plus, text: data.error });
    throw new ApiError("", 402);
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status, data);
  return data as T;
}

/**
 * События воронки для админки (11.10.2026): то, что видит только клиент. Сервер
 * принимает лишь имена из белого списка (server/src/track.ts) и пишет их в журнал
 * без содержимого. Ничего не ждёт и никогда не бросает: аналитика не должна
 * ломать экран. Одинаковое событие сервер учитывает не чаще раза в минуту.
 *
 *   track("plus_view", { from: "menu" })      — открыт экран «Вдвоём+»
 *   track("lock_view", { feature: "goals" })  — показана шторка замка
 */
export type PlusFrom = "lock" | "menu" | "home" | "promo" | "link" | "other";
export type LockFeature = "films" | "capsules" | "goals" | "wardrobe" | "tests" | "rounds" | "cheat";
export function track(name: "plus_view", props?: { from?: PlusFrom }): void;
export function track(name: "lock_view", props: { feature: LockFeature | string }): void;
export function track(name: string, props: Record<string, unknown> = {}): void {
  try {
    void fetch("/api/track", {
      method: "POST",
      headers: { Authorization: authHeader(), "content-type": "application/json" },
      body: JSON.stringify({ name, props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* без сети — не страшно */
  }
}

/** Загрузка файла формой: для фото. Заголовок входа тот же, что у обычных запросов. */
export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: "POST", headers: { Authorization: authHeader() }, body: form });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 402 && data?.plus) {
    store.paywall({ feature: data.plus, text: data.error });
    throw new ApiError("", 402);
  }
  if (!res.ok) throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    // 402 «это во «Вдвоём+»» не повторяем: ответ не изменится, а шторка откроется дважды
    queries: { staleTime: 20_000, retry: (n, e) => (e as ApiError).status !== 402 && n < 1, refetchOnWindowFocus: true },
    mutations: {
      onError: (e) => store.toast((e as Error).message || "Не получилось"),
    },
  },
});

export function useApi<T>(key: QueryKey, path: string | null, opts: { enabled?: boolean } = {}) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => api<T>(path!),
    enabled: path !== null && opts.enabled !== false,
  });
}

/** Мутация, после которой перечитываются перечисленные разделы. */
export function useAct<V = void, R = unknown>(fn: (v: V) => Promise<R>, invalidate: string[] = []) {
  return useMutation<R, Error, V>({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of invalidate) void queryClient.invalidateQueries({ queryKey: [k] });
    },
  });
}

// Какие запросы перечитать, когда сервер сообщил об изменении раздела
const SCOPES: Record<string, string[]> = {
  pair: ["me", "home"],
  schedule: ["schedule", "windows", "home"],
  events: ["events", "home"],
  tasks: ["tasks", "home"],
  wishes: ["wishes", "home"],
  plans: ["plans", "home"],
  cards: ["cards"],
  votes: ["votes"],
  capsules: ["capsules", "home"],
  notes: ["notes"],
  daily: ["daily", "home"],
  matches: ["matches", "home"],
  ideas: ["deck", "matches"],
  films: ["deck", "matches", "films"],
  tests: ["tests", "test"],
  pings: ["home"],
  movie_prefs: ["genres", "deck"],
  goals: ["goals", "home"],
  wardrobe: ["wardrobe", "looks"],
};

// Живой канал читается через fetch, а не EventSource: EventSource не умеет
// заголовки, и ключ входа пришлось бы класть в адрес, а адреса оседают в журналах.
let controller: AbortController | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

function handle(event: string, raw: string) {
  const data = JSON.parse(raw);
  if (event === "change") {
    const { scope, ...rest } = data;
    for (const k of SCOPES[scope] ?? []) void queryClient.invalidateQueries({ queryKey: [k] });
    if (scope === "pings" && rest.from !== store.get().meId) store.ping(rest.kind);
  } else if (event === "match") {
    // Тот, кто свайпнул последним, видит мэтч из ответа на свайп — второй раз не показываем
    if (data.by !== store.get().meId) store.showMatch(data);
  } else if (event === "presence") store.setPresence(data);
}

export function connectStream(): void {
  controller?.abort();
  clearTimeout(retry);
  const ctrl = new AbortController();
  controller = ctrl;
  void (async () => {
    try {
      const res = await fetch("/api/stream", { headers: { Authorization: authHeader(), Accept: "text/event-stream" }, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of chunk.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          }
          if (data.length) handle(event, data.join("\n"));
        }
      }
    } catch {
      /* обрыв или закрытие — переподключимся ниже */
    }
    if (!ctrl.signal.aborted) retry = setTimeout(connectStream, 3000);
  })();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void queryClient.invalidateQueries();
    connectStream();
  }
});
