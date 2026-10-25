// Маленькое глобальное состояние без библиотек: навигация, мэтч, тосты, присутствие.
import { useSyncExternalStore } from "react";

export type Tab = "home" | "calendar" | "swipes" | "wishes" | "more";
export interface Route {
  name: string;
  params?: Record<string, unknown>;
}
export interface Paywall {
  feature: string;
  text: string;
}
export interface MatchEvent {
  deck: "movie" | "idea" | "place";
  item: Record<string, unknown> & { id: string };
  by: number;
}

interface State {
  tab: Tab;
  stack: Route[];
  match: MatchEvent | null;
  toast: { text: string; id: number } | null;
  presence: Record<string, string>;
  meId: number | null;
  ping: { kind: string; id: number } | null;
  /**
   * Шторка «это во «Вдвоём+»»: какой лимит упёрся и что сказать.
   */
  paywall: Paywall | null;
  /** Шторка «Отзыв»: с какого экрана открыли */
  feedback: { screen: string } | null;
  /** Шторка поиска по разделам */
  search: boolean;
}

let state: State = { tab: "home", stack: [], match: null, toast: null, presence: {}, meId: null, ping: null, paywall: null, feedback: null, search: false };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const store = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setTab: (tab: Tab) => set({ tab, stack: [] }),
  push: (name: string, params?: Record<string, unknown>) => set({ stack: [...state.stack, { name, params }] }),
  back: () => set({ stack: state.stack.slice(0, -1) }),
  reset: () => set({ stack: [] }),
  showMatch: (m: MatchEvent | null) => set({ match: m }),
  setPresence: (p: Record<string, string>) => set({ presence: p }),
  setMe: (id: number) => set({ meId: id }),
  ping: (kind: string) => set({ ping: { kind, id: Date.now() } }),
  paywall: (p: Paywall | null) => set({ paywall: p }),
  feedback: (screen: string | null) => set({ feedback: screen === null ? null : { screen } }),
  search: (open: boolean) => set({ search: open }),
  toast: (text: string) => {
    // Пустое сообщение — ошибка уже показана по-другому (например, шторкой «Вдвоём+»)
    if (!text) return;
    clearTimeout(toastTimer);
    set({ toast: { text, id: Date.now() } });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
};

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(state));
}

export const nav = {
  push: store.push,
  back: store.back,
  tab: store.setTab,
};
